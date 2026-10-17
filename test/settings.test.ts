import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { Config } from '../src/config.js'
import { parseTargetLanguages } from '../src/languages.js'
import { createApp } from '../src/server.js'
import { CsrfTokens, effectiveMapping, fieldName, mappingRows, readMappingForm, SettingsStore, settingsPath } from '../src/settings.js'

describe('settings file', () => {
  it('lives next to STATE_FILE unless SUPERTEXT_SETTINGS_FILE names one', () => {
    expect(settingsPath(null, '/data/supertext-state.json')).toBe('/data/supertext-settings.json')
    expect(settingsPath('/x/s.json', '/data/state.json')).toBe('/x/s.json')
    expect(settingsPath(null, null)).toBeNull()
  })

  it('saves and reloads the mapping, and ignores broken content', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'st-settings-')), 'sub', 'settings.json')
    const store = new SettingsStore(file)
    expect(store.load()).toEqual({ languageCodes: {} })
    expect(store.save({ languageCodes: { 'de-LI': 'de-CH' } })).toBe(true)
    expect(new SettingsStore(file).load()).toEqual({ languageCodes: { 'de-LI': 'de-CH' } })
    writeFileSync(file, '{"languageCodes":{"de":1,"fr":"fr-CH"}}')
    expect(store.load()).toEqual({ languageCodes: { fr: 'fr-CH' } })
    writeFileSync(file, '{broken')
    expect(new SettingsStore(file).load()).toEqual({ languageCodes: {} })
  })

  it('keeps the mapping in memory without a file', () => {
    const store = new SettingsStore(null)
    store.save({ languageCodes: { de: 'de-CH' } })
    expect(store.load().languageCodes).toEqual({ de: 'de-CH' })
  })
})

describe('mapping rows', () => {
  it('lists the source first and preselects the saved value, else the suggestion, else nothing', () => {
    const rows = mappingRows('en', ['de', 'de-LI', 'fr-CH', 'gsw'], { gsw: 'gsw-u-sd-chzh' }, {})
    expect(rows.map((r) => [r.code, r.role, r.selected])).toEqual([
      ['en', 'source', 'en-US'],
      ['de', 'target', 'de-DE'],
      ['de-LI', 'target', ''],
      ['fr-CH', 'target', 'fr-CH'],
      ['gsw', 'target', 'gsw-u-sd-chzh'],
    ])
  })

  it('shows SUPERTEXT_LANGUAGE_MAP as a fixed choice that wins over the saved one', () => {
    const rows = mappingRows('en', ['de'], { de: 'de-AT' }, { DE: 'de-CH' })
    expect(rows[1]).toMatchObject({ overridden: true, selected: 'de-CH' })
    expect(effectiveMapping({ de: 'de-AT', fr: 'fr-CH' }, { DE: 'de-CH' })).toEqual({ DE: 'de-CH', fr: 'fr-CH' })
  })

  it('accepts only Supertext target codes and skips overridden languages', () => {
    const rows = mappingRows('en', ['de-LI', 'fr'], {}, { fr: 'fr-CH' })
    const form = (values: Record<string, string>) => new URLSearchParams(values)
    expect(readMappingForm(form({ [fieldName('de-LI')]: 'de-CH', [fieldName('fr')]: 'fr-FR', [fieldName('en')]: '' }), rows)).toEqual({ 'de-LI': 'de-CH' })
    expect(readMappingForm(form({ [fieldName('de-LI')]: 'de-LI' }), rows)).toBeNull()
    expect(readMappingForm(form({ [fieldName('de-LI')]: '<script>' }), rows)).toBeNull()
  })

  it('binds CSRF tokens to the session', () => {
    const csrf = new CsrfTokens()
    expect(csrf.verify('a', csrf.token('a'))).toBe(true)
    expect(csrf.verify('b', csrf.token('a'))).toBe(false)
    expect(csrf.verify('a', null)).toBe(false)
  })
})

describe('language mapping form on the status page', () => {
  const servers: Array<{ close: () => void }> = []
  afterEach(() => {
    for (const s of servers.splice(0)) s.close()
  })

  async function start(role: string) {
    const dir = mkdtempSync(join(tmpdir(), 'st-app-'))
    const config: Config = {
      connectorSettingsFile: join(dir, 'supertext-settings.json'),
      connectorUrl: null,
      ghostSecrets: () => ({ adminKey: '', webhookSecret: '' }),
      host: '127.0.0.1',
      jobsFile: null,
      languageMap: { fr: 'fr-CH' },
      languages: parseTargetLanguages('de, de-LI, fr', {}, { fr: 'fr-CH' }),
      port: 0,
      settingsFile: null,
      siteUrl: 'https://blog.example.com',
      sourceLanguage: 'en',
      stateFile: join(dir, 'supertext-state.json'),
      supertextApiKey: '',
      supertextApiUrl: 'https://api.test/v1/',
      uiLanguage: 'en',
      upstream: 'http://ghost.test',
      versionReports: false,
    }
    // Ghost's users/me: only a request with the staff session cookie is signed in.
    const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      const cookie = new Headers(init?.headers).get('cookie') ?? ''
      if (String(url).includes('/users/me/') && cookie.includes('ghost-admin-api-session=good')) {
        return Response.json({ users: [{ email: 'staff@example.com', name: 'Staff', roles: [{ name: role }] }] })
      }
      return new Response('{}', { status: 403 })
    }) as typeof globalThis.fetch
    const app = createApp(config, { fetch })
    await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
    servers.push(app.server)
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    return { app, base, file: config.connectorSettingsFile! }
  }

  const cookie = { cookie: 'ghost-admin-api-session=good' }
  const csrfOf = (html: string) => /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? ''
  const post = (base: string, body: Record<string, string>, headers: Record<string, string> = cookie) =>
    fetch(`${base}/ghost/supertext/settings`, {
      body: new URLSearchParams(body),
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      method: 'POST',
      redirect: 'manual',
    })

  it('shows one combo box per language and saves a valid choice', async () => {
    const { app, base, file } = await start('Administrator')
    const html = await (await fetch(`${base}/ghost/supertext/`, { headers: cookie })).text()
    expect(html).toContain('<h2>Language mapping</h2>')
    expect(html).toMatch(/<select id="map-de-li" name="code:de-li"><option value="" selected>— choose —<\/option>/)
    expect(html).toContain('<option value="de-DE" selected>German (Germany) (de-DE)</option>')
    expect(html).toMatch(/<select id="map-fr" name="code:fr" disabled>/)
    expect(html).toContain('Set by SUPERTEXT_LANGUAGE_MAP; change it there.')

    const res = await post(base, { csrf: csrfOf(html), 'code:de': 'de-AT', 'code:de-li': 'de-CH', 'code:fr': 'fr-FR' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('/ghost/supertext/?saved=1#mapping')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ languageCodes: { de: 'de-AT', 'de-LI': 'de-CH' } })
    expect(app.languages().map((l) => [l.code, l.target])).toEqual([
      ['de', 'de-AT'],
      ['de-LI', 'de-CH'],
      ['fr', 'fr-CH'],
    ])
  })

  it('refuses requests without a session, from non-administrators, without the token, cross-site or with a wrong code', async () => {
    const { base, file } = await start('Administrator')
    const html = await (await fetch(`${base}/ghost/supertext/`, { headers: cookie })).text()
    const csrf = csrfOf(html)
    expect((await post(base, { csrf, 'code:de-li': 'de-CH' }, {})).status).toBe(401)
    expect((await post(base, { 'code:de-li': 'de-CH' })).status).toBe(403)
    expect((await post(base, { csrf: 'forged', 'code:de-li': 'de-CH' })).status).toBe(403)
    expect((await post(base, { csrf, 'code:de-li': 'de-CH' }, { ...cookie, origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(base, { csrf, 'code:de-li': 'xx' })).status).toBe(400)
    expect(() => readFileSync(file)).toThrow()

    const editor = await start('Editor')
    const page = await (await fetch(`${editor.base}/ghost/supertext/`, { headers: cookie })).text()
    expect(page).toContain('Only Ghost administrators can change the language mapping.')
    expect(page).not.toContain('<button type="submit">')
    expect((await post(editor.base, { csrf: csrfOf(page), 'code:de-li': 'de-CH' })).status).toBe(403)
  })
})
