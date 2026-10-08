import { createHmac } from 'node:crypto'

import { type Localizable, t } from '../i18n/index.js'

/**
 * Minimal Ghost Admin API client, authenticated with a custom integration's Admin API
 * key (`<id>:<secret>`) as a short-lived JWT, see
 * https://docs.ghost.org/admin-api/#token-authentication
 */

export type GhostPost = Record<string, unknown> & {
  id: string
  title: string
  status: string
  updated_at: string
  lexical?: string | null
  codeinjection_head?: string | null
  tags?: GhostTag[]
  authors?: Array<{ id: string; email?: string }>
  url?: string
  slug?: string
}
export type GhostTag = { id?: string; name: string; slug?: string; visibility?: string; description?: string | null }
export type Resource = 'posts' | 'pages'

export class GhostError extends Error {
  readonly status: number
  /** The message as a catalog key (src/i18n), so the status page can show it in its language. */
  readonly localized: Localizable[]
  constructor(message: Localizable, status: number) {
    super(t('en', message.key, message.params))
    this.name = 'GhostError'
    this.status = status
    this.localized = [message]
  }
}

export type GhostAdminOptions = {
  /** Where to send API requests, e.g. `https://blog.example.com` or (proxy mode) `http://127.0.0.1:2368`. */
  apiUrl: string
  /** `<id>:<secret>` from Ghost Admin → Settings → Integrations. */
  adminKey: string
  /**
   * Public site URL. When the API is reached through `apiUrl` on another host (proxy
   * mode), requests carry this host and `X-Forwarded-Proto` so Ghost does not redirect.
   */
  siteUrl?: string
  fetch?: typeof fetch
}

const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url')

/** Splits an Admin API key, tolerating a pasted `Ghost ` prefix and whitespace. */
export function parseAdminKey(key: string): { id: string; secret: string } {
  const [id, secret] = key.trim().replace(/^Ghost\s+/i, '').split(':')
  if (!id || !secret || !/^[0-9a-f]+$/i.test(secret)) {
    throw new Error('The Ghost Admin API key must look like <id>:<secret> (copy it from Settings → Integrations).')
  }
  return { id, secret }
}

export function adminToken(key: string, now = Date.now()): string {
  const { id, secret } = parseAdminKey(key)
  const iat = Math.floor(now / 1000)
  const unsigned = `${b64url({ alg: 'HS256', kid: id, typ: 'JWT' })}.${b64url({ aud: '/admin/', exp: iat + 300, iat })}`
  const sig = createHmac('sha256', Buffer.from(secret, 'hex')).update(unsigned).digest('base64url')
  return `${unsigned}.${sig}`
}

export class GhostAdmin {
  private readonly apiUrl: string
  private readonly key: string
  private readonly extraHeaders: Record<string, string>
  private readonly fetchImpl: typeof fetch

  constructor(options: GhostAdminOptions) {
    parseAdminKey(options.adminKey)
    this.apiUrl = options.apiUrl.replace(/\/+$/, '')
    this.key = options.adminKey
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.extraHeaders = {}
    if (options.siteUrl) {
      const site = new URL(options.siteUrl)
      if (site.host !== new URL(this.apiUrl).host) {
        this.extraHeaders.Host = site.host
        this.extraHeaders['X-Forwarded-Proto'] = site.protocol.replace(':', '')
        this.extraHeaders['X-Forwarded-Host'] = site.host
      }
    }
  }

  async request<T>(method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.apiUrl}/ghost/api/admin/${path.replace(/^\//, '')}`)
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    const res = await this.fetchImpl(url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        'Accept-Version': 'v6.0',
        Authorization: `Ghost ${adminToken(this.key)}`,
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
    const text = await res.text()
    if (!res.ok) {
      let message: Localizable = { key: 'ghost.http', params: { status: res.status } }
      try {
        const err = (JSON.parse(text) as { errors?: Array<{ message?: string; context?: string }> }).errors?.[0]
        if (err?.message) {
          const detail = `${err.message}${err.context ? ` (${err.context})` : ''}`
          message = { key: 'ghost.httpDetail', params: { detail, status: res.status } }
        }
      } catch {
        // not JSON
      }
      throw new GhostError(message, res.status)
    }
    return (text ? JSON.parse(text) : {}) as T
  }

  async getPost(resource: Resource, id: string): Promise<GhostPost> {
    const data = await this.request<Record<Resource, GhostPost[]>>('GET', `${resource}/${id}/`, undefined, {
      formats: 'lexical',
      include: 'tags,authors',
    })
    const post = data[resource]?.[0]
    if (!post) throw new GhostError({ key: resource === 'posts' ? 'ghost.noPost' : 'ghost.noPage', params: { id } }, 404)
    return post
  }

  async findPosts(resource: Resource, filter: string, fields?: string): Promise<GhostPost[]> {
    const query: Record<string, string> = { filter, formats: 'lexical', include: 'tags', limit: '50' }
    if (fields) query.fields = fields
    const data = await this.request<Record<Resource, GhostPost[]>>('GET', `${resource}/`, undefined, query)
    return data[resource] ?? []
  }

  async addPost(resource: Resource, post: Record<string, unknown>): Promise<GhostPost> {
    const data = await this.request<Record<Resource, GhostPost[]>>('POST', `${resource}/`, { [resource]: [post] }, { formats: 'lexical' })
    return data[resource]![0]!
  }

  async editPost(resource: Resource, id: string, post: Record<string, unknown>): Promise<GhostPost> {
    const data = await this.request<Record<Resource, GhostPost[]>>('PUT', `${resource}/${id}/`, { [resource]: [post] }, { formats: 'lexical' })
    return data[resource]![0]!
  }

  async listTags(filter: string): Promise<GhostTag[]> {
    const data = await this.request<{ tags: GhostTag[] }>('GET', 'tags/', undefined, { filter, limit: 'all' })
    return data.tags ?? []
  }

  async addTag(tag: GhostTag): Promise<GhostTag> {
    const data = await this.request<{ tags: GhostTag[] }>('POST', 'tags/', { tags: [tag] })
    return data.tags[0]!
  }

  /** Cheap authenticated call to check the key. */
  async site(): Promise<{ title?: string; version?: string; url?: string }> {
    const data = await this.request<{ site: { title?: string; version?: string; url?: string } }>('GET', 'site/')
    return data.site
  }
}
