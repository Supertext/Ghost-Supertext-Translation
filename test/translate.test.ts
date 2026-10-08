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
    String(input).startsWith('https://api.test/') ? st.fetch(input, init) : ghost.fetch(input, init)) as typeof fetch
  const translator = new Translator({
    ghost: new GhostAdmin({ adminKey: ADMIN_KEY, apiUrl: 'https://ghost.test', fetch: fetchImpl }),
    sourceLanguage: 'en',
    supertext: new SupertextClient({ apiKey: 'test-key', baseUrl: 'https://api.test/v1', fetch: fetchImpl, sleep: async () => {} }),
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

  async function start(env: Partial<Config> = {}) {
    const s = setup()
    const config: Config = {
      ghostSecrets: () => ({ adminKey: ADMIN_KEY, webhookSecret: 'whsec' }),
      host: '127.0.0.1',
      jobsFile: null,
      languages: parseTargetLanguages('de-CH,fr-CH'),
      port: 0,
      settingsFile: null,
      siteUrl: 'https://ghost.test',
      sourceLanguage: 'en',
      supertextApiKey: 'test-key',
      supertextApiUrl: 'https://api.test/v1/',
      uiLanguage: 'auto',
      upstream: null,
      ...env,
    }
    const app = createApp(config, { fetch: s.fetchImpl, supertextPollMs: 100 })
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r))
    close = () => app.server.close()
    const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
    const post = (body: unknown, event: string, secret = 'whsec') => {
      const raw = JSON.stringify(body)
      const t = Date.now()
      const sig = `sha256=${createHmac('sha256', secret).update(raw + t).digest('hex')}, t=${t}`
      return fetch(`${base}/supertext/webhook?event=${event}`, { body: raw, headers: { 'X-Ghost-Signature': sig }, method: 'POST' })
    }
    return { ...s, app, base, post }
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

  it('serves a health check and hides the status page without a Ghost in front', async () => {
    const { base } = await start()
    expect(await (await fetch(`${base}/supertext/health`)).text()).toBe('ok')
    expect((await fetch(`${base}/ghost/supertext/`)).status).toBe(404)
  })
})
