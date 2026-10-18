import { describe, expect, it } from 'vitest'

import { reviewUrl } from '../src/config.js'
import { REVIEW_URL, SupertextClient, SupertextError } from '../src/supertext/client.js'
import { VERSION } from '../src/version.js'
import { fakeSupertext } from './fakeSupertext.js'

const noSleep = async () => {}
const client = (fake: ReturnType<typeof fakeSupertext>, extra: Partial<ConstructorParameters<typeof SupertextClient>[0]> = {}) =>
  new SupertextClient({ apiKey: 'test-key', baseUrl: 'https://api.test/v1', fetch: fake.fetch, sleep: noSleep, ...extra })

describe('SupertextClient', () => {
  it('runs upload → poll → download → delete', async () => {
    const fake = fakeSupertext({ statuses: ['translating', 'translating', 'done'] })
    const html = await client(fake).translateHtml({
      html: '<p data-st-id="0">Hallo</p>',
      politeness: 'more',
      sourceLang: 'de',
      targetLang: 'fr-CH',
    })

    expect(html).toContain('[fr-CH] Hallo')
    expect(fake.calls.map((c) => `${c.method} ${c.url.replace('https://api.test/v1/', '')}`)).toEqual([
      'POST translate/ai/file',
      'GET translate/ai/file/f1/status',
      'GET translate/ai/file/f1/status',
      'GET translate/ai/file/f1/status',
      'GET translate/ai/file/f1/translation',
      'DELETE translate/ai/file/f1',
    ])
    const form = fake.calls[0]?.form as FormData
    expect(form.get('target_lang')).toBe('fr-CH')
    expect(form.get('source_lang')).toBe('de')
    expect(form.get('politeness')).toBe('more')
    // Must be exactly text/html — a charset suffix is rejected with 415.
    expect((form.get('file') as File).type).toBe('text/html')
    expect((form.get('file') as File).name).toBe('content.html')
  })

  it('omits optional fields when not needed', async () => {
    const fake = fakeSupertext()
    await client(fake).translateHtml({ html: '<p data-st-id="0">x</p>', targetLang: 'en-US' })
    const form = fake.calls[0]?.form as FormData
    expect(form.has('source_lang')).toBe(false)
    expect(form.has('politeness')).toBe(false)
  })

  it.each([
    ['error', 'translation_error'],
    ['limit_exceeded', 'quota_exceeded'],
    ['deleted', 'file_deleted'],
  ])('maps status %s and still deletes the file', async (status, code) => {
    const fake = fakeSupertext({ statuses: [status] })
    await expect(client(fake).translateHtml({ html: 'x', targetLang: 'en-US' })).rejects.toMatchObject({ code })
    expect(fake.calls.at(-1)?.method).toBe('DELETE')
  })

  it('times out', async () => {
    const fake = fakeSupertext({ statuses: ['translating'] })
    let now = 0
    const realNow = Date.now
    Date.now = () => now
    try {
      const c = client(fake, { pollIntervalMs: 1000, sleep: async (ms) => void (now += ms), timeoutMs: 5000 })
      await expect(c.translateHtml({ html: 'x', targetLang: 'en-US' })).rejects.toMatchObject({ code: 'timeout' })
    } finally {
      Date.now = realNow
    }
  })

  it.each([
    [401, 'authentication_failure'],
    [413, 'payload_too_large'],
    [429, 'too_many_requests'],
    [503, 'service_unavailable'],
    [418, 'unexpected_status'],
  ])('maps HTTP %i', async (status, code) => {
    const fake = fakeSupertext({ failStatus: status })
    const err = await client(fake).translateHtml({ html: 'x', targetLang: 'en-US' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SupertextError)
    expect(err).toMatchObject({ code, status })
  })

  it('refuses to call without an API key', async () => {
    const fake = fakeSupertext()
    await expect(client(fake, { apiKey: '' }).validateApiKey()).rejects.toMatchObject({ code: 'missing_api_key' })
    expect(fake.calls).toHaveLength(0)
  })
})

describe('API key', () => {
  it('accepts the key with or without the Supertext-Auth-Key prefix', async () => {
    for (const apiKey of ['test-key', ' Supertext-Auth-Key test-key ']) {
      const fake = fakeSupertext()
      await client(fake, { apiKey }).validateApiKey()
      expect(fake.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET https://api.test/v1/features'])
    }
  })
})

describe('language pair', () => {
  it('reports an unsupported pair with the codes as message parameters', async () => {
    const fake = fakeSupertext({ failStatus: 400 })
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await fake.fetch(input, init)
      return new Response('{"error_code":"INVALID_LANGUAGE_PAIR","source_lang":"en","target_lang":"xx-YY"}', { status: 400 })
    }) as typeof globalThis.fetch
    const err = await client(fake, { fetch }).translateHtml({ html: 'x', sourceLang: 'en', targetLang: 'xx-YY' }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'invalid_language_pair', params: { source: 'en', target: 'xx-YY' } })
  })
})

describe('rate limiting', () => {
  it('retries after HTTP 429 and then succeeds', async () => {
    const fake = fakeSupertext({ rateLimited: 2 })
    const waits: number[] = []
    const html = await client(fake, { sleep: async (ms) => void waits.push(ms) }).translateHtml({
      html: '<p data-st-id="0">Hallo</p>',
      targetLang: 'en-US',
    })
    expect(html).toContain('[en-US] Hallo')
    expect(waits).toHaveLength(2)
  })

  it('gives up after a few retries', async () => {
    const fake = fakeSupertext({ rateLimited: 99 })
    await expect(client(fake).translateHtml({ html: '<p data-st-id="0">Hallo</p>', targetLang: 'en-US' })).rejects.toMatchObject({
      code: 'too_many_requests',
    })
  })

  it('honours Retry-After', async () => {
    const { retryDelayMs } = await import('../src/vendor/supertext-sdk/v1/index.js')
    expect(retryDelayMs(0, '3')).toBe(3000)
    expect(retryDelayMs(1, null)).toBeGreaterThanOrEqual(2000)
  })

  it('names the connector and its version in the User-Agent', async () => {
    let agent = ''
    const fake = fakeSupertext()
    const spy = ((input: RequestInfo | URL, init?: RequestInit) => {
      agent = new Headers(init?.headers).get('user-agent') ?? ''
      return fake.fetch(input, init)
    }) as typeof fetch
    await client(fake, { fetch: spy }).validateApiKey()
    expect(agent).toContain(`Ghost-Supertext-Translation/${VERSION}`)
  })
})

describe('Translation review', () => {
  it('sends every call of a review language to the review service, with the same key', async () => {
    const fake = fakeSupertext()
    const direct = client(fake, { reviewUrl: 'https://review.test/v1/' })
    expect(direct.forReview(false)).toBe(direct)
    const review = direct.forReview(true)
    expect(review).not.toBe(direct)
    expect(direct.forReview(true), 'one review client').toBe(review)

    expect(await review.translateHtml({ html: '<p data-st-id="0">Hallo</p>', targetLang: 'de-CH' })).toContain('[de-CH] Hallo')
    expect(fake.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://review.test/v1/translate/ai/file',
      'GET https://review.test/v1/translate/ai/file/f1/status',
      'GET https://review.test/v1/translate/ai/file/f1/translation',
      'DELETE https://review.test/v1/translate/ai/file/f1',
    ])
    // The key check goes directly to Supertext.
    await direct.validateApiKey()
    expect(fake.calls.at(-1)?.url).toBe('https://api.test/v1/features')
  })

  it('is off without a review URL or with the API URL itself', () => {
    const fake = fakeSupertext()
    const off = client(fake)
    expect(off.forReview(true)).toBe(off)
    const empty = client(fake, { reviewUrl: '' })
    expect(empty.forReview(true)).toBe(empty)
    const same = client(fake, { reviewUrl: 'https://api.test/v1/' })
    expect(same.forReview(true)).toBe(same)
  })

  it('defaults SUPERTEXT_REVIEW_URL to Supertext’s review service; empty or off turns it off', () => {
    expect(REVIEW_URL).toBe('https://localizationreview-production.up.railway.app/v1/')
    expect(reviewUrl(undefined)).toBe(REVIEW_URL)
    expect(reviewUrl('')).toBe('')
    expect(reviewUrl(' off ')).toBe('')
    expect(reviewUrl('0')).toBe('')
    expect(reviewUrl('http://localhost:3000/v1/')).toBe('http://localhost:3000/v1/')
  })
})
