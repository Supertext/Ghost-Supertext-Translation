import { fromInlineHtml, isObject, isTextNode, type LexicalNode, toInlineHtml } from './lexical.js'
import { htmlSegment, type Segment, textSegment } from './segments.js'

/** Post/page fields sent for translation. Everything else is copied or left alone. */
export const TEXT_FIELDS = [
  'title',
  'custom_excerpt',
  'feature_image_alt',
  'meta_title',
  'meta_description',
  'og_title',
  'og_description',
  'twitter_title',
  'twitter_description',
  'email_subject',
] as const
export const HTML_FIELDS = ['feature_image_caption'] as const

/** Lexical elements whose children are inline content: one segment each. */
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'extended-heading', 'quote', 'extended-quote', 'aside', 'listitem'])

/**
 * Text properties of Ghost's cards (Koenig decorator nodes). `html` values hold inline
 * HTML and are sent as such; `text` values are plain strings. Cards that are not listed
 * (HTML, Markdown, code, embeds' content, email-only cards...) are copied unchanged.
 */
export const CARD_FIELDS: Record<string, { html?: string[]; text?: string[] }> = {
  audio: { text: ['title'] },
  bookmark: { html: ['caption'] },
  button: { text: ['buttonText'] },
  'call-to-action': { html: ['textValue', 'sponsorLabel'], text: ['buttonText'] },
  callout: { html: ['calloutText'] },
  embed: { html: ['caption'] },
  file: { text: ['fileTitle', 'fileCaption'] },
  gallery: { html: ['caption'] },
  header: { html: ['header', 'subheader'], text: ['buttonText'] },
  image: { html: ['caption'], text: ['alt', 'title'] },
  product: { html: ['productTitle', 'productDescription'], text: ['productButtonText'] },
  signup: { html: ['header', 'subheader', 'disclaimer'], text: ['buttonText', 'successMessage'] },
  toggle: { html: ['heading', 'content'] },
  video: { html: ['caption'] },
}

export type Collected = {
  segments: Segment[]
  /** Translated values are written here (a copy of the source fields). */
  fields: Record<string, unknown>
  /** Copy of the Lexical document; translations are written into it. Null if the post has none. */
  lexical: { root: LexicalNode } | null
}

export type SourcePost = Record<string, unknown> & { lexical?: string | null }

export function collect(post: SourcePost): Collected {
  const segments: Segment[] = []
  const add = (s: Segment | null) => s && segments.push(s)
  const fields: Record<string, unknown> = {}

  for (const key of TEXT_FIELDS) {
    if (!(key in post)) continue
    fields[key] = post[key]
    add(textSegment(post[key], key, (v) => (fields[key] = v)))
  }
  for (const key of HTML_FIELDS) {
    if (!(key in post)) continue
    fields[key] = post[key]
    add(htmlSegment(post[key], key, (v) => (fields[key] = v)))
  }

  let lexical: Collected['lexical'] = null
  if (typeof post.lexical === 'string' && post.lexical.trim() !== '') {
    const parsed = JSON.parse(post.lexical) as unknown
    if (isObject(parsed) && isObject(parsed.root)) {
      lexical = { ...parsed, root: structuredClone(parsed.root) }
      walk(lexical.root, 'lexical', add)
    }
  }
  return { fields, lexical, segments }
}

function walk(node: LexicalNode, path: string, add: (s: Segment | null) => void): void {
  const type = String(node.type ?? '')
  const children = Array.isArray(node.children) ? node.children : undefined

  if (children && TEXT_BLOCKS.has(type) && !children.some((c) => isObject(c) && c.type === 'list')) {
    add(blockSegment(node, children, path))
    return
  }
  if (children) {
    children.forEach((c, i) => isObject(c) && walk(c, `${path}.${i}`, add))
    return
  }

  const card = CARD_FIELDS[type]
  if (!card) return
  for (const key of card.html ?? []) add(htmlSegment(node[key], `${path}.${type}.${key}`, (v) => (node[key] = v)))
  for (const key of card.text ?? []) add(textSegment(node[key], `${path}.${type}.${key}`, (v) => (node[key] = v)))
  if (type === 'gallery' && Array.isArray(node.images)) {
    node.images.forEach((img, i) => {
      if (!isObject(img)) return
      add(htmlSegment(img.caption, `${path}.gallery.images.${i}.caption`, (v) => (img.caption = v)))
      add(textSegment(img.alt, `${path}.gallery.images.${i}.alt`, (v) => (img.alt = v)))
    })
  }
}

function blockSegment(node: LexicalNode, children: unknown[], path: string): Segment | null {
  const nodes: LexicalNode[] = []
  const html = toInlineHtml(children, nodes)
  const hasText = children.some(function hasText(c): boolean {
    if (!isObject(c)) return false
    if (isTextNode(c)) return (c.text as string).trim() !== ''
    return Array.isArray(c.children) && c.children.some(hasText)
  })
  if (!hasText) return null
  const textType = (children.find((c) => isObject(c) && isTextNode(c)) as LexicalNode | undefined)?.type
  return {
    apply: (translated) => {
      const rebuilt = fromInlineHtml(translated, nodes, typeof textType === 'string' ? textType : undefined)
      if (!rebuilt) return false
      node.children = rebuilt
      return true
    },
    html,
    path: `${path}.${node.type}`,
  }
}
