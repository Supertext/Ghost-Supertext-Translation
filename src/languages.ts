import { languageLabel, t, type UiLocale } from './i18n/index.js'
import type { Politeness } from './supertext/client.js'
import { Languages, type LanguageMapping } from './vendor/supertext-sdk/v1/index.js'

/**
 * A target language and the Ghost internal tags that belong to it.
 *
 * Ghost has no per-post language, so translations are separate posts marked with an
 * internal tag (`#lang-de-ch`). Editors request translations with internal tags too.
 */
export type Language = {
  /** Code as configured, e.g. `de-CH` or `de`. Used in markers, logs and messages. */
  code: string
  /**
   * Code sent to Supertext as target (the mapping: `SUPERTEXT_LANGUAGE_MAP`, else the status
   * page's combo box; else an exact Supertext code; else the SDK default, `de` → `de-DE`), or
   * null when there is none of these: requests for it fail with `unsupported_language`.
   */
  target: string | null
  /** Lower-case code used in tag names and URLs, e.g. `de-ch`. */
  slug: string
  /** English display name, e.g. `German (Switzerland)`. */
  label: string
  /** Formal/informal as configured for this language (or for all languages). */
  politeness: Politeness
  /**
   * Supertext offers no formal/informal choice for the target (`Languages.supportsPoliteness`):
   * `blocked` = set for this language, requests fail with `unsupported_feature` until it is removed;
   * `ignored` = set for all languages, this one is sent with the default tone. Shown on the status page.
   */
  politenessUnsupported: 'blocked' | 'ignored' | null
  /** Where the tone comes from: set for this language, for all languages, or not set. */
  politenessScope: 'language' | 'all' | null
  /** `#lang-de-ch`: marks a translation. */
  langTag: string
  /** `#translate-de-ch`: request a translation. */
  translateTag: string
  /** `#retranslate-de-ch`: request a translation and overwrite an edited or published one. */
  retranslateTag: string
  /**
   * *Translation review* (status page → Language mapping): translations into this language go
   * through Supertext's review service (`SUPERTEXT_REVIEW_URL`). Absent or false: directly to Supertext.
   */
  review?: boolean
}

export const TRANSLATE_ALL_TAG = '#translate-all'
export const RETRANSLATE_ALL_TAG = '#retranslate-all'

/** Ghost turns `#name` into the slug `hash-name`. */
export const tagSlug = (name: string) => `hash-${name.replace(/^#/, '').toLowerCase()}`

const languageSlug = (code: string) => code.trim().toLowerCase().replace(/_/g, '-')

export { languageLabel }

/** `de-CH,fr-CH` → languages. Duplicates and blanks are dropped. */
export function parseTargetLanguages(value: string, politeness: Record<string, Politeness> = {}, mapping: LanguageMapping = {}): Language[] {
  const seen = new Set<string>()
  const out: Language[] = []
  for (const raw of value.split(/[\s,;]+/)) {
    const code = raw.trim()
    if (!code) continue
    const slug = languageSlug(code)
    if (seen.has(slug)) continue
    seen.add(slug)
    const own = politeness[slug]
    const tone = own ?? politeness['*'] ?? 'default'
    const scope = tone === 'default' ? null : own ? 'language' : 'all'
    out.push(
      withTarget(
        {
          code,
          label: languageLabel(code),
          langTag: `#lang-${slug}`,
          politeness: tone,
          politenessScope: scope,
          politenessUnsupported: null,
          retranslateTag: `#retranslate-${slug}`,
          slug,
          target: null,
          translateTag: `#translate-${slug}`,
        },
        mapping,
      ),
    )
  }
  return out
}

function withTarget(language: Language, mapping: LanguageMapping): Language {
  const target = targetCodeOrNull(language.code, mapping)
  const unsupported = language.politenessScope !== null && target !== null && Languages.supportsPoliteness(target) === false
  return { ...language, politenessUnsupported: unsupported ? (language.politenessScope === 'language' ? 'blocked' : 'ignored') : null, target }
}

/** The same languages with their Supertext codes worked out again for `mapping` (after the mapping was saved). */
export function remapLanguages(languages: Language[], mapping: LanguageMapping): Language[] {
  return languages.map((l) => withTarget(l, mapping))
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
 * `de=de-CH,zh=zh-Hans` (or JSON `{"de":"de-CH"}`) → mapping of configured codes to Supertext
 * codes (`SUPERTEXT_LANGUAGE_MAP`). One mapping serves targets and the source language.
 */
export function parseLanguageMap(value: string | undefined): Record<string, string> {
  const raw = (value ?? '').trim()
  if (!raw) return {}
  if (raw.startsWith('{')) {
    try {
      const json = JSON.parse(raw) as unknown
      if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
      return Object.fromEntries(Object.entries(json).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== '').map(([k, v]) => [k.trim(), v.trim()]))
    } catch {
      return {}
    }
  }
  const out: Record<string, string> = {}
  for (const part of raw.split(/[\s,;]+/)) {
    const [from, to] = part.split('=')
    if (from?.trim() && to?.trim()) out[from.trim()] = to.trim()
  }
  return out
}

/**
 * Language codes come from the Supertext SDK (`Languages`), so every plugin uses the same rules:
 * the mapping wins, else a code that equals a Supertext code apart from case and `_`/`-`
 * (`de-CH`, `fr_ch` → `fr-CH`, `es`), else the SDK's default where one is obvious (`de` → `de-DE`,
 * `zh-TW` → `zh-Hant`, `es-ES` → `es`), else `SupertextError('unsupported_language')`.
 * Nothing else is guessed: `de-LI`, `en-IE`, `gsw` need a mapping.
 */
export const targetCode = (code: string, mapping: LanguageMapping = {}): string => Languages.target(code, mapping)

/** The target code, or null when the language has no mapping, exact match or default (status page, startup log). */
export function targetCodeOrNull(code: string, mapping: LanguageMapping = {}): string | null {
  try {
    return Languages.target(code, mapping)
  } catch {
    return null
  }
}

/** Supertext source code: the mapping's value or the code, as a bare language (`en-GB` → `en`). */
export const sourceCode = (code: string, mapping: LanguageMapping = {}): string => Languages.source(code, mapping)

/** The source code, or null when it isn't a Supertext source language. */
export function sourceCodeOrNull(code: string, mapping: LanguageMapping = {}): string | null {
  try {
    return Languages.source(code, mapping)
  } catch {
    return null
  }
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
