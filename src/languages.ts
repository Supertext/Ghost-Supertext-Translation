import type { Politeness } from './supertext/client.js'

/**
 * A target language and the Ghost internal tags that belong to it.
 *
 * Ghost has no per-post language, so translations are separate posts marked with an
 * internal tag (`#lang-de-ch`). Editors request translations with internal tags too.
 */
export type Language = {
  /** Supertext target code as configured, e.g. `de-CH`. */
  code: string
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

export function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { languageDisplay: 'standard', type: 'language' }).of(code.replace(/_/g, '-')) ?? code
  } catch {
    return code
  }
}

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
 * Supertext expects the source as a primary subtag (`en`, not `en-GB`); a regional
 * source code is rejected with INVALID_LANGUAGE_PAIR. Targets keep their region.
 */
export function sourceCode(code: string): string {
  return code.split(/[-_]/)[0]?.trim().toLowerCase() ?? ''
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
 * Admin → Tags. `statusUrl` (the /supertext/ page, if served) is appended to request tags.
 */
export function managedTags(languages: Language[], statusUrl?: string): Array<{ name: string; description: string }> {
  const results = statusUrl ? ` Results: ${statusUrl}` : ''
  const tags = [
    { description: `Supertext: add to a post and save to translate it into every configured language.${results}`, name: TRANSLATE_ALL_TAG },
    {
      description: `Supertext: like #translate-all, but also overwrites translations that were edited or published.${results}`,
      name: RETRANSLATE_ALL_TAG,
    },
  ]
  for (const l of languages) {
    tags.push(
      { description: `Supertext: add to a post and save to get a ${l.label} draft.${results}`, name: l.translateTag },
      {
        description: `Supertext: like ${l.translateTag}, but also overwrites an edited or published ${l.label} translation.${results}`,
        name: l.retranslateTag,
      },
      { description: `Marks a ${l.label} translation (set by Supertext).`, name: l.langTag },
    )
  }
  return tags
}
