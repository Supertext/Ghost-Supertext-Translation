import { createHmac } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import type { Config } from '../src/config.js'
import { GhostAdmin } from '../src/ghost/admin.js'
import { parseTargetLanguages } from '../src/languages.js'
import { createApp } from '../src/server.js'
import { SupertextClient } from '../src/supertext/client.js'
import { contentHash, readMarker, Translator } from '../src/translate.js'
import { ADMIN_KEY, fakeGhost, lexicalOf } from './fakeGhost.js'
import { fakeSupertext } from './fakeSupertext.js'

const [de, fr] = parseTargetLanguages('de-CH,fr-CH') as [any, any]

function setup(opts: { normalizeLexical?: boolean; supertext?: Parameters<typeof fakeSupertext>[0] } = {}) {
  const ghost = fakeGhost(opts)
  const st = fakeSupertext(opts.supertext)
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) =>
    /^https:\/\/(api|review)\.test\//.test(String(input)) ? st.fetch(input, init) : ghost.fetch(input, init)) as typeof fetch
  const translator = new Translator({
    ghost: new GhostAdmin({ adminKey: ADMIN_KEY, apiUrl: 'https://ghost.test', fetch: fetchImpl }),
    sourceLanguage: 'en',
    supertext: new SupertextClient({ apiKey: 'test-key', baseUrl: 'https://api.test/v1', fetch: fetchImpl, reviewUrl: 'https://review.test/v1/', sleep: async () => {} }),
  })
  const source = ghost.add('posts', {
    authors: [{ email: 'eve@example.com', id: 'u2' }],
    codeinjection_head: '<style>.x{}</style>',
    custom_excerpt: 'Short summary',
    feature_image: 'https://example.com/cover.jpg',
    lexical: lexicalOf('First paragraph.', 'Second paragraph.'),
    tags: [{ name: 'News' }, { name: '#translate-de-ch' }],
    title: 'Hello world',
  })
  return { fetchImpl, ghost, source, st, translator }
}

const translations = (ghost: ReturnType<typeof fakeGhost>) => [...ghost.posts.values()].filter((p) => readMarker(p.codeinjection_head))

describe('Translator', () => {
  it('creates a draft translation linked to its source', async () => {
    const { ghost, source, st, translator } = setup()
    const result = await translator.translate('posts', source.id, de, false)

    expect(result).toMatchObject({ message: 'Created the German (Switzerland) draft "[de-CH] Hello world".', status: 'created' })
    const [t] = translations(ghost)
    expect(t).toMatchObject({
      authors: [{ id: 'u2' }],
      custom_excerpt: '[de-CH] Short summary',
      feature_image: 'https://example.com/cover.jpg',
      status: 'draft',
      title: '[de-CH] Hello world',
    })
    expect(t!.tags.map((x: any) => x.name)).toEqual(['News', '#lang-de-ch'])
    expect(JSON.parse(t!.lexical).root.children.map((p: any) => p.children[0].text)).toEqual([
      '[de-CH] First paragraph.',
      '[de-CH] Second paragraph.',
    ])
    expect(readMarker(t!.codeinjection_head)).toEqual({ hash: contentHash(t!), lang: 'de-CH', source: source.id })
    expect(t!.codeinjection_head).toContain('<style>.x{}</style>')
    // the request went out with a primary-subtag source and the regional target
    const form = st.calls[0]!.form!
    expect([form.get('source_lang'), form.get('target_lang')]).toEqual(['en', 'de-CH'])
    // the source post was never written
    expect(ghost.posts.get(source.id)!.updated_at).toBe(source.updated_at)
  })

  it('updates an untouched draft translation in place', async () => {
    const { ghost, source, translator } = setup()
    await translator.translate('posts', source.id, de, false)
    ghost.edit(source.id, { title: 'Hello again' })
    const result = await translator.translate('posts', source.id, de, false)
    expect(result.status).toBe('updated')
    expect(translations(ghost).map((t) => t.title)).toEqual(['[de-CH] Hello again'])
  })

  it('records the hash of what Ghost stored when Ghost normalises the Lexical JSON', async () => {
    const { ghost, source, translator } = setup({ normalizeLexical: true })
    await translator.translate('posts', source.id, de, false)
    expect((await translator.translate('posts', source.id, de, false)).status).toBe('updated')
    expect(translations(ghost)).toHaveLength(1)
  })

  it('does not overwrite an edited or published translation unless forced', async () => {
    const { ghost, source, translator } = setup()
    const created = await translator.translate('posts', source.id, de, false)
    ghost.edit(created.translationId!, { title: 'Hallo Welt (überarbeitet)' })

    const kept = await translator.translate('posts', source.id, de, false)
    expect(kept).toMatchObject({ status: 'kept', translationId: created.translationId })
    expect(kept.message).toContain('was edited after Supertext created it')
    expect(kept.message).toContain('#retranslate-de-ch')
    expect(ghost.posts.get(created.translationId!)!.title).toBe('Hallo Welt (überarbeitet)')

    const forced = await translator.translate('posts', source.id, de, true)
    expect(forced.status).toBe('updated')
    expect(ghost.posts.get(created.translationId!)!.title).toBe('[de-CH] Hello world')

    ghost.edit(created.translationId!, { status: 'published' })
    const published = await translator.translate('posts', source.id, de, false)
    expect(published).toMatchObject({ status: 'kept' })
    expect(published.message).toContain('is published')
    // forcing keeps the publish status
    await translator.translate('posts', source.id, de, true)
    expect(ghost.posts.get(created.translationId!)!.status).toBe('published')
  })

  it('keeps one translation per language', async () => {
    const { ghost, source, translator } = setup()
    await Promise.all([translator.translate('posts', source.id, de, false), translator.translate('posts', source.id, fr, false)])
    expect(translations(ghost).map((t) => readMarker(t.codeinjection_head)!.lang).sort()).toEqual(['de-CH', 'fr-CH'])
  })

  it('refuses to translate a translation', async () => {
    const { ghost, source, translator } = setup()
    const { translationId } = await translator.translate('posts', source.id, de, false)
    const result = await translator.translate('posts', translationId!, fr, false)
    expect(result).toMatchObject({ status: 'skipped' })
    expect(translations(ghost)).toHaveLength(1)
  })

  it('reports Supertext errors and missing content as failures', async () => {
    const { source, translator } = setup({ supertext: { failStatus: 401 } })
    expect(await translator.translate('posts', source.id, de, false)).toMatchObject({
      message:
        'Authentication failure. Please check your Supertext API key. No Supertext account yet? Create one at https://www.supertext.com/person/en/account/signin. Generate your API key at https://www.supertext.com/en/integrations/api (requires the Admin role). — nope',
      status: 'failed',
    })
    const old = setup()
    const legacy = old.ghost.add('posts', { lexical: null, mobiledoc: '{}', title: 'Old post' })
    expect((await old.translator.translate('posts', legacy.id, de, false)).message).toContain("Ghost's current editor format")
  })

  it('sends nothing for a language without a Supertext code', async () => {
    const { source, st, translator } = setup()
    const [unmapped] = parseTargetLanguages('de-LI')
    const result = await translator.translate('posts', source.id, unmapped!, false)
    expect(result).toMatchObject({ errorCode: 'unsupported_language', status: 'failed' })
    expect(result.message).toBe(
      'The language German (Liechtenstein) (de-LI) has no Supertext language yet. Ask your administrator to choose one on the Supertext status page (Ghost Admin → /ghost/supertext/ → Language mapping).',
    )
    expect(st.calls).toHaveLength(0)
  })

  it('sends a mapped language with its Supertext code', async () => {
    const { source, st, translator } = setup()
    const [mapped] = parseTargetLanguages('es', {}, {})
    expect((await translator.translate('posts', source.id, mapped!, false)).status).toBe('created')
    expect(st.calls[0]!.form!.get('target_lang')).toBe('es')
  })

  it('refuses a tone the target lacks when it was set for that language, and drops one set for all', async () => {
    const { source, st, translator } = setup()
    const [blocked] = parseTargetLanguages('en-US', { 'en-us': 'more' })
    const result = await translator.translate('posts', source.id, blocked!, false)
    expect(result).toMatchObject({ errorCode: 'unsupported_feature', status: 'failed' })
    expect(result.message).toContain('Supertext offers no formal or informal tone for this language')
    expect(st.calls).toHaveLength(0)
    const [ignored] = parseTargetLanguages('en-US', { '*': 'more' })
    expect((await translator.translate('posts', source.id, ignored!, false)).status).toBe('created')
    expect(st.calls[0]!.form!.has('politeness')).toBe(false)
  })

  it('sends languages with Translation review through the review service, the others directly', async () => {
    const { source, st, translator } = setup()
    expect((await translator.translate('posts', source.id, { ...de, review: true }, false)).status).toBe('created')
    expect((await translator.translate('posts', source.id, fr, false)).status).toBe('created')
    const byHost = (host: string) => st.calls.filter((c) => new URL(c.url).host === host).map((c) => `${c.method} ${new URL(c.url).pathname.replace(/\/f\d+/, '/{id}')}`)
    const roundTrip = ['POST /v1/translate/ai/file', 'GET /v1/translate/ai/file/{id}/status', 'GET /v1/translate/ai/file/{id}/translation', 'DELETE /v1/translate/ai/file/{id}']
    expect(byHost('review.test'), 'German: upload, status, download and delete through the review service').toEqual(roundTrip)
    expect(byHost('api.test'), 'French: directly to Supertext').toEqual(roundTrip)
  })

  it('reports segments that came back empty', async () => {
    const { source, translator } = setup({ supertext: { drop: [2] } })
    const result = await translator.translate('posts', source.id, de, false)
    expect(result.missing).toEqual(['lexical.0.paragraph'])
    expect(result.message).toContain('1 text part(s) came back empty')
  })
})

describe('webhook server', () => {
  let close: (() => void) | undefined
  afterEach(() => close?.())

  async function start(env: Partial<Config> = {}, opts: { supertext?: Parameters<typeof fakeSupertext>[0] } = {}) {
    const s = setup(opts)
    const reports: Array<Record<string, any>> = []
    const center = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      reports.push(JSON.parse(String(init?.body)))
      return new Response('{"ok":true}', { status: 202 })
    }) as typeof fetch
    const config: Config = {
      connectorUrl: null,
      ghostSecrets: () => ({ adminKey: ADMIN_KEY, webhookSecret: 'whsec' }),
      host: '127.0.0.1',
      jobsFile: null,
      languageMap: {},
      languages: parseTargetLanguages('de-CH,fr-CH'),
      port: 0,
      settingsFile: null,
      siteUrl: 'https://ghost.test',
      sourceLanguage: 'en',
      stateFile: null,
      supertextApiKey: 'test-key',
      supertextApiUrl: 'https://api.test/v1/',
      uiLanguage: 'auto',
      upstream: null,
      versionReports: false,
      ...env,
    }
    const app = createApp(config, { fetch: s.fetchImpl, reporterOverrides: { fetch: center, reportUrl: 'https://center.test/api/v1/report' }, supertextPollMs: 100 })
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r))
    close = () => app.server.close()
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const post = (body: unknown, event: string, secret = 'whsec') => {
      const raw = JSON.stringify(body)
      const t = Date.now()
      const sig = `sha256=${createHmac('sha256', secret).update(raw + t).digest('hex')}, t=${t}`
      return fetch(`${base}/supertext/webhook?event=${event}`, { body: raw, headers: { 'X-Ghost-Signature': sig }, method: 'POST' })
    }
    return { ...s, app, base, post, reports }
  }

  it('translates when a request tag is added and records the job', async () => {
    const { app, ghost, post, source } = await start()
    const body = {
      post: {
        current: { id: source.id, tags: [{ slug: 'news' }, { slug: 'hash-translate-all' }], title: source.title },
        previous: { tags: [{ slug: 'news' }] },
      },
    }
    expect((await post(body, 'post.edited')).status).toBe(202)
    await app.idle()
    expect(app.jobs.list().map((j) => [j.language, j.status])).toEqual([
      ['fr-CH', 'created'],
      ['de-CH', 'created'],
    ])
    expect(translations(ghost)).toHaveLength(2)
  })

  it('rejects unsigned webhooks and ignores saves that add no request tag', async () => {
    const { app, ghost, post, source } = await start()
    const body = { post: { current: { id: source.id, tags: [{ slug: 'hash-translate-de-ch' }], title: 'x' }, previous: {} } }
    expect((await post(body, 'post.added', 'wrong')).status).toBe(401)
    expect((await post(body, 'post.edited')).status).toBe(202)
    await app.idle()
    expect(app.jobs.list()).toEqual([])
    expect(translations(ghost)).toHaveLength(0)
  })

  it('creates the request tags with descriptions', async () => {
    const { app, ghost } = await start()
    await app.ensureTags()
    const names = [...ghost.tags.values()].filter((t) => t.visibility === 'internal').map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['#translate-all', '#retranslate-all', '#translate-de-ch', '#retranslate-fr-ch', '#lang-fr-ch']))
    const count = ghost.tags.size
    await app.ensureTags()
    expect(ghost.tags.size).toBe(count)
  })

  it('answers the public ping only while version reports are on', async () => {
    const on = await start({ versionReports: true })
    const ok = await fetch(`${on.base}/supertext/ping?challenge=abcdefghijklmnop1234`)
    expect([ok.status, ok.headers.get('content-type'), ok.headers.get('cache-control')]).toEqual([200, 'application/json', 'no-store'])
    expect(await ok.json()).toEqual({ challenge: 'abcdefghijklmnop1234', ok: true, plugin: 'Ghost-Supertext-Translation' })
    expect((await fetch(`${on.base}/supertext/ping?challenge=short`)).status).toBe(400)
    expect((await fetch(`${on.base}/supertext/ping`, { method: 'POST' })).status).toBe(405)
    close?.()
    const off = await start({ versionReports: false })
    expect((await fetch(`${off.base}/supertext/ping?challenge=abcdefghijklmnop1234`)).status).toBe(404)
  })

  it('reports the installation after a translation, and a rejected key once', async () => {
    const body = (id: string) => ({ post: { current: { id, tags: [{ slug: 'hash-translate-de-ch' }], title: 'x' }, previous: { tags: [] } } })
    const good = await start({ versionReports: true })
    await good.post(body(good.source.id), 'post.edited')
    await good.app.idle()
    expect(good.reports.map((r) => [r.event, r.system, r.api_key_check?.status])).toEqual([['installed', { name: 'Ghost', version: '6.67' }, 'ok']])
    close?.()

    const bad = await start({ versionReports: true }, { supertext: { failStatus: 401 } })
    await bad.post(body(bad.source.id), 'post.edited')
    await bad.app.idle()
    expect(bad.app.jobs.list()[0]?.status).toBe('failed')
    expect(bad.reports.at(-1)).toMatchObject({ api_key_check: { http_status: 401, status: 'invalid' } })
    expect(bad.app.reporting.lastCheck()?.status).toBe('invalid')
  })

  it('serves a health check and hides the status page without a Ghost in front', async () => {
    const { base } = await start()
    expect(await (await fetch(`${base}/supertext/health`)).text()).toBe('ok')
    expect((await fetch(`${base}/ghost/supertext/`)).status).toBe(404)
  })

  it('serves the logo, favicon and fonts of its pages itself, cached for a year', async () => {
    const { base } = await start()
    const logo = await fetch(`${base}/supertext/static/supertext-logo.svg?v=1`)
    expect(logo.status).toBe(200)
    expect(logo.headers.get('content-type')).toBe('image/svg+xml')
    expect(logo.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await logo.text()).toContain('aria-label="Supertext"')
    const font = await fetch(`${base}/supertext/static/fonts/inter-latin-wght-normal.woff2`)
    expect(font.headers.get('content-type')).toBe('font/woff2')
    expect((await font.arrayBuffer()).byteLength).toBeGreaterThan(10_000)
    expect((await fetch(`${base}/supertext/static/favicon.svg`)).status).toBe(200)
    expect((await fetch(`${base}/supertext/static/fonts/Inter-LICENSE.txt`)).status).toBe(200)
    // Only the known files: nothing else from the disk.
    expect((await fetch(`${base}/supertext/static/../package.json`)).status).toBe(404)
    expect((await fetch(`${base}/supertext/static/%2e%2e/package.json`)).status).toBe(404)
    expect((await fetch(`${base}/supertext/static/app.css`)).status).toBe(404)
  })
})
