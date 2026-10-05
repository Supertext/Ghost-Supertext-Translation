import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { collect } from '../src/collect.js'
import { applyTranslations, buildHtml, parseHtml } from '../src/segments.js'

/** Lexical of a real Ghost 6 post (created from HTML via the Admin API) plus a few extra cards. */
const lexical = readFileSync(new URL('fixtures/probe-lexical.json', import.meta.url), 'utf8')

const post = (extra: Record<string, unknown> = {}) => ({
  custom_excerpt: 'An excerpt',
  feature_image_alt: '',
  feature_image_caption: 'Photo by <a href="https://example.com">Jo</a>',
  id: 'p1',
  lexical,
  meta_title: null,
  title: '  Why Swiss teams ',
  ...extra,
})

/** "Translates" every segment by upper-casing text outside tags. */
const shout = (html: string) => html.replace(/>([^<]*)</g, (_, t: string) => `>${t.toUpperCase()}<`)

describe('collect', () => {
  it('finds post fields, Lexical blocks and card texts', () => {
    const { segments } = collect(post())
    expect(segments.map((s) => s.path)).toEqual([
      'title',
      'custom_excerpt',
      'feature_image_caption',
      'lexical.0.extended-heading',
      'lexical.1.paragraph',
      'lexical.2.0.listitem',
      'lexical.2.1.listitem',
      'lexical.3.extended-quote',
      'lexical.4.image.caption',
      'lexical.4.image.alt',
      'lexical.5.callout.calloutText',
      'lexical.7.button.buttonText',
      'lexical.8.toggle.heading',
      'lexical.8.toggle.content',
      'lexical.9.gallery.caption',
      'lexical.9.gallery.images.0.caption',
      'lexical.9.gallery.images.0.alt',
    ])
  })

  it('sends one element per paragraph with formatting and links as inline tags', () => {
    const { segments } = collect(post())
    const html = buildHtml(segments)
    expect(html).toContain(
      '<div data-st-id="4">Hello <b data-n="0">bold world</b> and <a data-n="1" href="https://supertext.com">a link</a>.<br data-n="2">Line two.</div>',
    )
    expect(html).toContain('<div data-st-id="3">Why <i data-n="0">Swiss</i> teams</div>')
    // inline code is marked as not to translate
    expect(html).toContain('One <code data-n="0" translate="no">x</code>')
    // card HTML goes as is, plain values are escaped
    expect(html).toContain('<div data-st-id="13"><p>Yes, very.</p><p>Second paragraph.</p></div>')
    expect(html).not.toContain('Raw HTML stays')
    expect(html).not.toContain('const x')
  })

  it('writes translations back into fields, Lexical nodes and cards', () => {
    const c = collect(post())
    const translated = parseHtml(shout(buildHtml(c.segments)))
    expect(applyTranslations(c.segments, translated)).toEqual([])

    expect(c.fields.title).toBe('  WHY SWISS TEAMS ')
    expect(c.fields.custom_excerpt).toBe('AN EXCERPT')
    expect(c.fields.feature_image_caption).toBe('PHOTO BY <a href="https://example.com">JO</a>')
    const root = c.lexical!.root as { children: Array<Record<string, any>> }
    const p = root.children[1]!
    expect(p.children.map((n: any) => [n.type, n.text ?? n.url, n.format])).toEqual([
      ['extended-text', 'HELLO ', 0],
      ['extended-text', 'BOLD WORLD', 1],
      ['extended-text', ' AND ', 0],
      ['link', 'https://supertext.com', ''],
      ['extended-text', '.', 0],
      ['linebreak', undefined, undefined],
      ['extended-text', 'LINE TWO.', 0],
    ])
    expect(p.children[3].children[0].text).toBe('A LINK')
    expect(root.children[4]!.caption).toBe('A <b>CAPTION</b>')
    expect(root.children[4]!.alt).toBe('ALT TEXT')
    expect(root.children[4]!.src).toBe('https://example.com/a.jpg')
    expect(root.children[5]!.calloutText).toBe('CALLOUT <b>TEXT</b>')
    expect(root.children[7]!.buttonText).toBe('GET STARTED')
    expect(root.children[7]!.buttonUrl).toBe('https://supertext.com')
    expect(root.children[8]!.content).toBe('<p>YES, VERY.</p><p>SECOND PARAGRAPH.</p>')
    expect(root.children[9]!.images[0].alt).toBe('FIRST IMAGE')
    expect(root.children[10]!.html).toBe('<p>Raw HTML stays</p>')
    // the source document is untouched
    expect(lexical).toContain('"text": "bold world"')
  })

  it('keeps formatting on the right words when the translator reorders them', () => {
    const c = collect(post())
    const seg = 4 // the paragraph
    const translated = parseHtml(buildHtml(c.segments))
    translated.set(seg, '<a data-n="1" href="https://supertext.com">Ein Link</a> und <b data-n="0">fette Welt</b>, hallo.<br data-n="2">Zeile zwei.')
    applyTranslations(c.segments, translated)
    const p = (c.lexical!.root as any).children[1]
    expect(p.children.map((n: any) => n.type)).toEqual(['link', 'extended-text', 'extended-text', 'extended-text', 'linebreak', 'extended-text'])
    expect(p.children[0].children[0].text).toBe('Ein Link')
    expect(p.children[2]).toMatchObject({ format: 1, text: 'fette Welt' })
  })

  it('keeps the source text for segments the response lost', () => {
    const c = collect(post())
    const translated = parseHtml(shout(buildHtml(c.segments)))
    translated.delete(4)
    translated.set(0, '   ')
    expect(applyTranslations(c.segments, translated)).toEqual(['title', 'lexical.1.paragraph'])
    expect(c.fields.title).toBe('  Why Swiss teams ')
    expect((c.lexical!.root as any).children[1].children[1].text).toBe('bold world')
  })

  it('handles posts without Lexical content', () => {
    const c = collect({ id: 'x', lexical: null, title: 'Only a title' })
    expect(c.lexical).toBeNull()
    expect(c.segments.map((s) => s.path)).toEqual(['title'])
  })
})
