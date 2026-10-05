import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { adminToken, parseAdminKey } from '../src/ghost/admin.js'
import { parseWebhook, verifySignature } from '../src/ghost/webhook.js'
import { parseTargetLanguages, requestsFromTags, tagSlug } from '../src/languages.js'

const sign = (body: string, secret: string, t: number) =>
  `sha256=${createHmac('sha256', secret).update(body + t).digest('hex')}, t=${t}`

describe('verifySignature', () => {
  const body = JSON.stringify({ post: { current: { id: 'a' } } })
  const now = 1_790_000_000_000

  it('accepts Ghost signatures and rejects tampering, wrong secrets and old timestamps', () => {
    expect(verifySignature(body, sign(body, 's3cret', now), 's3cret', now)).toBe(true)
    expect(verifySignature(`${body} `, sign(body, 's3cret', now), 's3cret', now)).toBe(false)
    expect(verifySignature(body, sign(body, 'other', now), 's3cret', now)).toBe(false)
    expect(verifySignature(body, sign(body, 's3cret', now - 3_600_000), 's3cret', now)).toBe(false)
    expect(verifySignature(body, undefined, 's3cret', now)).toBe(false)
  })
})

describe('parseWebhook', () => {
  const tags = (...slugs: string[]) => slugs.map((slug) => ({ slug }))

  it('reports the tags a save added', () => {
    const body = {
      post: {
        current: { id: 'p1', tags: tags('news', 'hash-translate-de-ch', 'hash-translate-fr-ch'), title: 'Hello' },
        previous: { tags: tags('news', 'hash-translate-de-ch') },
      },
    }
    expect(parseWebhook(body, 'post.edited')).toEqual({
      addedTagSlugs: ['hash-translate-fr-ch'],
      id: 'p1',
      resource: 'posts',
      tagSlugs: ['news', 'hash-translate-de-ch', 'hash-translate-fr-ch'],
      title: 'Hello',
    })
  })

  it('ignores edits that did not touch the tags', () => {
    const body = { post: { current: { id: 'p1', tags: tags('hash-translate-de-ch'), title: 'x' }, previous: { title: 'y' } } }
    expect(parseWebhook(body, 'post.edited')?.addedTagSlugs).toEqual([])
  })

  it('treats every tag of a new post or page as added', () => {
    const body = { page: { current: { id: 'g1', tags: tags('hash-translate-all'), title: 'About' }, previous: {} } }
    expect(parseWebhook(body, 'page.added')).toMatchObject({ addedTagSlugs: ['hash-translate-all'], resource: 'pages' })
  })

  it('returns null for other payloads', () => {
    expect(parseWebhook({ member: {} }, 'post.edited')).toBeNull()
    expect(parseWebhook(null, null)).toBeNull()
  })
})

describe('requestsFromTags', () => {
  const langs = parseTargetLanguages('de-CH, fr-CH,de-ch')

  it('builds one language per code with its tags', () => {
    expect(langs.map((l) => [l.code, l.label, l.translateTag, l.retranslateTag, l.langTag])).toEqual([
      ['de-CH', 'German (Switzerland)', '#translate-de-ch', '#retranslate-de-ch', '#lang-de-ch'],
      ['fr-CH', 'French (Switzerland)', '#translate-fr-ch', '#retranslate-fr-ch', '#lang-fr-ch'],
    ])
  })

  it('maps added tags to requests', () => {
    const r = (...names: string[]) => requestsFromTags(names.map(tagSlug), langs).map((x) => `${x.language.code}${x.force ? '!' : ''}`)
    expect(r('#translate-fr-ch')).toEqual(['fr-CH'])
    expect(r('#translate-all')).toEqual(['de-CH', 'fr-CH'])
    expect(r('#translate-all', '#retranslate-de-ch')).toEqual(['de-CH!', 'fr-CH'])
    expect(r('#retranslate-all')).toEqual(['de-CH!', 'fr-CH!'])
    expect(r('news', '#lang-de-ch')).toEqual([])
  })
})

describe('Admin API key', () => {
  it('parses keys and signs a JWT Ghost accepts', () => {
    const key = `6ac3eb1bb1e35500017f22ee:${'ab'.repeat(32)}`
    expect(parseAdminKey(`Ghost ${key}`).id).toBe('6ac3eb1bb1e35500017f22ee')
    expect(() => parseAdminKey('nonsense')).toThrow(/<id>:<secret>/)
    const [h, p, s] = adminToken(key, 1_790_000_000_000).split('.')
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'HS256', kid: '6ac3eb1bb1e35500017f22ee', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toEqual({ aud: '/admin/', exp: 1_790_000_300, iat: 1_790_000_000 })
    const expected = createHmac('sha256', Buffer.from('ab'.repeat(32), 'hex')).update(`${h}.${p}`).digest('base64url')
    expect(s).toBe(expected)
  })
})
