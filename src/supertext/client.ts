/**
 * The connector's access to the Supertext AI file translation API (v1), built on the
 * shared Supertext SDK (src/vendor/supertext-sdk, compiled with the connector). The SDK
 * does the protocol:
 *   1. POST   translate/ai/file                     multipart upload of an HTML file → { file_id }
 *   2. GET    translate/ai/file/{id}/status         poll until `done`
 *   3. GET    translate/ai/file/{id}/translation    download the translated HTML
 *   4. DELETE translate/ai/file/{id}                cleanup, also after errors
 * plus the `Authorization: Supertext-Auth-Key <key>` header (a pasted prefix is stripped),
 * HTTP 429 retries. Language codes are resolved before (src/languages.ts). SDK errors come
 * out as this module's SupertextError, whose message is translated in the status page.
 */

import { type Localizable, type Params, t, type UiLocale } from '../i18n/index.js'
import {
  ErrorCode,
  LIVE_BASE_URL,
  SupertextClient as SdkClient,
  SupertextError as SdkError,
  type FetchLike,
} from '../vendor/supertext-sdk/v1/index.js'
import { USER_AGENT } from '../version.js'

/** Where administrators log in to or create a Supertext account. */
export const SIGNUP_URL = 'https://www.supertext.com/person/en/account/signin'
/** Where administrators generate the AI API key (supertext.com → Integrations → API, Admin role). */
export const API_KEY_URL = 'https://www.supertext.com/en/integrations/api'
const KEY_LINKS = { apiKeyUrl: API_KEY_URL, signupUrl: SIGNUP_URL }

export const SUPERTEXT_ENVIRONMENTS = {
  live: LIVE_BASE_URL,
  staging: 'https://api.staging.supertext.com/v1/',
  testing: 'https://api.testing.supertext.com/v1/',
} as const

/**
 * Supertext's review service (the translation proxy of Supertext Localization Review). It speaks
 * the same API v1 and forwards to the live Supertext API with the connector's key, keeping every
 * translation so reviewers can correct them on the website. Used for target languages with
 * *Translation review* on (status page → Language mapping); `SUPERTEXT_REVIEW_URL` replaces it.
 */
export const REVIEW_URL = 'https://localizationreview-production.up.railway.app/v1/'

export type SupertextEnvironment = keyof typeof SUPERTEXT_ENVIRONMENTS

export type Politeness = 'default' | 'less' | 'more'

export type SupertextErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export class SupertextError extends Error {
  readonly code: SupertextErrorCode
  readonly status?: number
  /** Placeholder values of the code's message (`error.<code>` in src/i18n). */
  readonly params: Params
  /** The API's own text, shown as sent (never translated). */
  readonly detail: string

  /** `message` is English; `localized` gives the same text in another UI language. */
  constructor(code: SupertextErrorCode, opts: { status?: number; params?: Params; detail?: string } = {}) {
    const params = opts.params ?? {}
    const detail = opts.detail ?? ''
    super(formatSupertextError('en', code, params, detail))
    this.name = 'SupertextError'
    this.code = code
    this.status = opts.status
    this.params = params
    this.detail = detail
  }

  get localized(): Localizable[] {
    return [supertextErrorMessage(this.code, this.params, this.detail)]
  }
}

function supertextErrorMessage(code: SupertextErrorCode, params: Params, detail = ''): Localizable {
  const message: Localizable = { key: `error.${code}`, params }
  return detail ? { key: 'error.detail', params: { detail, message } } : message
}

function formatSupertextError(locale: UiLocale, code: SupertextErrorCode, params: Params, detail = ''): string {
  const m = supertextErrorMessage(code, params, detail)
  return t(locale, m.key, m.params)
}

export type SupertextClientOptions = {
  apiKey: string
  /** Base URL with trailing slash. Defaults to the live API. */
  baseUrl?: string
  /** Custom fetch (tests, proxies). Defaults to global fetch. */
  fetch?: typeof fetch
  /** Delay between status polls. Default 2000 ms. */
  pollIntervalMs?: number
  /** Give up waiting after this long. Default 180000 ms. */
  timeoutMs?: number
  /** Per-request HTTP timeout. Default 30000 ms. */
  requestTimeoutMs?: number
  /** Sleep implementation (tests). */
  sleep?: (ms: number) => Promise<void>
  /** Review service for languages with *Translation review* on ('' or absent: review off; the API's own URL: no second client). */
  reviewUrl?: string
}

export type TranslateFileArgs = {
  html: string
  /** A Supertext target code (`de-CH`, `es`; see `targetCode` in src/languages.ts), sent as it is. */
  targetLang: string
  /** A Supertext source code (`en`); omit for auto-detection. */
  sourceLang?: string
  politeness?: Politeness
}

/** The SDK's error as this connector's SupertextError (translated message parameters). */
export function fromSdkError(error: SdkError): SupertextError {
  const code = error.code as SupertextErrorCode
  const params: Params =
    code === 'authentication_failure' || code === 'missing_api_key'
      ? KEY_LINKS
      : code === 'unexpected_status'
        ? { status: error.status ?? 0 }
        : code === 'transport_error'
          ? { error: error.detail ?? '' }
          : code === 'invalid_language_pair'
            ? { source: error.sourceLang ?? '?', target: error.targetLang ?? '?' }
            : code === 'unsupported_language'
              ? { code: error.targetLang ?? error.sourceLang ?? '?', language: error.targetLang ?? error.sourceLang ?? '?' }
              : {}
  const detail = code === 'transport_error' || code === 'invalid_language_pair' || code === 'unsupported_language' ? '' : (error.detail ?? '')
  return new SupertextError(code, { detail, params, status: error.status })
}

const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '')

export class SupertextClient {
  private readonly sdk: SdkClient
  /** Builds the client for the review service; null when review is off (no URL, or the API's own). */
  private readonly makeReviewClient: (() => SupertextClient) | null
  private reviewClient: SupertextClient | null = null

  constructor(options: SupertextClientOptions) {
    const pollIntervalMs = Math.max(100, options.pollIntervalMs ?? 2000)
    const baseUrl = options.baseUrl ?? SUPERTEXT_ENVIRONMENTS.live
    this.sdk = new SdkClient(options.apiKey, {
      baseUrl,
      pollIntervalMs,
      timeoutMs: Math.max(pollIntervalMs, options.timeoutMs ?? 180_000),
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      // The connector's version too, so Supertext and the review service see which release calls.
      userAgent: USER_AGENT,
      ...(options.fetch ? { fetch: options.fetch as FetchLike } : {}),
      ...(options.sleep ? { sleep: options.sleep } : {}),
    })
    const reviewUrl = (options.reviewUrl ?? '').trim()
    this.makeReviewClient =
      reviewUrl === '' || sameUrl(reviewUrl, baseUrl) ? null : () => new SupertextClient({ ...options, baseUrl: reviewUrl, reviewUrl: '' })
  }

  /**
   * The client for a target language: the review service (same key, timeouts and transport, created
   * once) when its *Translation review* is on, else this one. Without a review URL, always this one.
   * A job is collected by the client that submitted it (`translateHtml` is one round trip).
   */
  forReview(review: boolean): SupertextClient {
    if (!review || !this.makeReviewClient) return this
    return (this.reviewClient ??= this.makeReviewClient())
  }

  /** Full round trip: upload, wait, download, delete. Returns the translated HTML. */
  async translateHtml({ html, targetLang, sourceLang, politeness }: TranslateFileArgs): Promise<string> {
    try {
      return await this.sdk.translateHtml(html, targetLang, { sourceLang: sourceLang ?? null, politeness: politeness ?? 'default' })
    } catch (err) {
      throw err instanceof SdkError ? fromSdkError(err) : err
    }
  }

  /** Cost-free check that the API key is accepted (`GET features`). */
  async validateApiKey(): Promise<void> {
    try {
      await this.sdk.validateApiKey()
    } catch (err) {
      throw err instanceof SdkError ? fromSdkError(err) : err
    }
  }
}
