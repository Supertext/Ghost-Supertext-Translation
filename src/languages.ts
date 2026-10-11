import { languageLabel, t, type UiLocale } from './i18n/index.js'
import type { Politeness } from './supertext/client.js'

/**
 * A target language and the Ghost internal tags that belong to it.
 *
 * Ghost has no per-post language, so translations are separate posts marked with an
 * internal tag (`#lang-de-ch`). Editors request translations with internal tags too.
 */
export type Language = {
  /** Code as configured, e.g. `de-CH` or `de`. Used in markers, logs and messages. */
  code: string
  /** Code sent to Supertext as target: always regional (`de` → `de-DE`), see `targetCode`. */
  target: string
  /** Lower-case code used in tag names and URLs, e.g. `de-ch`. */
  slug: string
  /** English display name, e.g. `German (Switzerland)`. */
  label: string
  politeness: Politeness
  /** `#lang-de-ch`: marks a translation. */
  langTag: string
  /** `#translate-de-ch`: request a translation. */
  translateTag: string
  /** `#retranslate-de-ch`: request a translation and overwrite an edited or published one. */
  retranslateTag: string
}

export const TRANSLATE_ALL_TAG = '#translate-all'
export const RETRANSLATE_ALL_TAG = '#retranslate-all'

/** Ghost turns `#name` into the slug `hash-name`. */
export const tagSlug = (name: string) => `hash-${name.replace(/^#/, '').toLowerCase()}`

const languageSlug = (code: string) => code.trim().toLowerCase().replace(/_/g, '-')

export { languageLabel }

/** `de-CH,fr-CH` → languages. Duplicates and blanks are dropped. */
export function parseTargetLanguages(value: string, politeness: Record<string, Politeness> = {}): Language[] {
  const seen = new Set<string>()
  const out: Language[] = []
  for (const raw of value.split(/[\s,;]+/)) {
    const code = raw.trim()
    if (!code) continue
    const slug = languageSlug(code)
    if (seen.has(slug)) continue
    seen.add(slug)
    out.push({
      code,
      target: targetCode(code),
      label: languageLabel(code),
      langTag: `#lang-${slug}`,
      politeness: politeness[slug] ?? politeness['*'] ?? 'default',
      retranslateTag: `#retranslate-${slug}`,
      slug,
      translateTag: `#translate-${slug}`,
    })
  }
  return out
}

/** `more` (all languages) or `de-CH=more,fr-CH=less` → map keyed by language slug (`*` = all). */
export function parsePoliteness(value: string | undefined): Record<string, Politeness> {
  const out: Record<string, Politeness> = {}
  for (const part of (value ?? '').split(/[\s,;]+/)) {
    if (!part) continue
    const [a, b] = part.includes('=') ? part.split('=') : ['*', part]
    const p = (b ?? '').trim().toLowerCase()
    if (p === 'default' || p === 'less' || p === 'more') out[a === '*' ? '*' : languageSlug(a ?? '')] = p
  }
  return out
}

/**
 * Regional default for a bare target language. Supertext rejects bare targets
 * (`de`) with INVALID_LANGUAGE_PAIR, so `de` is sent as `de-DE`. Same table in
 * every Supertext plugin.
 */
export const DEFAULT_REGIONS: Readonly<Record<string, string>> = {
  ar: 'ar-SA', bg: 'bg-BG', cs: 'cs-CZ', da: 'da-DK', de: 'de-DE', el: 'el-GR', en: 'en-US',
  es: 'es-ES', et: 'et-EE', fi: 'fi-FI', fr: 'fr-FR', hr: 'hr-HR', hu: 'hu-HU', it: 'it-IT',
  ja: 'ja-JP', ko: 'ko-KR', lt: 'lt-LT', lv: 'lv-LV', nb: 'nb-NO', nl: 'nl-NL', pl: 'pl-PL',
  pt: 'pt-PT', ro: 'ro-RO', ru: 'ru-RU', sk: 'sk-SK', sl: 'sl-SI', sr: 'sr-RS', sv: 'sv-SE',
  th: 'th-TH', tr: 'tr-TR', uk: 'uk-UA', vi: 'vi-VN', zh: 'zh-CN',
}

/** `de_ch` / `DE-ch` → `de-CH`; scripts and numeric regions keep their form (`zh-Hant`, `es-419`). */
export function normalizeTag(code: string): string {
  const [language, ...rest] = code.trim().split(/[-_]+/).filter(Boolean)
  if (!language) return ''
  const subtags = rest.map((part) => {
    if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase()
    if (/^[a-z]{4}$/i.test(part)) return part[0]!.toUpperCase() + part.slice(1).toLowerCase()
    return part
  })
  return [language.toLowerCase(), ...subtags].join('-')
}

/**
 * Supertext target code: always regional. A code with a region is normalized
 * (`fr_ch` → `fr-CH`), a bare language gets its default region (`de` → `de-DE`);
 * unknown bare codes are sent unchanged.
 */
export function targetCode(code: string): string {
  const tag = normalizeTag(code)
  return tag.includes('-') ? tag : (DEFAULT_REGIONS[tag] ?? tag)
}

/**
 * Supertext expects the source as a bare language (`en`, not `en-GB`); a regional
 * source code is rejected with INVALID_LANGUAGE_PAIR.
 */
export function sourceCode(code: string): string {
  return normalizeTag(code).split('-')[0] ?? ''
}

export type Request = { language: Language; force: boolean }

/**
 * Which translations the newly added tag slugs ask for. `#retranslate-*` wins over
 * `#translate-*` for the same language.
 */
export function requestsFromTags(addedSlugs: Iterable<string>, languages: Language[]): Request[] {
  const added = new Set(addedSlugs)
  const all = added.has(tagSlug(TRANSLATE_ALL_TAG))
  const allForce = added.has(tagSlug(RETRANSLATE_ALL_TAG))
  const out: Request[] = []
  for (const language of languages) {
    const force = allForce || added.has(tagSlug(language.retranslateTag))
    if (force || all || added.has(tagSlug(language.translateTag))) out.push({ force, language })
  }
  return out
}

/**
 * The internal tags the connector creates in Ghost, with the description shown in Ghost
 * Admin → Tags (in `locale`). `statusUrl` (the /supertext/ page, if served) is appended to
 * request tags. Tag names are never translated: editors and `routes.yaml` use them.
 */
export function managedTags(languages: Language[], statusUrl?: string, locale: UiLocale = 'en'): Array<{ name: string; description: string }> {
  const results = statusUrl ? ` ${t(locale, 'tag.results', { url: statusUrl })}` : ''
  const tags = [
    { description: `${t(locale, 'tag.translateAll')}${results}`, name: TRANSLATE_ALL_TAG },
    { description: `${t(locale, 'tag.retranslateAll')}${results}`, name: RETRANSLATE_ALL_TAG },
  ]
  for (const l of languages) {
    tags.push(
      { description: `${t(locale, 'tag.translate', { language: l.code })}${results}`, name: l.translateTag },
      {
        description: `${t(locale, 'tag.retranslate', { language: l.code, translateTag: l.translateTag })}${results}`,
        name: l.retranslateTag,
      },
      { description: t(locale, 'tag.lang', { language: l.code }), name: l.langTag },
    )
  }
  return tags
}
