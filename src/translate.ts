import { createHash } from 'node:crypto'

import { collect } from './collect.js'
import { type GhostAdmin, GhostError, type GhostPost, type Resource } from './ghost/admin.js'
import { type Language, sourceCode } from './languages.js'
import { applyTranslations, buildHtml, parseHtml } from './segments.js'
import { format, type Localizable } from './i18n/index.js'
import { API_KEY_URL, SIGNUP_URL, type SupertextClient, SupertextError } from './supertext/client.js'

export type ResultStatus = 'created' | 'updated' | 'kept' | 'skipped' | 'failed'

export type TranslateResult = {
  status: ResultStatus
  /** One sentence for editors and logs, in English. */
  message: string
  /** The same message as catalog keys, so the status page can show it in the reader's language. */
  localized: Localizable[]
  translationId?: string
  translationTitle?: string
  /** Paths of segments that came back empty and kept the source text. */
  missing?: string[]
}

/**
 * Each translation carries a marker in its code injection (head) that links it to its
 * source and records a hash of the content Supertext wrote:
 *   <!-- supertext:source=<source id>;lang=<code>;hash=<16 hex> -->
 * An HTML comment is invisible on the page and survives every edit in Ghost Admin.
 */
const MARKER = /<!-- supertext:source=([0-9a-f]+);lang=([A-Za-z_-]+);hash=([0-9a-f]*) -->\n?/

export const markerFor = (sourceId: string, lang: string, hash: string) =>
  `<!-- supertext:source=${sourceId};lang=${lang};hash=${hash} -->`

export function readMarker(head: unknown): { source: string; lang: string; hash: string } | null {
  const m = typeof head === 'string' ? head.match(MARKER) : null
  return m ? { hash: m[3] ?? '', lang: m[2] ?? '', source: m[1] ?? '' } : null
}

const stripMarker = (head: unknown) => (typeof head === 'string' ? head.replace(MARKER, '') : '')

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    )
  }
  return v
}

/** Hash of what an editor would change: title, excerpt and body. */
export function contentHash(post: { title?: unknown; custom_excerpt?: unknown; lexical?: unknown }): string {
  let body: unknown = post.lexical ?? null
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      // hash the raw string
    }
  }
  const json = JSON.stringify(canonical({ body, excerpt: post.custom_excerpt ?? null, title: post.title ?? '' }))
  return createHash('sha256').update(json).digest('hex').slice(0, 16)
}

/** Fields copied unchanged from the source to a new translation. */
const COPIED_FIELDS = [
  'feature_image',
  'og_image',
  'twitter_image',
  'visibility',
  'featured',
  'custom_template',
  'codeinjection_foot',
  'canonical_url',
] as const

export type TranslatorOptions = {
  ghost: GhostAdmin
  /** Null when no API key is configured: every request then fails with a clear message. */
  supertext: SupertextClient | null
  sourceLanguage: string
  log?: (message: string) => void
}

/** A result whose English `message` is built from its `localized` messages. */
function result(status: ResultStatus, localized: Localizable[], extra: Partial<TranslateResult> = {}): TranslateResult {
  return { ...extra, localized, message: format('en', localized), status }
}

export class Translator {
  constructor(private readonly opts: TranslatorOptions) {}

  async translate(resource: Resource, id: string, language: Language, force: boolean): Promise<TranslateResult> {
    try {
      return await this.run(resource, id, language, force)
    } catch (err) {
      const localized: Localizable[] =
        err instanceof SupertextError || err instanceof GhostError
          ? err.localized
          : [{ key: 'job.unexpected', params: { error: err instanceof Error ? err.message : String(err) } }]
      return result('failed', localized)
    }
  }

  private async run(resource: Resource, id: string, language: Language, force: boolean): Promise<TranslateResult> {
    const { ghost } = this.opts
    const kind = resource === 'posts' ? 'post' : 'page'
    const isPost = resource === 'posts'
    const source = await ghost.getPost(resource, id)

    if ((source.tags ?? []).some((t) => (t.slug ?? '').startsWith('hash-lang-')) || readMarker(source.codeinjection_head)) {
      return result('skipped', [{ key: isPost ? 'job.isTranslationPost' : 'job.isTranslationPage' }])
    }
    if (!source.lexical) {
      return result('failed', [{ key: isPost ? 'job.noLexicalPost' : 'job.noLexicalPage' }])
    }
    if (!this.opts.supertext) {
      return result('failed', [{ key: 'job.noApiKey', params: { apiKeyUrl: API_KEY_URL, signupUrl: SIGNUP_URL } }])
    }

    const existing = (
      await ghost.findPosts(resource, `codeinjection_head:~'supertext:source=${source.id};lang=${language.code};'`)
    )[0]
    if (existing && !force) {
      const marker = readMarker(existing.codeinjection_head)
      const kept = { translationId: existing.id, translationTitle: existing.title }
      const params = { language: language.code, retranslateTag: language.retranslateTag }
      if (existing.status !== 'draft') {
        const state = String(existing.status)
        const key =
          state === 'published' ? 'job.keptPublished' : state === 'scheduled' ? 'job.keptScheduled' : state === 'sent' ? 'job.keptSent' : 'job.keptOther'
        return result('kept', [{ key, params: { ...params, state } }], kept)
      }
      if (marker?.hash !== contentHash(existing)) {
        return result('kept', [{ key: 'job.keptEdited', params }], kept)
      }
    }

    const collected = collect(source)
    const html = buildHtml(collected.segments)
    this.opts.log?.(
      `Translating ${kind} ${source.id} "${source.title}" into ${language.code}: ${collected.segments.length} segments, ${html.length} characters`,
    )
    const translatedHtml = await this.opts.supertext.translateHtml({
      html,
      politeness: language.politeness,
      sourceLang: sourceCode(this.opts.sourceLanguage),
      targetLang: language.code,
    })
    const missing = applyTranslations(collected.segments, parseHtml(translatedHtml))

    const lexical = collected.lexical ? JSON.stringify(collected.lexical) : source.lexical
    const fields: Record<string, unknown> = { ...collected.fields, lexical }
    const hash = contentHash(fields)
    const tags = (source.tags ?? [])
      .filter((t) => t.visibility !== 'internal' && !t.name.startsWith('#'))
      .map((t) => ({ id: t.id }))
    const payload: Record<string, unknown> = {
      ...fields,
      authors: (source.authors ?? []).map((a) => ({ id: a.id })),
      codeinjection_head: `${markerFor(source.id, language.code, hash)}\n${stripMarker(source.codeinjection_head)}`.trimEnd(),
      tags: [...tags, { name: language.langTag }],
    }
    for (const key of COPIED_FIELDS) if (key in source) payload[key] = source[key]
    if (source.visibility === 'tiers' && Array.isArray(source.tiers)) payload.tiers = source.tiers

    let saved: GhostPost
    if (existing) {
      saved = await ghost.editPost(resource, existing.id, { ...payload, updated_at: existing.updated_at })
    } else {
      saved = await ghost.addPost(resource, { ...payload, status: 'draft' })
    }
    // Ghost may normalise the Lexical JSON; record the hash of what it stored.
    const storedHash = contentHash(saved)
    if (storedHash !== hash) {
      saved = await ghost.editPost(resource, saved.id, {
        codeinjection_head: `${markerFor(source.id, language.code, storedHash)}\n${stripMarker(saved.codeinjection_head)}`.trimEnd(),
        updated_at: saved.updated_at,
      })
    }

    const messages: Localizable[] = [
      { key: existing ? 'job.updated' : 'job.created', params: { language: language.code, title: saved.title } },
    ]
    if (missing.length) messages.push({ key: 'job.partly', params: { count: missing.length } })
    return result(existing ? 'updated' : 'created', messages, {
      missing,
      translationId: saved.id,
      translationTitle: saved.title,
    })
  }
}
