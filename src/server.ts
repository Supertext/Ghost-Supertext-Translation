import http, { type IncomingMessage, type ServerResponse } from 'node:http'

import type { Config } from './config.js'
import { GhostAdmin, GhostError } from './ghost/admin.js'
import { parseWebhook, verifySignature } from './ghost/webhook.js'
import { JobLog } from './jobs.js'
import { format, isUiLocale, type MessageKey, pickLocale, t, type UiLocale } from './i18n/index.js'
import { type Language, managedTags, remapLanguages, requestsFromTags, sourceCodeOrNull } from './languages.js'
import { PING_PATH, Reporting } from './reporting.js'
import { CsrfTokens, effectiveMapping, mappingRows, readMappingForm, SettingsStore } from './settings.js'
import { renderStatusPage } from './status-page.js'
import { collect } from './collect.js'
import { buildExport, type Format, FilesError, importFile, type ImportJob, MAX_UPLOAD_BYTES } from './files.js'
import { renderFilesPage, type FilesPageData } from './files-page.js'
import type { Localizable } from './i18n/index.js'
import { readMarker } from './translate.js'
import { TranslationFileError } from './vendor/supertext-sdk/index.js'
import { fontFaces, STATIC_PATH, staticFile, staticUrl } from './static.js'
import { VERSION } from './version.js'
import { SupertextClient } from './supertext/client.js'
import { Translator } from './translate.js'

const log = (msg: string) => console.log(`[supertext] ${msg}`)

/** The staff-only status page (proxy mode). */
export const STATUS_PATH = '/ghost/supertext/'
/** The status page's settings form posts here (under /ghost/ for the staff session cookie). */
export const SETTINGS_PATH = `${STATUS_PATH}settings`
/** Ghost roles that may change the connector's settings. */
const ADMIN_ROLES = new Set(['Owner', 'Administrator'])
/** Translation files: the page, its export and its import (staff with EDITOR_ROLES). */
export const FILES_PATH = `${STATUS_PATH}files`
export const FILES_EXPORT_PATH = `${FILES_PATH}/export`
export const FILES_IMPORT_PATH = `${FILES_PATH}/import`
/** Ghost roles that may edit every post: they may export and import translation files. */
const EDITOR_ROLES = new Set(['Owner', 'Administrator', 'Editor'])

export type App = {
  server: http.Server
  jobs: JobLog
  /** Resolves when every translation started so far has finished (tests). */
  idle: () => Promise<void>
  ensureTags: () => Promise<void>
  /** Commando Center: version reports, API key check, ping. */
  reporting: Reporting
  /** The settings chosen on the status page (language mapping). */
  settings: SettingsStore
  /** The mapping in use (`SUPERTEXT_LANGUAGE_MAP` over the status page's choices) and the languages resolved with it. */
  languageMap: () => Record<string, string>
  languages: () => Language[]
}

export type AppDeps = {
  fetch?: typeof fetch
  supertextPollMs?: number
  /** Tests: options for the SDK's version reporter (fetch, report URL, clock). */
  reporterOverrides?: ConstructorParameters<typeof Reporting>[1]['reporterOverrides']
}

export function createApp(config: Config, deps: AppDeps = {}): App {
  const jobs = new JobLog(config.jobsFile)
  const pending = new Set<Promise<unknown>>()
  // Ghost is reached directly in proxy mode (no round trip through the public URL).
  const apiUrl = config.upstream ?? config.siteUrl

  const ghost = (): GhostAdmin | null => {
    const { adminKey } = config.ghostSecrets()
    if (!adminKey) return null
    return new GhostAdmin({ adminKey, apiUrl, fetch: deps.fetch, siteUrl: config.siteUrl })
  }
  const supertext = config.supertextApiKey
    ? new SupertextClient({
        apiKey: config.supertextApiKey,
        baseUrl: config.supertextApiUrl,
        fetch: deps.fetch,
        pollIntervalMs: deps.supertextPollMs,
      })
    : null

  // Ghost's version for the version reports, asked at most every 10 minutes.
  let ghostVersionCache: { at: number; version: string | null } | null = null
  const ghostVersion = async (): Promise<string | null> => {
    if (ghostVersionCache && Date.now() - ghostVersionCache.at < 600_000) return ghostVersionCache.version
    const g = ghost()
    let version: string | null = null
    if (g) version = (await g.site().catch(() => null))?.version ?? null
    ghostVersionCache = { at: Date.now(), version }
    return version
  }
  const settings = new SettingsStore(config.connectorSettingsFile ?? null, log)
  const csrf = new CsrfTokens()
  /** The mapping used now: `SUPERTEXT_LANGUAGE_MAP` wins, then the status page's combo boxes. */
  const languageMap = () => effectiveMapping(settings.load().languageCodes, config.languageMap)
  const languages = () => remapLanguages(config.languages, languageMap())
  const rows = () => mappingRows(config.sourceLanguage, config.languages.map((l) => l.code), settings.load().languageCodes, config.languageMap)

  const reporting = new Reporting(config, { fetch: deps.fetch, ghostVersion, log, reporterOverrides: deps.reporterOverrides })
  /** Reporter runs in the background; tracked so `idle()` (tests, shutdown) can wait for them. */
  const report = (action: 'onRequest' | 'authenticationFailed', httpStatus?: number) => {
    const p = reporting.inBackground(action, httpStatus)
    pending.add(p)
    void p.finally(() => pending.delete(p))
  }

  async function ensureTags(): Promise<void> {
    const g = ghost()
    if (!g) throw new Error('No Ghost Admin API key yet')
    const existing = new Set((await g.listTags('visibility:internal')).map((t) => t.name.toLowerCase()))
    // Descriptions in UI_LANGUAGE if it names a language, else English. Existing tags are left as they are.
    const tagLocale: UiLocale = isUiLocale(config.uiLanguage) ? config.uiLanguage : 'en'
    for (const t of managedTags(config.languages, config.upstream ? `${config.siteUrl}${STATUS_PATH}` : undefined, tagLocale)) {
      if (existing.has(t.name.toLowerCase())) continue
      await g.addTag({ description: t.description, name: t.name })
      log(`Created tag ${t.name}`)
    }
  }

  async function handleWebhook(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const raw = await readBody(req)
    const { webhookSecret } = config.ghostSecrets()
    if (webhookSecret && !verifySignature(raw, header(req, 'x-ghost-signature'), webhookSecret)) {
      log('Rejected a webhook with a missing or wrong signature')
      return send(res, 401, 'Invalid signature')
    }
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return send(res, 400, 'Invalid JSON')
    }
    const event = parseWebhook(body, url.searchParams.get('event'))
    send(res, 202, 'Accepted')
    if (!event) return
    const requests = requestsFromTags(event.addedTagSlugs, languages())
    if (!requests.length) return
    const g = ghost()
    if (!g) {
      log('Translation requested, but no Ghost Admin API key is configured')
      return
    }
    const translator = new Translator({ ghost: g, languageMap: languageMap(), log, sourceLanguage: config.sourceLanguage, supertext })
    for (const { force, language } of requests) {
      if (jobs.isRunning(event.id, language.code)) continue
      const job = jobs.start({
        force,
        language: language.code,
        languageLabel: language.label,
        postId: event.id,
        postTitle: event.title,
        resource: event.resource,
      })
      log(`#${job.id} ${event.resource} ${event.id} → ${language.code}${force ? ' (retranslate)' : ''}`)
      const p = translator.translate(event.resource, event.id, language, force).then((result) => {
        jobs.finish(job, result)
        log(`#${job.id} ${result.status}: ${result.message}`)
        if (result.missing?.length) log(`#${job.id} empty in the response: ${result.missing.join(', ')}`)
        // Commando Center: a rejected key marks the key check invalid; otherwise check for upgrades / a changed key.
        if (result.errorCode === 'authentication_failure') report('authenticationFailed', result.httpStatus ?? 401)
        else report('onRequest')
      })
      pending.add(p)
      void p.finally(() => pending.delete(p))
    }
  }

  /** The signed-in Ghost staff user (Ghost checks the session cookie), with roles and a session key for CSRF tokens. */
  async function staffUser(req: IncomingMessage): Promise<{ name: string; email: string; admin: boolean; editor: boolean; session: string } | null> {
    if (!config.upstream || !req.headers.cookie) return null
    try {
      const res = await (deps.fetch ?? fetch)(`${config.upstream}/ghost/api/admin/users/me/?include=roles`, {
        headers: {
          Accept: 'application/json',
          'Accept-Version': 'v6.0',
          Cookie: req.headers.cookie,
          Origin: config.siteUrl,
          'X-Forwarded-Host': new URL(config.siteUrl).host,
          'X-Forwarded-Proto': new URL(config.siteUrl).protocol.replace(':', ''),
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) return null
      const user = ((await res.json()) as { users?: Array<{ name: string; email: string; roles?: Array<{ name?: string }> }> }).users?.[0]
      if (!user) return null
      const cookie = req.headers.cookie
      const session = /(?:^|;\s*)ghost-admin-api-session=([^;]+)/.exec(cookie)?.[1] ?? cookie
      return {
        admin: (user.roles ?? []).some((r) => ADMIN_ROLES.has(r.name ?? '')),
        editor: (user.roles ?? []).some((r) => EDITOR_ROLES.has(r.name ?? '')),
        email: user.email,
        name: user.name,
        session: `${user.email}\n${session}`,
      }
    } catch {
      return null
    }
  }

  /** Saves the language mapping: Ghost administrators only, with the page's CSRF token and a same-origin request. */
  async function handleSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!config.upstream) return send(res, 404, 'Not found')
    const locale = pickLocale(config.uiLanguage, header(req, 'accept-language'))
    const refuse = (status: number, key: MessageKey) => send(res, status, t(locale, key))
    const user = await staffUser(req)
    if (!user) return refuse(401, 'page.mappingSignIn')
    if (!user.admin) return refuse(403, 'page.mappingAdminOnly')
    const origin = header(req, 'origin')
    if (origin && origin !== new URL(config.siteUrl).origin) return refuse(403, 'page.mappingCrossSite')
    let form: URLSearchParams
    try {
      form = new URLSearchParams(await readBody(req, 100_000))
    } catch {
      return refuse(413, 'page.mappingTooLarge')
    }
    if (!csrf.verify(user.session, form.get('csrf'))) return refuse(403, 'page.mappingExpired')
    const codes = readMappingForm(form, rows())
    if (!codes) return refuse(400, 'page.mappingInvalid')
    const stored = settings.save({ ...settings.load(), languageCodes: codes })
    log(`Language mapping saved by ${user.email}: ${Object.entries(codes).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`)
    res.writeHead(303, { 'Cache-Control': 'no-store', Location: `${STATUS_PATH}?saved=${stored ? '1' : 'memory'}#mapping` })
    res.end()
  }

  async function handleStatus(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!config.upstream) {
      return send(res, 404, 'The status page is only available when the connector runs in front of Ghost (GHOST_UPSTREAM).')
    }
    const user = await staffUser(req)
    if (!user) {
      res.writeHead(302, { Location: `${config.siteUrl}/ghost/#/signin` })
      return void res.end()
    }
    report('onRequest')
    const locale = pickLocale(config.uiLanguage, header(req, 'accept-language'))
    const g = ghost()
    let ghostState = { detail: t(locale, 'page.noGhostKey'), ok: false }
    let siteTitle = new URL(config.siteUrl).host
    if (g) {
      try {
        const site = await g.site()
        siteTitle = site.title ?? siteTitle
        if (site.version) ghostVersionCache = { at: Date.now(), version: site.version }
        ghostState = { detail: `(Ghost ${site.version ?? ''})`.replace(' )', ')'), ok: true }
      } catch (err) {
        ghostState = { detail: err instanceof GhostError ? format(locale, err.localized) : err instanceof Error ? err.message : String(err), ok: false }
      }
    }
    const html = renderStatusPage({
      ghost: ghostState,
      jobs: jobs.list(),
      languages: languages(),
      locale,
      mapping: {
        canEdit: user.admin,
        csrf: csrf.token(user.session),
        formAction: SETTINGS_PATH,
        persistent: Boolean(settings.file),
        rows: rows(),
        saved: url.searchParams.get('saved') === '1' ? 'saved' : url.searchParams.get('saved') === 'memory' ? 'memory' : null,
      },
      reports: { callbackUrl: reporting.callbackUrl, check: reporting.lastCheck(), enabled: reporting.enabled },
      siteTitle,
      siteUrl: config.siteUrl,
      sourceLanguage: config.sourceLanguage,
      sourceTarget: sourceCodeOrNull(config.sourceLanguage, languageMap()),
      supertext: { endpoint: config.supertextApiUrl, keyConfigured: Boolean(supertext) },
      version: VERSION,
      viewer: `${user.name} (${user.email})`,
      filesUrl: FILES_PATH,
      webhookSecret: Boolean(config.ghostSecrets().webhookSecret),
    })
    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  }

  // --- Translation files: Export for translation / Import translation (src/files.ts) -----------

  type FilesState = { error?: Localizable | null; jobs?: ImportJob[] | null; selected?: FilesPageData['selected'] }

  /** The translation files page (staff session; export and import for EDITOR_ROLES). */
  async function renderFiles(req: IncomingMessage, res: ServerResponse, user: NonNullable<Awaited<ReturnType<typeof staffUser>>>, state: FilesState = {}, status = 200): Promise<void> {
    const locale = pickLocale(config.uiLanguage, header(req, 'accept-language'))
    const g = ghost()
    const items: FilesPageData['items'] = []
    let siteTitle = new URL(config.siteUrl).host
    if (g) {
      siteTitle = (await g.site().catch(() => null))?.title ?? siteTitle
      for (const resource of ['posts', 'pages'] as const) {
        const list = await g.listPosts(resource).catch(() => [])
        for (const p of list) {
          if (readMarker(p.codeinjection_head)) continue
          items.push({ kind: resource === 'pages' ? 'page' : 'post', status: String(p.status ?? ''), title: String(p.title ?? ''), value: `${resource}:${p.id}` })
        }
      }
    }
    const html = renderFilesPage({
      canUse: user.editor,
      csrf: csrf.token(user.session),
      error: state.error ?? null,
      exportAction: FILES_EXPORT_PATH,
      importAction: FILES_IMPORT_PATH,
      items,
      jobs: state.jobs ?? null,
      languages: languages(),
      locale,
      selected: state.selected,
      siteTitle,
      siteUrl: config.siteUrl,
      statusUrl: STATUS_PATH,
      version: VERSION,
    })
    res.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
  }

  /** Signed-in staff for the files page; for POSTs also an editor role, a same-origin request (CSRF token checked by the caller). */
  async function filesUser(req: IncomingMessage, res: ServerResponse, post: boolean) {
    if (!config.upstream) {
      send(res, 404, 'Not found')
      return null
    }
    const user = await staffUser(req)
    if (!user) {
      if (post) send(res, 401, t(pickLocale(config.uiLanguage, header(req, 'accept-language')), 'page.mappingSignIn'))
      else {
        res.writeHead(302, { Location: `${config.siteUrl}/ghost/#/signin` })
        res.end()
      }
      return null
    }
    if (post) {
      const locale = pickLocale(config.uiLanguage, header(req, 'accept-language'))
      if (!user.editor) {
        send(res, 403, t(locale, 'files.editorsOnly'))
        return null
      }
      const origin = header(req, 'origin')
      if (origin && origin !== new URL(config.siteUrl).origin) {
        send(res, 403, t(locale, 'page.mappingCrossSite'))
        return null
      }
    }
    return user
  }

  async function handleExport(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = await filesUser(req, res, true)
    if (!user) return
    let form: URLSearchParams
    try {
      form = new URLSearchParams(await readBody(req, 100_000))
    } catch {
      return send(res, 413, t(pickLocale(config.uiLanguage, header(req, 'accept-language')), 'page.mappingTooLarge'))
    }
    if (!csrf.verify(user.session, form.get('csrf'))) return send(res, 403, t(pickLocale(config.uiLanguage, header(req, 'accept-language')), 'page.mappingExpired'))
    const item = form.get('item') ?? ''
    const fmt: Format = form.get('format') === 'html' ? 'html' : 'xliff'
    const codes = form.getAll('target')
    const selected = { format: fmt, item, targets: codes }
    try {
      const m = /^(posts|pages):([0-9a-f]{1,64})$/.exec(item)
      const g = ghost()
      if (!m || !g) throw new FilesError('not_found')
      const resource = m[1] as 'posts' | 'pages'
      const source = await g.getPost(resource, m[2]!).catch((err) => {
        if (err instanceof GhostError && err.status === 404) throw new FilesError('not_found')
        throw err
      })
      if ((source.tags ?? []).some((tg) => (tg.slug ?? '').startsWith('hash-lang-')) || readMarker(source.codeinjection_head)) throw new FilesError('is_translation')
      const targets = languages().filter((l) => codes.includes(l.code))
      const file = buildExport({
        format: fmt,
        id: source.id as string,
        languageMap: languageMap(),
        resource,
        segments: collect(source).segments,
        sourceLanguage: config.sourceLanguage,
        targets,
      })
      log(`Exported ${resource} ${source.id} for ${targets.map((l) => l.code).join(', ')} as ${fmt} (${user.email})`)
      report('onRequest')
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Content-Type': file.contentType,
        'X-Content-Type-Options': 'nosniff',
      })
      res.end(file.content)
    } catch (err) {
      if (!(err instanceof FilesError)) throw err
      await renderFiles(req, res, user, { error: err.localized, selected }, err.status)
    }
  }

  async function handleImport(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const user = await filesUser(req, res, true)
    if (!user) return
    const tooLarge = () => renderFiles(req, res, user, { error: new FilesError('too_large').localized }, 413)
    // The form adds a few hundred bytes around the file: refuse anything clearly larger before reading.
    if (Number(header(req, 'content-length') ?? 0) > MAX_UPLOAD_BYTES + 100_000) {
      req.resume()
      return tooLarge()
    }
    let raw: Buffer
    try {
      raw = await readRaw(req, MAX_UPLOAD_BYTES + 100_000)
    } catch {
      return tooLarge()
    }
    let form: FormData
    try {
      form = await new Request('http://connector/', { body: new Uint8Array(raw), headers: { 'content-type': header(req, 'content-type') ?? '' }, method: 'POST' }).formData()
    } catch {
      return renderFiles(req, res, user, { error: new FilesError('no_file').localized }, 400)
    }
    if (!csrf.verify(user.session, typeof form.get('csrf') === 'string' ? (form.get('csrf') as string) : null)) {
      return send(res, 403, t(pickLocale(config.uiLanguage, header(req, 'accept-language')), 'page.mappingExpired'))
    }
    const upload = form.get('file')
    if (!upload || typeof upload === 'string' || upload.size === 0) return renderFiles(req, res, user, { error: new FilesError('no_file').localized }, 400)
    if (upload.size > MAX_UPLOAD_BYTES) return tooLarge()
    const g = ghost()
    if (!g) return renderFiles(req, res, user, { error: { key: 'page.noGhostKey' } }, 503)
    const overwrite = form.get('overwrite') === '1'
    const translator = new Translator({ ghost: g, languageMap: languageMap(), log, sourceLanguage: config.sourceLanguage, supertext })
    try {
      const jobsDone = await importFile(await upload.text(), {
        includeChanged: form.get('includeChanged') === '1',
        languages: languages(),
        load: async (ref) => {
          const post = await g.getPost(ref.resource, ref.id).catch((err) => {
            if (err instanceof GhostError && err.status === 404) return null
            throw err
          })
          if (!post || readMarker(post.codeinjection_head)) return null
          return { segments: collect(post).segments, title: String(post.title ?? '') }
        },
        write: async (ref, language, translations) => {
          const title = (await g.getPost(ref.resource, ref.id).catch(() => null))?.title
          const job = jobs.start({ force: overwrite, language: language.code, languageLabel: language.label, postId: ref.id, postTitle: String(title ?? ''), resource: ref.resource })
          const result = await translator.importTranslations(ref.resource, ref.id, language, overwrite, translations)
          jobs.finish(job, result)
          log(`#${job.id} import ${result.status}: ${result.message} (${user.email})`)
          return result
        },
      })
      report('onRequest')
      await renderFiles(req, res, user, { jobs: jobsDone })
    } catch (err) {
      if (err instanceof FilesError || err instanceof TranslationFileError) {
        const status = err.code === 'too_large' ? 413 : 400
        return renderFiles(req, res, user, { error: { key: `files.error.${err.code}` as Localizable['key'] } }, status)
      }
      throw err
    }
  }

  async function handleHealth(res: ServerResponse): Promise<void> {
    if (config.upstream) {
      try {
        const r = await (deps.fetch ?? fetch)(`${config.upstream}/ghost/api/admin/site/`, {
          headers: {
            'X-Forwarded-Host': new URL(config.siteUrl).host,
            'X-Forwarded-Proto': new URL(config.siteUrl).protocol.replace(':', ''),
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
        })
        if (r.status >= 500) return send(res, 503, 'Ghost is not ready')
      } catch {
        return send(res, 503, 'Ghost is not ready')
      }
    }
    send(res, 200, 'ok')
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const run = async () => {
      if (path === '/supertext/webhook' && req.method === 'POST') return handleWebhook(req, res, url)
      if (path === '/supertext/health') return handleHealth(res)
      // Public, no login, never proxied or cached: the Commando Center checks that the connector is reachable.
      if (path === PING_PATH) {
        if (req.method !== 'GET') {
          res.writeHead(405, { Allow: 'GET', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
          return void res.end('Method not allowed')
        }
        const answer = reporting.ping(url.searchParams.get('challenge'))
        res.writeHead(answer.status, answer.headers)
        return void res.end(answer.body)
      }
      // Logo, favicon and fonts of the connector's pages: never proxied, cached for a year (URLs carry ?v=<version>).
      if (path.startsWith(STATIC_PATH) && (req.method === 'GET' || req.method === 'HEAD')) {
        const file = staticFile(path.slice(STATIC_PATH.length))
        if (!file) return send(res, 404, 'Not found')
        res.writeHead(200, {
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Length': file.body.length,
          'Content-Type': file.type,
          'X-Content-Type-Options': 'nosniff',
        })
        return void res.end(req.method === 'HEAD' ? undefined : file.body)
      }
      // Under /ghost/ so the browser sends Ghost's staff session cookie (its path is /ghost).
      if (path === STATUS_PATH || path === STATUS_PATH.slice(0, -1)) return handleStatus(req, res, url)
      if (path === SETTINGS_PATH) {
        if (req.method !== 'POST') {
          res.writeHead(303, { Location: STATUS_PATH })
          return void res.end()
        }
        return handleSettings(req, res)
      }
      if (path === FILES_PATH || path === `${FILES_PATH}/`) {
        const user = await filesUser(req, res, false)
        if (user) await renderFiles(req, res, user)
        return
      }
      if (path === FILES_EXPORT_PATH || path === FILES_IMPORT_PATH) {
        if (req.method !== 'POST') {
          res.writeHead(303, { Location: FILES_PATH })
          return void res.end()
        }
        return path === FILES_EXPORT_PATH ? handleExport(req, res) : handleImport(req, res)
      }
      if (path === '/supertext' || path === '/supertext/') {
        res.writeHead(302, { Location: STATUS_PATH })
        return void res.end()
      }
      if (config.upstream) return proxy(req, res, config.upstream, config.uiLanguage)
      send(res, 404, 'Not found')
    }
    run().catch((err) => {
      log(`Request ${req.method} ${path} failed: ${err instanceof Error ? err.stack : String(err)}`)
      if (!res.headersSent) send(res, 500, 'Internal error')
      else res.end()
    })
  })

  return {
    ensureTags,
    idle: async () => {
      while (pending.size) await Promise.allSettled([...pending])
    },
    jobs,
    languageMap,
    languages,
    reporting,
    server,
    settings,
  }
}

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

/** The request body as bytes, refused above `limit` (kept in memory only). */
function readRaw(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    req.on('data', (c: Buffer) => {
      if (done) return
      size += c.length
      if (size > limit) {
        done = true
        req.resume()
        reject(new Error('Body too large'))
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

function readBody(req: IncomingMessage, limit = 5_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('Webhook body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Streams the request to Ghost and the answer back, unchanged. */
function proxy(req: IncomingMessage, res: ServerResponse, upstream: string, uiLanguage: string): void {
  const target = new URL(upstream)
  const forwardedFor = [header(req, 'x-forwarded-for'), req.socket.remoteAddress].filter(Boolean).join(', ')
  const up = http.request(
    {
      headers: { ...req.headers, 'x-forwarded-for': forwardedFor },
      hostname: target.hostname,
      method: req.method,
      path: req.url,
      port: target.port || 80,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.rawHeaders)
      upRes.pipe(res)
    },
  )
  up.on('error', () => {
    if (res.headersSent) return void res.end()
    res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '5' })
    const locale = pickLocale(uiLanguage, header(req, 'accept-language'))
    res.end(
      `<!DOCTYPE html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="5"><link rel="icon" href="${staticUrl('favicon.svg', VERSION)}" type="image/svg+xml"><style>${fontFaces(VERSION)}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f5f3;color:#003230;font:16px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}p{margin:0 16px}</style><p>${t(locale, 'page.ghostStarting')}</p></html>`,
    )
  })
  req.pipe(up)
}
