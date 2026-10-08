import http, { type IncomingMessage, type ServerResponse } from 'node:http'

import type { Config } from './config.js'
import { GhostAdmin, GhostError } from './ghost/admin.js'
import { parseWebhook, verifySignature } from './ghost/webhook.js'
import { JobLog } from './jobs.js'
import { format, isUiLocale, pickLocale, t, type UiLocale } from './i18n/index.js'
import { managedTags, requestsFromTags } from './languages.js'
import { renderStatusPage } from './status-page.js'
import { VERSION } from './version.js'
import { SupertextClient } from './supertext/client.js'
import { Translator } from './translate.js'

const log = (msg: string) => console.log(`[supertext] ${msg}`)

/** The staff-only status page (proxy mode). */
export const STATUS_PATH = '/ghost/supertext/'

export type App = {
  server: http.Server
  jobs: JobLog
  /** Resolves when every translation started so far has finished (tests). */
  idle: () => Promise<void>
  ensureTags: () => Promise<void>
}

export function createApp(config: Config, deps: { fetch?: typeof fetch; supertextPollMs?: number } = {}): App {
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
    const requests = requestsFromTags(event.addedTagSlugs, config.languages)
    if (!requests.length) return
    const g = ghost()
    if (!g) {
      log('Translation requested, but no Ghost Admin API key is configured')
      return
    }
    const translator = new Translator({ ghost: g, log, sourceLanguage: config.sourceLanguage, supertext })
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
      })
      pending.add(p)
      void p.finally(() => pending.delete(p))
    }
  }

  async function staffUser(req: IncomingMessage): Promise<{ name: string; email: string } | null> {
    if (!config.upstream || !req.headers.cookie) return null
    try {
      const res = await (deps.fetch ?? fetch)(`${config.upstream}/ghost/api/admin/users/me/`, {
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
      const user = ((await res.json()) as { users?: Array<{ name: string; email: string }> }).users?.[0]
      return user ?? null
    } catch {
      return null
    }
  }

  async function handleStatus(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!config.upstream) {
      return send(res, 404, 'The status page is only available when the connector runs in front of Ghost (GHOST_UPSTREAM).')
    }
    const user = await staffUser(req)
    if (!user) {
      res.writeHead(302, { Location: `${config.siteUrl}/ghost/#/signin` })
      return void res.end()
    }
    const locale = pickLocale(config.uiLanguage, header(req, 'accept-language'))
    const g = ghost()
    let ghostState = { detail: t(locale, 'page.noGhostKey'), ok: false }
    let siteTitle = new URL(config.siteUrl).host
    if (g) {
      try {
        const site = await g.site()
        siteTitle = site.title ?? siteTitle
        ghostState = { detail: `(Ghost ${site.version ?? ''})`.replace(' )', ')'), ok: true }
      } catch (err) {
        ghostState = { detail: err instanceof GhostError ? format(locale, err.localized) : err instanceof Error ? err.message : String(err), ok: false }
      }
    }
    const html = renderStatusPage({
      ghost: ghostState,
      jobs: jobs.list(),
      languages: config.languages,
      locale,
      siteTitle,
      siteUrl: config.siteUrl,
      sourceLanguage: config.sourceLanguage,
      supertext: { endpoint: config.supertextApiUrl, keyConfigured: Boolean(supertext) },
      version: VERSION,
      viewer: `${user.name} (${user.email})`,
      webhookSecret: Boolean(config.ghostSecrets().webhookSecret),
    })
    res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' })
    res.end(html)
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
      // Under /ghost/ so the browser sends Ghost's staff session cookie (its path is /ghost).
      if (path === STATUS_PATH || path === STATUS_PATH.slice(0, -1)) return handleStatus(req, res)
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
    server,
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
      `<!DOCTYPE html><html lang="${locale}"><meta charset="utf-8"><meta http-equiv="refresh" content="5"><p style="font-family:sans-serif">${t(locale, 'page.ghostStarting')}</p></html>`,
    )
  })
  req.pipe(up)
}
