/**
 * In-memory stand-in for the parts of Ghost's Admin API the connector uses. Mirrors the
 * behaviour checked against Ghost 6: `#name` tags are internal with slug `hash-name`,
 * `codeinjection_head:~'…'` filters by substring, and a PUT whose `updated_at` is stale
 * fails with an update collision.
 */
export type FakePost = Record<string, any> & { id: string; title: string; status: string; updated_at: string }

export function fakeGhost(opts: { normalizeLexical?: boolean } = {}) {
  const posts = new Map<string, FakePost & { resource: string }>()
  const tags = new Map<string, { id: string; name: string; slug: string; visibility: string; description?: string | null }>()
  const calls: Array<{ method: string; path: string }> = []
  let n = 0
  let clock = Date.parse('2026-10-05T10:00:00Z')
  const id = () => (++n).toString(16).padStart(24, '0')
  const tick = () => new Date((clock += 1000)).toISOString()

  const tagFor = (t: { id?: string; name?: string }) => {
    if (t.id && tags.has(t.id)) return tags.get(t.id)!
    const name = t.name!
    const existing = [...tags.values()].find((x) => x.name.toLowerCase() === name.toLowerCase())
    if (existing) return existing
    const internal = name.startsWith('#')
    const tag: { id: string; name: string; slug: string; visibility: string; description?: string | null } = {
      id: id(),
      name,
      slug: (internal ? `hash-${name.slice(1)}` : name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      visibility: internal ? 'internal' : 'public',
    }
    tags.set(tag.id, tag)
    return tag
  }

  const store = (resource: string, data: Record<string, any>, existing?: FakePost) => {
    const post: any = { ...(existing ?? { authors: [{ email: 'owner@example.com', id: 'u1' }], id: id(), resource, status: 'draft' }) }
    for (const [k, v] of Object.entries(data)) {
      if (k === 'tags') post.tags = (v as any[]).map(tagFor)
      else if (k !== 'updated_at') post[k] = v
    }
    if (opts.normalizeLexical && typeof post.lexical === 'string') post.lexical = JSON.stringify(JSON.parse(post.lexical), null, 1)
    post.updated_at = tick()
    if (!post.slug) post.slug = String(post.title).toLowerCase().replace(/[^a-z0-9]+/g, '-')
    posts.set(post.id, post)
    return post
  }

  const json = (status: number, body: unknown) => Response.json(body, { status })
  const out = ({ resource, ...p }: any) => p

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const path = url.pathname.replace(/^\/ghost\/api\/admin\//, '')
    calls.push({ method, path })
    if (!new Headers(init?.headers).get('Authorization')?.startsWith('Ghost ey')) {
      return json(401, { errors: [{ message: 'Authorization failed' }] })
    }
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const m = path.match(/^(posts|pages)\/(?:([0-9a-f]+)\/)?$/)
    if (m) {
      const [, resource, pid] = m as [string, string, string | undefined]
      if (method === 'GET' && pid) {
        const p = posts.get(pid)
        return p && p.resource === resource ? json(200, { [resource]: [out(p)] }) : json(404, { errors: [{ message: 'Post not found.' }] })
      }
      if (method === 'GET') {
        const contains = url.searchParams.get('filter')?.match(/^codeinjection_head:~'(.*)'$/)?.[1]
        const list = [...posts.values()].filter((p) => p.resource === resource && (!contains || String(p.codeinjection_head ?? '').includes(contains)))
        return json(200, { [resource]: list.map(out) })
      }
      if (method === 'POST') return json(201, { [resource]: [out(store(resource, body[resource][0]))] })
      if (method === 'PUT' && pid) {
        const p = posts.get(pid)
        if (!p) return json(404, { errors: [{ message: 'Post not found.' }] })
        const data = body[resource][0]
        if (data.updated_at !== p.updated_at) {
          return json(409, { errors: [{ message: 'Saving failed! Someone else is editing this post.', type: 'UpdateCollisionError' }] })
        }
        return json(200, { [resource]: [out(store(resource, data, p))] })
      }
    }
    if (path === 'tags/' && method === 'GET') {
      const internal = url.searchParams.get('filter') === 'visibility:internal'
      return json(200, { tags: [...tags.values()].filter((t) => !internal || t.visibility === 'internal') })
    }
    if (path === 'tags/' && method === 'POST') {
      const tag = tagFor(body.tags[0])
      tag.description = body.tags[0].description
      return json(201, { tags: [tag] })
    }
    if (path === 'site/') return json(200, { site: { title: 'Demo', version: '6.67' } })
    return json(404, { errors: [{ message: `Unknown ${method} ${path}` }] })
  }) as typeof fetch

  /** Seeds a post as an editor would have written it. */
  const add = (resource: 'posts' | 'pages', data: Record<string, any>) => store(resource, data)
  /** An editor saving a change in Ghost Admin. */
  const edit = (pid: string, data: Record<string, any>) => store(posts.get(pid)!.resource, data, posts.get(pid))

  return { add, calls, edit, fetch: fetchImpl, posts, tags }
}

/** Builds Lexical JSON with one paragraph per string. */
export const lexicalOf = (...paragraphs: string[]) =>
  JSON.stringify({
    root: {
      children: paragraphs.map((text) => ({
        children: [{ detail: 0, format: 0, mode: 'normal', style: '', text, type: 'extended-text', version: 1 }],
        direction: null,
        format: '',
        indent: 0,
        type: 'paragraph',
        version: 1,
      })),
      direction: null,
      format: '',
      indent: 0,
      type: 'root',
      version: 1,
    },
  })

export const ADMIN_KEY = `6ac3eb1bb1e35500017f22ee:${'ab'.repeat(32)}`
