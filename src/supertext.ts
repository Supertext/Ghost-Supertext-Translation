import { LIVE_BASE_URL, type FetchLike, SupertextClient, SupertextError, type SupertextErrorCode } from 'supertext-sdk'

import type { Localizable, Params } from './i18n/index.js'
import { VERSION } from './version.js'

/**
 * The Supertext API is used through the Supertext SDK (`supertext-sdk`, vendored in
 * vendor/supertext-sdk): auth header, multipart upload, HTTP 429 retries, polling,
 * deleting the file, language codes and error codes. This file only connects it to
 * the connector: client options and the editor-facing messages for its error codes.
 */

export { LIVE_BASE_URL, SupertextClient, SupertextError }
export type { Politeness } from 'supertext-sdk'

export const SIGNUP_URL = 'https://www.supertext.com/person/en/account/signin'
/** supertext.com → Integrations → API (requires the Admin role). */
export const API_KEY_URL = 'https://www.supertext.com/en/integrations/api'
const KEY_LINKS = { apiKeyUrl: API_KEY_URL, signupUrl: SIGNUP_URL }

export type ClientOptions = {
  apiKey: string
  baseUrl?: string
  fetch?: FetchLike
  /** Delay between status polls (tests). */
  pollIntervalMs?: number
  sleep?: (ms: number) => Promise<void>
}

/** The SDK client, with a User-Agent that names the connector and its version. */
export function createSupertextClient(options: ClientOptions): SupertextClient {
  return new SupertextClient(options.apiKey, {
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    pollIntervalMs: options.pollIntervalMs,
    sleep: options.sleep,
    userAgent: `Ghost-Supertext-Translation/${VERSION}`,
  })
}

/**
 * The editor-facing message for an SDK error (`error.<code>` in src/i18n). The API's
 * own `detail` is appended as sent, never translated; the API key is never part of it.
 * `sent`: the language codes of the request, for `invalid_language_pair`.
 */
export function localizeSupertextError(err: SupertextError, sent: { source?: string; target?: string } = {}): Localizable[] {
  const code: SupertextErrorCode = err.code
  let params: Params = {}
  let detail = err.detail ?? ''
  switch (code) {
    case 'missing_api_key':
    case 'authentication_failure':
      params = KEY_LINKS
      break
    case 'transport_error':
      // The network's reason is the message itself here, not an extra detail.
      params = { error: detail || 'network error' }
      detail = ''
      break
    case 'unexpected_status':
      params = { status: err.status ?? '?' }
      break
    case 'invalid_language_pair':
      // The codes as sent; the API names them only sometimes.
      params = { source: err.sourceLang ?? sent.source ?? '?', target: err.targetLang ?? sent.target ?? '?' }
      break
  }
  const message: Localizable = { key: `error.${code}`, params }
  return [detail ? { key: 'error.detail', params: { detail, message } } : message]
}
