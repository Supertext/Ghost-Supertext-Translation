/**
 * Settings an administrator changes on the status page: the language mapping (one combo box per
 * language) and *Translation review* (one checkbox per target language). Kept as a small JSON file next to the Commando Center state (`SUPERTEXT_SETTINGS_FILE`,
 * else `supertext-settings.json` in the folder of `STATE_FILE`), in memory without one.
 *
 * `SUPERTEXT_LANGUAGE_MAP` stays an override for automated setups: a language it maps can't be
 * changed on the page. Nothing here ever throws into a request or a translation.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { Languages, type LanguageMapping } from './vendor/supertext-sdk/v1/index.js'

export type ConnectorSettings = {
  /** Configured language code → Supertext code, chosen on the status page. */
  languageCodes: Record<string, string>
  /** Configured target codes with *Translation review* on (Supertext's review service). Absent: none. */
  review?: string[]
}

const EMPTY: ConnectorSettings = { languageCodes: {} }

/** `SUPERTEXT_SETTINGS_FILE`, else next to `STATE_FILE`, else none (memory). */
export function settingsPath(explicit: string | null, stateFile: string | null): string | null {
  if (explicit) return explicit
  return stateFile ? join(dirname(stateFile), 'supertext-settings.json') : null
}

function parse(raw: string): ConnectorSettings {
  const json = JSON.parse(raw) as unknown
  if (!json || typeof json !== 'object') return EMPTY
  const codes = (json as { languageCodes?: unknown }).languageCodes
  const review = (json as { review?: unknown }).review
  const reviewCodes = Array.isArray(review) ? review.filter((c): c is string => typeof c === 'string' && c.trim() !== '') : []
  const languageCodes =
    codes && typeof codes === 'object' && !Array.isArray(codes)
      ? Object.fromEntries(Object.entries(codes).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''))
      : {}
  return reviewCodes.length ? { languageCodes, review: reviewCodes } : { languageCodes }
}

export class SettingsStore {
  private memory: ConnectorSettings = EMPTY
  private cache: { raw: string; value: ConnectorSettings } | null = null

  constructor(
    readonly file: string | null,
    private readonly log: (message: string) => void = () => {},
  ) {}

  load(): ConnectorSettings {
    if (!this.file) return this.memory
    try {
      const raw = readFileSync(this.file, 'utf8')
      if (this.cache?.raw !== raw) this.cache = { raw, value: parse(raw) }
      return this.cache.value
    } catch {
      return this.memory // not saved yet, or unreadable
    }
  }

  /** False when the file couldn't be written (the settings then last until the next restart). */
  save(settings: ConnectorSettings): boolean {
    this.memory = settings
    if (!this.file) return true
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(settings, null, 2))
      renameSync(tmp, this.file)
      this.cache = null
      return true
    } catch (err) {
      this.log(`Could not write the settings file (${err instanceof Error ? err.message : String(err)}); keeping the settings in memory`)
      return false
    }
  }
}

const key = (code: string) => code.trim().toLowerCase().replace(/_/g, '-')

/** The override's value for `code` (`SUPERTEXT_LANGUAGE_MAP`), or null. */
export function overrideFor(code: string, override: LanguageMapping): string | null {
  for (const [from, to] of Object.entries(override)) if (key(from) === key(code) && to.trim()) return to.trim()
  return null
}

/** The mapping used for translations: `SUPERTEXT_LANGUAGE_MAP` wins, then the status page's choices. */
export function effectiveMapping(saved: Record<string, string>, override: LanguageMapping): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [from, to] of Object.entries(override)) out[from] = to
  for (const [from, to] of Object.entries(saved)) if (overrideFor(from, override) === null) out[from] = to
  return out
}

/** Whether *Translation review* is on for `code` (a configured target language). */
export function reviewOn(code: string, saved: ConnectorSettings): boolean {
  return (saved.review ?? []).some((c) => key(c) === key(code))
}

export type MappingRow = {
  /** Configured code (`SOURCE_LANGUAGE` or an entry of `TARGET_LANGUAGES`). */
  code: string
  role: 'source' | 'target'
  /** What the combo box shows: the override, else the saved value, else the suggestion; '' = "— choose —". */
  selected: string
  /** Set by `SUPERTEXT_LANGUAGE_MAP`: the combo box is read-only. */
  overridden: boolean
  /** *Translation review* for this target language (always false for the source). */
  review: boolean
}

/** One row per configured language, the source first (one mapping serves both directions). */
export function mappingRows(
  sourceLanguage: string,
  targetCodes: string[],
  saved: Record<string, string>,
  override: LanguageMapping,
  review: string[] = [],
): MappingRow[] {
  const seen = new Set<string>()
  const rows: MappingRow[] = []
  const add = (code: string, role: MappingRow['role']) => {
    if (!code.trim() || seen.has(key(code))) return
    seen.add(key(code))
    const forced = overrideFor(code, override)
    const own = Object.entries(saved).find(([from]) => key(from) === key(code))?.[1] ?? null
    const reviewed = role === 'target' && review.some((c) => key(c) === key(code))
    rows.push({ code, overridden: forced !== null, review: reviewed, role, selected: forced ?? own ?? Languages.suggestTarget(code) ?? '' })
  }
  add(sourceLanguage, 'source')
  for (const code of targetCodes) add(code, 'target')
  return rows
}

/** Form field of a row's combo box. */
export const fieldName = (code: string) => `code:${key(code)}`

/** Form field of a target row's *Translation review* checkbox (value `1` when ticked). */
export const reviewFieldName = (code: string) => `review:${key(code)}`

/** The ticked *Translation review* checkboxes → the configured target codes with review on. */
export function readReviewForm(form: URLSearchParams, rows: MappingRow[]): string[] {
  return rows.filter((r) => r.role === 'target' && form.get(reviewFieldName(r.code)) === '1').map((r) => r.code)
}

/**
 * The submitted combo boxes → the saved mapping. Only the configured languages are read,
 * overridden ones are skipped, and every value must be one of Supertext's target codes
 * ('' leaves the language to its exact match or default). Null when a value isn't valid.
 */
export function readMappingForm(form: URLSearchParams, rows: MappingRow[]): Record<string, string> | null {
  const valid = new Set(Languages.targetOptions().map((o) => o.code))
  const out: Record<string, string> = {}
  for (const row of rows) {
    if (row.overridden) continue
    const value = (form.get(fieldName(row.code)) ?? '').trim()
    if (value === '') continue
    if (!valid.has(value)) return null
    out[row.code] = value
  }
  return out
}

/** CSRF tokens bound to the signed-in staff session (HMAC with a per-process secret). */
export class CsrfTokens {
  private readonly secret = randomBytes(32)

  token(session: string): string {
    return createHmac('sha256', this.secret).update(session).digest('base64url')
  }

  verify(session: string, token: string | null | undefined): boolean {
    if (!token) return false
    const a = Buffer.from(this.token(session))
    const b = Buffer.from(token)
    return a.length === b.length && timingSafeEqual(a, b)
  }
}
