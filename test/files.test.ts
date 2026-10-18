import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { collect } from '../src/collect.js'
import type { Config } from '../src/config.js'
import { buildExport, formatReference, importFile, MAX_UPLOAD_BYTES, parseReference, PLUGIN } from '../src/files.js'
import { GhostAdmin } from '../src/ghost/admin.js'
import { parseTargetLanguages } from '../src/languages.js'
import { createApp } from '../src/server.js'
import { readMarker, Translator } from '../src/translate.js'
import { TranslationFiles } from '../src/vendor/supertext-sdk/index.js'
import { ADMIN_KEY, fakeGhost, lexicalOf } from './fakeGhost.js'

const languages = parseTargetLanguages('de-CH,fr,de-LI')
const [deCH, fr] = languages as [any, any]

/** Puts a <target> into the trans-unit `id` of an exported XLIFF file. */
const withTarget = (xliff: string, id: string, target: string) =>
  xliff.replace(new RegExp(`(<trans-unit id="${id.replace(/\./g, '\\.')}"[^>]*>\\s*<source>[\\s\\S]*?</source>)`), `$1<target>${target}</target>`)

function setup() {
  const ghost = fakeGhost()
  const admin = new GhostAdmin({ adminKey: ADMIN_KEY, apiUrl: 'https://ghost.test', fetch: ghost.fetch })
  const translator = new Translator({ ghost: admin, sourceLanguage: 'en', supertext: null })
  const source = ghost.add('posts', { custom_excerpt: 'Short summary', lexical: lexicalOf('First paragraph.', 'Second <b> paragraph.'), title: 'Hello world' })
  const exportFor = (targets = [deCH], format: 'xliff' | 'html' = 'xliff') =>
    buildExport({ format, id: source.id, resource: 'posts', segments: collect(ghost.posts.get(source.id)!).segments, sourceLanguage: 'en', targets }).content
  const options = (extra: { includeChanged?: boolean; force?: boolean } = {}) => ({
    includeChanged: extra.includeChanged,
    languages,
    load: async (ref: { resource: 'posts' | 'pages'; id: string }) => {
      const post = await admin.getPost(ref.resource, ref.id).catch(() => null)
      return post ? { segments: collect(post).segments, title: String(post.title) } : null
    },
    write: (ref: { resource: 'posts' | 'pages'; id: string }, language: any, translations: Map<string, string>) =>
      translator.importTranslations(ref.resource, ref.id, language, extra.force ?? false, translations),
  })
  const translations = () => [...ghost.posts.values()].filter((p) => readMarker(p.codeinjection_head))
  return { exportFor, ghost, options, source, translations }
}

describe('reference', () => {
  it('round-trips and refuses anything else', () => {
    const ref = { id: '65f1c0aa', language: 'de-CH', resource: 'pages' as const }
    expect(formatReference(ref)).toBe('page:65f1c0aa:de-CH')
    expect(parseReference(formatReference(ref))).toEqual(ref)
    expect(parseReference('post:abc:fr')).toEqual({ id: 'abc', language: 'fr', resource: 'posts' })
    for (const bad of ['', 'post:abc', 'post:xyz:de', 'doc:abc:de', 'post:abc:de:x', 'post:abc:<b>']) expect(parseReference(bad), bad).toBeNull()
  })
})

describe('export', () => {
  it('uses the collected segments and their paths, plain text as text, the mapped codes', () => {
    const { exportFor, source } = setup()
    const [de, li] = TranslationFiles.read(exportFor([deCH, languages[2]!]))
    expect([de!.plugin, de!.reference, de!.sourceLanguage, de!.targetLanguage]).toEqual([PLUGIN, `post:${source.id}:de-CH`, 'en', 'de-CH'])
    // de-LI has no Supertext language: its own code, so the export isn't blocked.
    expect(li!.targetLanguage).toBe('de-LI')
    expect(de!.units.map((u) => u.key)).toEqual(['title', 'custom_excerpt', 'lexical.0.paragraph', 'lexical.1.paragraph'])
    expect(exportFor()).toContain('<source>Hello world</source>')
  })

  it('names the file, HTML with exactly one language, nothing to translate', () => {
    const { source } = setup()
    const file = buildExport({ format: 'html', id: source.id, resource: 'posts', segments: collect(source).segments, sourceLanguage: 'en', targets: [fr] })
    expect(file.filename).toBe(`ghost-${source.id}-fr.html`)
    expect(file.contentType).toBe('text/html; charset=utf-8')
    expect(file.content).toContain('<meta name="supertext:target-language" content="fr-FR">')
    const base = { id: source.id, resource: 'posts' as const, sourceLanguage: 'en' }
    expect(() => buildExport({ ...base, format: 'html', segments: collect(source).segments, targets: [fr, deCH] })).toThrow(expect.objectContaining({ code: 'one_target' }))
    expect(() => buildExport({ ...base, format: 'xliff', segments: [], targets: [fr] })).toThrow(expect.objectContaining({ code: 'nothing_to_translate' }))
    expect(() => buildExport({ ...base, format: 'xliff', segments: collect(source).segments, targets: [] })).toThrow(expect.objectContaining({ code: 'no_targets' }))
  })
})

describe('import', () => {
  it('writes ok translations as a draft through the Translator; untranslated, invalid and missing stay in the source', async () => {
    const { exportFor, ghost, options, source, translations } = setup()
    let xliff = withTarget(exportFor(), 'title', 'Hallo Welt')
    xliff = withTarget(xliff, 'lexical.0.paragraph', 'Erster Absatz.')
    xliff = withTarget(xliff, 'custom_excerpt', 'Kurz <ph id="1">&lt;br&gt;</ph>') // a code in plain text: invalid
    ghost.edit(source.id, { lexical: lexicalOf('First paragraph.', 'Second <b> paragraph.', 'Added later.'), updated_at: ghost.posts.get(source.id)!.updated_at })
    const [job] = await importFile(xliff, options())
    expect(job!.error).toBeNull()
    expect(job!.counts).toEqual({ invalid_markup: 1, missing: 1, ok: 2, source_changed: 0, untranslated: 1 })
    expect(job!.imported).toBe(2)
    expect(job!.result).toMatchObject({ status: 'created' })
    const [t] = translations()
    expect(t).toMatchObject({ custom_excerpt: 'Short summary', status: 'draft', title: 'Hallo Welt' })
    expect(JSON.parse(t!.lexical).root.children.map((p: any) => p.children[0].text)).toEqual(['Erster Absatz.', 'Second <b> paragraph.', 'Added later.'])
    expect(t!.tags.map((x: any) => x.name)).toEqual(['#lang-de-ch'])
    // The source post is never written.
    expect(ghost.posts.get(source.id)!.title).toBe('Hello world')
  })

  it('source_changed only with the option; edited translations kept unless forced', async () => {
    const { exportFor, ghost, options, source, translations } = setup()
    const xliff = withTarget(withTarget(exportFor(), 'title', 'Hallo Welt'), 'lexical.1.paragraph', 'Zweiter &lt;b&gt; Absatz.')
    ghost.edit(source.id, { title: 'Hello there', updated_at: ghost.posts.get(source.id)!.updated_at })
    let [job] = await importFile(xliff, options())
    expect(job).toMatchObject({ imported: 1, skippedChanged: 1 })
    expect(translations()[0]!.title).toBe('Hello there')
    // Somebody edits the translation: a second import keeps it, unless forced.
    const t = translations()[0]!
    ghost.edit(t.id, { title: 'Edited by hand', updated_at: t.updated_at })
    ;[job] = await importFile(xliff, options({ includeChanged: true }))
    expect(job!.result).toMatchObject({ status: 'kept' })
    expect(job!.imported).toBe(0)
    ;[job] = await importFile(xliff, options({ force: true, includeChanged: true }))
    expect(job).toMatchObject({ imported: 2, result: { status: 'updated' } })
    expect(translations()[0]!.title).toBe('Hallo Welt')
  })

  it('an HTML file imported unchanged writes the source text', async () => {
    const { exportFor, options, translations } = setup()
    const [job] = await importFile(exportFor([fr], 'html'), options())
    expect(job!.counts.ok).toBe(4)
    expect(translations()[0]).toMatchObject({ title: 'Hello world' })
  })

  it('another plugin, unknown reference, a language the site lacks, a missing post', async () => {
    const { exportFor, options, source, translations } = setup()
    const base = withTarget(exportFor(), 'title', 'Hallo')
    const cases: Array<[string, string, Record<string, string>]> = [
      [base.replace(`product-name="${PLUGIN}"`, 'product-name="Payload-Supertext-Translation"'), 'other_system', { plugin: 'Payload-Supertext-Translation' }],
      [base.replace(`original="post:${source.id}:de-CH"`, 'original="article:1"'), 'not_found', {}],
      [base.replace(`original="post:${source.id}:de-CH"`, `original="post:${source.id}:it"`), 'no_language', { language: 'it' }],
      [base.replace(`original="post:${source.id}:de-CH"`, 'original="post:abcdef:de-CH"'), 'not_found', {}],
    ]
    for (const [content, code, params] of cases) {
      const [job] = await importFile(content, options())
      expect(job!.error, code).toEqual({ key: `files.error.${code}`, params })
    }
    expect(translations()).toHaveLength(0)
  })

  it('refuses too large files before reading; read errors with the SDK codes', async () => {
    const { options } = setup()
    await expect(importFile('x'.repeat(MAX_UPLOAD_BYTES + 1), options())).rejects.toMatchObject({ code: 'too_large' })
    await expect(importFile('hello', options())).rejects.toMatchObject({ code: 'invalid_file' })
    await expect(importFile('<!DOCTYPE html><html><body><p>x</p></body></html>', options())).rejects.toMatchObject({ code: 'missing_metadata' })
  })
})

describe('translation files page', () => {
  const servers: Array<{ close: () => void }> = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.close()
  })

  async function start(role: string) {
    const ghost = fakeGhost()
    const source = ghost.add('posts', { lexical: lexicalOf('First paragraph.'), title: 'Hello world' })
    const config: Config = {
      connectorSettingsFile: null,
      connectorUrl: null,
      ghostSecrets: () => ({ adminKey: ADMIN_KEY, webhookSecret: '' }),
      host: '127.0.0.1',
      jobsFile: null,
      languageMap: {},
      languages: parseTargetLanguages('de-CH,fr'),
      port: 0,
      settingsFile: null,
      siteUrl: 'https://blog.example.com',
      sourceLanguage: 'en',
      stateFile: join(mkdtempSync(join(tmpdir(), 'st-files-')), 'supertext-state.json'),
      supertextApiKey: '',
      supertextApiUrl: 'https://api.test/v1/',
      uiLanguage: 'en',
      upstream: 'http://ghost.test',
      versionReports: false,
    }
    const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/users/me/')) {
        const cookie = new Headers(init?.headers).get('cookie') ?? ''
        return cookie.includes('ghost-admin-api-session=good')
          ? Response.json({ users: [{ email: 'staff@example.com', name: 'Staff', roles: [{ name: role }] }] })
          : new Response('{}', { status: 403 })
      }
      return ghost.fetch(url, init)
    }) as typeof globalThis.fetch
    const app = createApp(config, { fetch })
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    servers.push(app.server)
    return { base: `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`, ghost, source }
  }
  const cookie = { cookie: 'ghost-admin-api-session=good' }
  const csrfOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? ''

  it('exports a post as a download and imports the translated file as a draft', async () => {
    const { base, ghost, source } = await start('Editor')
    const page = await (await fetch(`${base}/ghost/supertext/files`, { headers: cookie })).text()
    expect(page).toContain(`<option value="posts:${source.id}">Post: Hello world (draft)</option>`)
    const csrf = csrfOf(page)
    const exported = await fetch(`${base}/ghost/supertext/files/export`, {
      body: new URLSearchParams([['csrf', csrf], ['item', `posts:${source.id}`], ['format', 'xliff'], ['target', 'fr']]),
      headers: { ...cookie, 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    })
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toBe('application/x-xliff+xml')
    expect(exported.headers.get('content-disposition')).toBe(`attachment; filename="ghost-${source.id}-fr.xlf"`)
    const xliff = withTarget(await exported.text(), 'title', 'Bonjour le monde')

    const upload = (body: FormData, headers: Record<string, string> = cookie) => fetch(`${base}/ghost/supertext/files/import`, { body, headers, method: 'POST' })
    const form = new FormData()
    form.set('csrf', csrf)
    form.set('file', new Blob([xliff], { type: 'application/x-xliff+xml' }), 'file.xlf')
    const imported = await upload(form)
    expect(imported.status).toBe(200)
    const summary = await imported.text()
    expect(summary).toContain('Imported: 1')
    expect(summary).toContain('Not translated in the file: 1')
    const t = [...ghost.posts.values()].find((p) => readMarker(p.codeinjection_head))
    expect(t).toMatchObject({ status: 'draft', title: 'Bonjour le monde' })

    // No token, cross-site, signed out: refused.
    const noToken = new FormData()
    noToken.set('file', new Blob([xliff]), 'file.xlf')
    expect((await upload(noToken)).status).toBe(403)
    expect((await upload(form, { ...cookie, origin: 'https://evil.example' })).status).toBe(403)
    expect((await upload(form, {})).status).toBe(401)
    // An invalid file: the message on the page.
    const bad = new FormData()
    bad.set('csrf', csrf)
    bad.set('file', new Blob(['not a file']), 'x.xlf')
    const invalid = await upload(bad)
    expect(invalid.status).toBe(400)
    expect(await invalid.text()).toContain('This file isn’t a valid XLIFF or HTML translation file.'.replace('’', "'"))
  })

  it('lets only editors and administrators export and import', async () => {
    const { base, source } = await start('Author')
    const page = await (await fetch(`${base}/ghost/supertext/files`, { headers: cookie })).text()
    expect(page).toContain('Only Ghost editors and administrators can export and import translation files.')
    const res = await fetch(`${base}/ghost/supertext/files/export`, {
      body: new URLSearchParams([['csrf', csrfOf(page)], ['item', `posts:${source.id}`], ['target', 'fr']]),
      headers: { ...cookie, 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    })
    expect(res.status).toBe(403)
  })
})
