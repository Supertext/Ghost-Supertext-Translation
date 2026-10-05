import { createHmac, timingSafeEqual } from 'node:crypto'

import type { Resource } from './admin.js'

/**
 * Ghost signs webhook bodies when the webhook has a secret:
 *   X-Ghost-Signature: sha256=<hex HMAC-SHA256 of (raw body + timestamp)>, t=<ms timestamp>
 */
export function verifySignature(rawBody: string, header: string | undefined, secret: string, now = Date.now()): boolean {
  if (!header) return false
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=')
      return [k ?? '', v.join('=')]
    }),
  )
  const sig = parts.sha256
  const ts = parts.t
  if (!sig || !ts) return false
  // Reject replays older than 10 minutes.
  if (Math.abs(now - Number(ts)) > 10 * 60_000) return false
  const expected = createHmac('sha256', secret).update(`${rawBody}${ts}`).digest('hex')
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export type WebhookEvent = {
  resource: Resource
  id: string
  title: string
  /** Tag slugs that the save added. On `*.added` events: all tags. */
  addedTagSlugs: string[]
  /** All tag slugs after the save. */
  tagSlugs: string[]
}

type Snapshot = { id?: string; title?: string; tags?: Array<{ slug?: string }> }

/**
 * Reads a `post.added`, `post.edited`, `page.added` or `page.edited` payload. Ghost only
 * includes `previous.tags` when the tags changed, and the payload does not name the
 * event, so the webhook URL carries it (`?event=post.edited`).
 */
export function parseWebhook(body: unknown, event: string | null): WebhookEvent | null {
  if (typeof body !== 'object' || body === null) return null
  const key = 'post' in body ? 'post' : 'page' in body ? 'page' : null
  if (!key) return null
  const data = (body as Record<string, { current?: Snapshot; previous?: Snapshot }>)[key]
  const current = data?.current
  if (!current?.id) return null
  const slugs = (s?: Snapshot) => (s?.tags ?? []).map((t) => t.slug ?? '').filter(Boolean)
  const tagSlugs = slugs(current)
  let addedTagSlugs: string[] = []
  if (event?.endsWith('.added')) addedTagSlugs = tagSlugs
  else if (data?.previous && Array.isArray(data.previous.tags)) {
    const before = new Set(slugs(data.previous))
    addedTagSlugs = tagSlugs.filter((s) => !before.has(s))
  }
  return {
    addedTagSlugs,
    id: current.id,
    resource: key === 'post' ? 'posts' : 'pages',
    tagSlugs,
    title: current.title ?? '',
  }
}
