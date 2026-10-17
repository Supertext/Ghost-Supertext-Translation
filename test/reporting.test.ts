import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Config } from '../src/config.js'
import { parseTargetLanguages } from '../src/languages.js'
import { callbackUrl, PLUGIN_NAME, Reporting, StateStore } from '../src/reporting.js'
import { renderStatusPage, type StatusPageData } from '../src/status-page.js'
import { SDK_VERSION } from '../src/vendor/supertext-sdk/index.js'
import { apiKeyFingerprint } from '../src/vendor/supertext-sdk/v1/index.js'
import { VERSION } from '../src/version.js'
import { fakeSupertext } from './fakeSupertext.js'

const CHALLENGE = 'abcdefghijklmnop1234'

const config = (extra: Partial<Config> = {}): Config => ({
  connectorUrl: null,
  ghostSecrets: () => ({ adminKey: '', webhookSecret: '' }),
  host: '127.0.0.1',
  jobsFile: null,
  languageMap: {},
  languages: parseTargetLanguages('de-CH'),
  port: 0,
  settingsFile: null,
  siteUrl: 'https://blog.example.com',
  sourceLanguage: 'en',
  stateFile: null,
  supertextApiKey: 'test-key',
  supertextApiUrl: 'https://api.test/v1/',
  uiLanguage: 'en',
  upstream: 'http://127.0.0.1:2368',
  versionReports: true,
  ...extra,
})

/** A stand-in for the Commando Center: stores report bodies, answers 202 (or `status`). */
function fakeCenter(status = 202) {
  const reports: Array<Record<string, any>> = []
  const raw: string[] = []
  const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    raw.push(String(init?.body))
    reports.push(JSON.parse(String(init?.body)))
    return new Response('{"ok":true}', { status })
  }) as typeof globalThis.fetch
  return { fetch, raw, reports }
}

function reporting(extra: Partial<Config> = {}, opts: { center?: ReturnType<typeof fakeCenter>; ghostVersion?: () => Promise<string | null> } = {}) {
  const st = fakeSupertext()
  const center = opts.center ?? fakeCenter()
  const r = new Reporting(config(extra), {
    fetch: st.fetch,
    ghostVersion: opts.ghostVersion ?? (async () => '6.67'),
    reporterOverrides: { fetch: center.fetch, reportUrl: 'https://center.test/api/v1/report' },
  })
  return { center, r, st }
}

describe('ping address', () => {
  it('is on the site host in setup A, on CONNECTOR_URL in setup B, else none', () => {
    expect(callbackUrl(config())).toBe('https://blog.example.com/supertext/ping')
    expect(callbackUrl(config({ siteUrl: 'https://example.com/blog' }))).toBe('https://example.com/supertext/ping')
    expect(callbackUrl(config({ connectorUrl: 'https://supertext.blog.example.com', upstream: null }))).toBe('https://supertext.blog.example.com/supertext/ping')
    expect(callbackUrl(config({ upstream: null }))).toBeNull()
  })
})

describe('ping answer', () => {
  it('echoes a valid challenge only while reports are on', () => {
    const { r } = reporting()
    expect(r.ping(CHALLENGE)).toEqual({
      body: JSON.stringify({ ok: true, plugin: PLUGIN_NAME, challenge: CHALLENGE }),
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
      status: 200,
    })
    expect(r.ping('<script>').status).toBe(400)
    expect(r.ping(null).status).toBe(400)
    expect(reporting({ versionReports: false }).r.ping(CHALLENGE).status).toBe(404)
  })
})

describe('state', () => {
  it('is kept in STATE_FILE', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'st-')), 'sub', 'state.json')
    const { r } = reporting({ stateFile: file })
    await r.run('onRequest')
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    expect(saved).toMatchObject({ keyCheck: { status: 'ok' }, reportedKeyStatus: 'ok', reportedVersions: `${VERSION}|6.67|${process.versions.node}` })
    expect(readFileSync(file, 'utf8')).not.toContain('test-key')
    expect(new StateStore(file).load().keyCheck?.status).toBe('ok')
  })

  it('reads a broken file as empty and survives an unwritable path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'st-'))
    writeFileSync(join(dir, 'broken.json'), '{nope')
    expect(new StateStore(join(dir, 'broken.json')).load().reportedVersions).toBeNull()
    const blocked = new StateStore(join(dir, 'broken.json', 'state.json'))
    expect(() => blocked.save({ keyCheck: null, lastFailureAt: null, reportedKeyStatus: 'ok', reportedVersions: 'x' })).not.toThrow()
    expect(blocked.load().reportedVersions).toBe('x') // kept in memory
  })
})

describe('reports', () => {
  it('reports installed once, with the key check and the ping address, never the key', async () => {
    const { center, r, st } = reporting()
    const first = await r.run('onRequest')
    expect(first).toMatchObject({ event: 'installed', sent: true, check: { status: 'ok' } })
    expect(center.reports).toHaveLength(1)
    expect(center.reports[0]).toMatchObject({
      api_key_check: { http_status: 200, status: 'ok' },
      api_key_configured: true,
      callback: { url: 'https://blog.example.com/supertext/ping' },
      event: 'installed',
      plugin: { name: 'Ghost-Supertext-Translation', version: VERSION },
      schema: 1,
      sdk_version: SDK_VERSION,
      site_url: 'https://blog.example.com',
      system: { name: 'Ghost', version: '6.67' },
    })
    expect(center.raw[0]).not.toContain('test-key')
    expect(st.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET https://api.test/v1/features'])

    // Nothing changed: no report, no new key check.
    expect(await r.run('onRequest')).toMatchObject({ event: null, sent: false })
    expect(center.reports).toHaveLength(1)
    expect(st.calls).toHaveLength(1)
  })

  it('keeps the state the SDK 0.2 reporter stored: no new installed report', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'st-state-')), 'state.json')
    const { center, r, st } = reporting({ stateFile: file })
    const versions = r.reporter('6.67').versions
    const keyCheck = { checkedAt: '2026-10-01T08:00:00Z', errorCode: null, fingerprint: apiKeyFingerprint('test-key'), httpStatus: 200, status: 'ok' }
    const old = { reportedVersions: versions, reportedKeyStatus: 'ok', lastFailureAt: null, keyCheck }
    writeFileSync(file, JSON.stringify(old))
    expect(await r.run('onRequest')).toMatchObject({ event: null, sent: false })
    expect(center.reports).toHaveLength(0)
    expect(st.calls).toHaveLength(0)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(old)
  })

  it('reports an upgrade when the Ghost version changes, but not while Ghost is unreachable', async () => {
    let version: string | null = '6.67'
    const { center, r } = reporting({}, { ghostVersion: async () => version })
    await r.run('onRequest')
    version = null
    expect((await r.run('onRequest'))?.event).toBeNull()
    version = '6.70'
    expect((await r.run('onRequest'))?.event).toBe('upgraded')
    expect(center.reports.map((x) => x.event)).toEqual(['installed', 'upgraded'])
  })

  it('reports a rejected key once', async () => {
    const { center, r } = reporting()
    await r.run('onRequest')
    expect(await r.run('authenticationFailed', 401)).toMatchObject({ event: 'api_key_check', check: { status: 'invalid', httpStatus: 401 } })
    expect((await r.run('authenticationFailed', 401))?.event).toBeNull()
    expect(center.reports.map((x) => x.event)).toEqual(['installed', 'api_key_check'])
    expect(r.lastCheck()?.status).toBe('invalid')
  })

  it('checks a missing key without calling Supertext', async () => {
    const { r, st } = reporting({ supertextApiKey: '' })
    expect((await r.run('onRequest'))?.check?.status).toBe('missing')
    expect(st.calls).toHaveLength(0)
  })

  it('sends nothing with reports off, but still checks the key', async () => {
    const { center, r } = reporting({ versionReports: false })
    expect(await r.run('onRequest')).toMatchObject({ event: null, sent: false, check: { status: 'ok' } })
    expect(center.reports).toHaveLength(0)
  })

  it('never throws: a failing center or Ghost only skips the report', async () => {
    const broken = { ...fakeCenter(), fetch: (async () => Promise.reject(new Error('down'))) as typeof fetch }
    const { r } = reporting({}, { center: broken as ReturnType<typeof fakeCenter>, ghostVersion: async () => Promise.reject(new Error('ghost down')) })
    const result = await r.run('onRequest')
    expect(result).toMatchObject({ event: 'installed', sent: false })
    expect(result?.state.lastFailureAt).not.toBeNull()
  })
})

describe('status page', () => {
  const page = (reports: StatusPageData['reports'], locale: StatusPageData['locale'] = 'en') =>
    renderStatusPage({
      ghost: { detail: '', ok: true },
      jobs: [],
      languages: parseTargetLanguages('de-LI,de-CH,en-US', { 'en-us': 'more' }),
      locale,
      reports,
      siteTitle: 'Demo',
      siteUrl: 'https://blog.example.com',
      sourceLanguage: 'en',
      sourceTarget: 'en',
      supertext: { endpoint: 'https://api.supertext.com/v1/', keyConfigured: true },
      version: '0.1.0',
      viewer: 'x',
      webhookSecret: true,
    })

  it('shows the latest key check with its time and the reporting setting', () => {
    const html = page({ callbackUrl: 'https://blog.example.com/supertext/ping', check: { checkedAt: '2026-10-14T08:00:00Z', errorCode: null, fingerprint: 'f', httpStatus: 200, status: 'ok' }, enabled: true })
    expect(html).toContain('<dt>API key check</dt><dd><span class="ok">API key checked: the connection to Supertext works.</span> <span class="muted">checked 2026-10-14 08:00 UTC</span></dd>')
    expect(html).toContain('<dt>Send version information to Supertext</dt><dd>On <span class="muted">· Ping address: https://blog.example.com/supertext/ping</span>')
  })

  it('adds the account and API key links to a rejected key, in the reader’s language', () => {
    const html = page({ callbackUrl: null, check: { checkedAt: '2026-10-14T08:00:00Z', errorCode: null, fingerprint: 'f', httpStatus: 401, status: 'invalid' }, enabled: false }, 'de')
    expect(html).toContain('Supertext hat den API-Schlüssel abgelehnt.')
    expect(html).toContain('href="https://www.supertext.com/en/integrations/api" target="_blank" rel="noopener"')
    expect(html).toContain('Aus (SUPERTEXT_VERSION_REPORTS=0)')
  })

  it('says when the key was not checked yet', () => {
    expect(page({ callbackUrl: null, check: null, enabled: true })).toContain('Not checked yet.')
  })

  it('marks unmapped languages and a tone the target lacks', () => {
    const html = page(undefined)
    expect(html).toContain('German (Liechtenstein) <span class="bad">No Supertext language: choose one under Language mapping</span>')
    expect(html).toContain('Supertext offers no formal/informal choice for this language: remove it from SUPERTEXT_POLITENESS')
  })
})
