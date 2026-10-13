import { parse } from 'node-html-parser'
import { HtmlDocument } from 'supertext-sdk'

/**
 * One translatable unit: a post field, a Lexical paragraph (heading, list item...), or
 * an HTML field of a card. Each becomes one `<div data-st-id>` in the document sent to
 * Supertext, so a whole paragraph is translated as one sentence with its formatting as
 * inline tags.
 */
export type Segment = {
  /** Inline HTML sent to Supertext. */
  html: string
  /** Writes the translated inner HTML back; returns false if it could not be used. */
  apply: (translatedHtml: string) => boolean
  /** Where the text lives, for logs and error messages, e.g. `lexical.3` or `title`. */
  path: string
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Text content of an HTML fragment, whitespace collapsed. */
export const plainText = (fragment: string) => parse(fragment).text.replace(/\s+/g, ' ').trim()

/** A plain-text value (title, alt text...). Leading/trailing whitespace is kept as is. */
export function textSegment(value: unknown, path: string, set: (v: string) => void): Segment | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  const start = value.indexOf(text)
  const lead = value.slice(0, start)
  const trail = value.slice(start + text.length)
  return {
    apply: (translated) => {
      const t = plainText(translated)
      if (t === '') return false
      set(lead + t + trail)
      return true
    },
    html: escapeHtml(text),
    path,
  }
}

/** An HTML value (card caption, callout text...). Sent and written back as HTML. */
export function htmlSegment(value: unknown, path: string, set: (v: string) => void): Segment | null {
  if (typeof value !== 'string' || plainText(value) === '') return null
  return {
    apply: (translated) => {
      if (plainText(translated) === '') return false
      set(translated.trim())
      return true
    },
    html: value.trim(),
    path,
  }
}

/**
 * The HTML document for Supertext, one `<div data-st-id>` per segment (the SDK's
 * `HtmlDocument`). Every segment is inline HTML: plain fields are escaped first.
 */
export function buildHtml(segments: Segment[]): string {
  return HtmlDocument.build(segments.map((seg) => ({ html: true, text: seg.html })))
}

/** The translated inner HTML per segment, in order; `null` where the answer lost one. */
export function parseHtml(html: string, segments: Segment[]): (string | null)[] {
  return HtmlDocument.parse(html, segments.map(() => ({ html: true })))
}

/**
 * Writes translations into the segments. Segments the response lost (or that could not
 * be rebuilt) keep their source text; their paths are returned so the caller can report them.
 */
export function applyTranslations(segments: Segment[], translated: (string | null)[]): string[] {
  const missing: string[] = []
  segments.forEach((seg, i) => {
    const value = translated[i]
    if (value === null || value === undefined || !seg.apply(value)) missing.push(seg.path)
  })
  return missing
}
