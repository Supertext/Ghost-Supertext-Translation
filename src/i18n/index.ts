import { de } from './de.js'
import { en, type MessageKey, type Messages } from './en.js'
import { fr } from './fr.js'
import { it } from './it.js'

export type { MessageKey, Messages } from './en.js'

/** Languages of the connector's own UI (status page, job messages, tag descriptions). */
export const UI_LOCALES = ['en', 'de', 'fr', 'it'] as const
export type UiLocale = (typeof UI_LOCALES)[number]

export const CATALOGS: Record<UiLocale, Messages> = { de, en, fr, it }

/** Placeholder values; a value can itself be a message (e.g. an error inside "{message} — {detail}"). */
export type Params = { [name: string]: string | number | Localizable }

/** A message to show later in the reader's language: catalog key plus placeholder values. JSON-safe. */
export type Localizable = { key: MessageKey; params?: Params }

/** A language's name in `locale`, e.g. `de-CH` → "German (Switzerland)" / "Deutsch (Schweiz)". */
export function languageLabel(code: string, locale: string = 'en'): string {
  try {
    return new Intl.DisplayNames([locale], { languageDisplay: 'standard', type: 'language' }).of(code.replace(/_/g, '-')) ?? code
  } catch {
    return code
  }
}

export const isUiLocale = (value: string): value is UiLocale => (UI_LOCALES as readonly string[]).includes(value)

/**
 * Replaces `{name}` placeholders. `{language}` holds a language code and becomes its name in
 * `locale`. `escape` is applied to every value (the status page passes an HTML escaper).
 */
export function t(locale: UiLocale, key: MessageKey, params: Params = {}, escape: (s: string) => string = (s) => s): string {
  const template = CATALOGS[locale][key] ?? en[key]
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name]
    if (value === undefined) return whole
    if (typeof value === 'object') return t(locale, value.key, value.params, escape)
    return escape(name === 'language' ? languageLabel(String(value), locale) : String(value))
  })
}

/** Several messages joined into one sentence block (e.g. "Created … draft. 1 text part …"). */
export function format(locale: UiLocale, messages: Localizable[], escape?: (s: string) => string): string {
  return messages.map((m) => t(locale, m.key, m.params, escape)).join(' ')
}

/**
 * The UI language: `UI_LANGUAGE` if set to en, de, fr or it; otherwise the best match from the
 * browser's Accept-Language header; otherwise English.
 */
export function pickLocale(setting: string, acceptLanguage?: string): UiLocale {
  const fixed = setting.trim().toLowerCase()
  if (isUiLocale(fixed)) return fixed
  const ranked = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag = '', ...rest] = part.trim().split(';')
      const q = rest.map((p) => p.trim()).find((p) => p.startsWith('q='))
      return { index, lang: tag.trim().toLowerCase().split(/[-_]/)[0] ?? '', q: q ? Number(q.slice(2)) : 1 }
    })
    .filter((x) => x.lang && x.q > 0 && !Number.isNaN(x.q))
    .sort((a, b) => b.q - a.q || a.index - b.index)
  for (const { lang } of ranked) if (isUiLocale(lang)) return lang
  return 'en'
}
