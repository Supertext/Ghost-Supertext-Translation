import type { Localizable } from './i18n/index.js'
import type { Resource } from './ghost/admin.js'
import { type Language, sourceCodeOrNull } from './languages.js'
import type { Segment } from './segments.js'
import type { TranslateResult } from './translate.js'
import { type FileSegment, type TranslationFile, TranslationFileError, TranslationFiles } from './vendor/supertext-sdk/index.js'

/**
 * Translation files: "Export for translation" (XLIFF 1.2 or HTML) and "Import translation"
 * on the connector's own page, on top of the Supertext SDK's `TranslationFiles` (SDK 0.5.0).
 * Segments and keys are the ones a Supertext translation uses (`collect()`, key = segment
 * path), and imports are written by the same Translator (a draft, the same overwrite rules).
 *
 * Reference: `<post|page>:<Ghost id>:<language code>`, e.g. `post:65f1c0…:de-CH`.
 */
export const PLUGIN = 'Ghost-Supertext-Translation'
const SHORT_NAME = 'ghost'
/** Uploads above this size (bytes) are refused before they are read. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const FORMATS = {
  html: { contentType: 'text/html; charset=utf-8', extension: 'html' },
  xliff: { contentType: 'application/x-xliff+xml', extension: 'xlf' },
} as const
export type Format = keyof typeof FORMATS

export type FileRef = { resource: Resource; id: string; language: string }

/** An error of the export/import glue: `files.error.<code>` with `params`. */
export class FilesError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, string> = {},
    readonly status = 400,
  ) {
    super(code)
    this.name = 'FilesError'
  }

  get localized(): Localizable {
    return { key: `files.error.${this.code}` as Localizable['key'], params: this.params }
  }
}

export function formatReference(ref: FileRef): string {
  return `${ref.resource === 'pages' ? 'page' : 'post'}:${ref.id}:${ref.language}`
}

/** The reference's parts, or null for anything else. */
export function parseReference(reference: string): FileRef | null {
  const m = /^(post|page):([0-9a-f]{1,64}):([A-Za-z0-9_-]{1,35})$/.exec(String(reference ?? ''))
  return m ? { id: m[2]!, language: m[3]!, resource: m[1] === 'page' ? 'pages' : 'posts' } : null
}

/** The SDK's segments: plain-text fields as plain text, the rest as HTML; key = segment path. */
export function segmentsOf(segments: Segment[]): FileSegment[] {
  return segments.map((s) => (s.text !== undefined ? { key: s.path, text: s.text } : { html: true, key: s.path, text: s.html }))
}

const safeName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_')

/**
 * The file for one post or page: XLIFF with one job per target language, or HTML for exactly
 * one. Languages: the Supertext codes in use (mapping, exact match, default); a language without
 * one keeps its own code with `_` as `-`, so unmapped languages don't block the export.
 */
export function buildExport(args: {
  resource: Resource
  id: string
  sourceLanguage: string
  targets: Language[]
  format: Format
  segments: Segment[]
  languageMap?: Record<string, string>
}): { filename: string; contentType: string; content: string } {
  const kind = FORMATS[args.format]
  if (!kind) throw new FilesError('invalid_format')
  if (!args.targets.length) throw new FilesError('no_targets')
  if (args.format === 'html' && args.targets.length !== 1) throw new FilesError('one_target')
  if (!args.segments.length) throw new FilesError('nothing_to_translate')
  const segments = segmentsOf(args.segments)
  const sourceLanguage = sourceCodeOrNull(args.sourceLanguage, args.languageMap ?? {}) ?? args.sourceLanguage.replace(/_/g, '-')
  const jobs = args.targets.map((l) => ({
    plugin: PLUGIN,
    reference: formatReference({ id: args.id, language: l.code, resource: args.resource }),
    segments,
    sourceLanguage,
    targetLanguage: l.target ?? l.code.replace(/_/g, '-'),
  }))
  let content: string
  try {
    content = args.format === 'html' ? TranslationFiles.exportHtml(jobs[0]!) : TranslationFiles.exportXliff(jobs)
  } catch (err) {
    if (err instanceof TranslationFileError && err.code === 'invalid_job') throw new FilesError('nothing_to_translate')
    throw err
  }
  const suffix = args.targets.length === 1 ? `-${args.targets[0]!.code}` : ''
  return { content, contentType: kind.contentType, filename: safeName(`${SHORT_NAME}-${args.id}${suffix}.${kind.extension}`) }
}

export type Counts = { ok: number; source_changed: number; untranslated: number; invalid_markup: number; missing: number }
const emptyCounts = (): Counts => ({ invalid_markup: 0, missing: 0, ok: 0, source_changed: 0, untranslated: 0 })

/** What to write: `ok`, and `source_changed` only with `includeChanged`. */
export function planImport(file: TranslationFile, segments: Segment[], includeChanged = false): { counts: Counts; accepted: Map<string, string> } {
  const counts = emptyCounts()
  const accepted = new Map<string, string>()
  for (const r of TranslationFiles.importTranslations(file, segmentsOf(segments))) {
    counts[r.status]++
    if (r.text !== null && (r.status === 'ok' || (r.status === 'source_changed' && includeChanged))) accepted.set(r.key, r.text)
  }
  return { accepted, counts }
}

/** One job of an imported file, for the summary. */
export type ImportJob = {
  reference: string
  resource: Resource | null
  id: string | null
  language: string | null
  title: string | null
  counts: Counts
  imported: number
  skippedChanged: number
  /** The Translator's result when something was written (created, updated, kept, failed). */
  result: TranslateResult | null
  error: Localizable | null
}

export type ImportOptions = {
  languages: Language[]
  includeChanged?: boolean
  /** The source post's current segments and title; null if it doesn't exist. */
  load: (ref: FileRef) => Promise<{ title: string; segments: Segment[] } | null>
  /** Writes the accepted translations through the Translator. */
  write: (ref: FileRef, language: Language, translations: Map<string, string>) => Promise<TranslateResult>
}

/**
 * Reads an uploaded file and writes each job. A too large upload (FilesError `too_large`) and
 * `read` errors (TranslationFileError) are thrown; everything else is reported per job.
 */
export async function importFile(content: string, opts: ImportOptions): Promise<ImportJob[]> {
  if (Buffer.byteLength(content, 'utf8') > MAX_UPLOAD_BYTES) throw new FilesError('too_large', {}, 413)
  const files = TranslationFiles.read(content)
  const out: ImportJob[] = []
  for (const file of files) {
    const job: ImportJob = {
      counts: emptyCounts(),
      error: null,
      id: null,
      imported: 0,
      language: null,
      reference: file.reference,
      resource: null,
      result: null,
      skippedChanged: 0,
      title: null,
    }
    out.push(job)
    try {
      if (file.plugin !== PLUGIN) throw new FilesError('other_system', { plugin: file.plugin })
      const ref = parseReference(file.reference)
      if (!ref) throw new FilesError('not_found')
      Object.assign(job, { id: ref.id, language: ref.language, resource: ref.resource })
      const language = opts.languages.find((l) => l.code === ref.language)
      if (!language) throw new FilesError('no_language', { language: ref.language })
      const item = await opts.load(ref)
      if (!item) throw new FilesError('not_found')
      job.title = item.title
      const plan = planImport(file, item.segments, opts.includeChanged)
      job.counts = plan.counts
      job.skippedChanged = opts.includeChanged ? 0 : plan.counts.source_changed
      if (plan.accepted.size) {
        job.result = await opts.write(ref, language, plan.accepted)
        if (job.result.status === 'created' || job.result.status === 'updated') job.imported = plan.accepted.size
      }
    } catch (err) {
      if (!(err instanceof FilesError)) throw err
      job.error = err.localized
    }
  }
  return out
}
