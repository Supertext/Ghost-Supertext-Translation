import { type HTMLElement, type Node as HtmlNode, NodeType, parse } from 'node-html-parser'

import { escapeHtml } from './segments.js'

/**
 * Lexical inline content (Ghost's Koenig editor) <-> HTML fragment, so a whole paragraph
 * is translated as one sentence while bold, italic, links etc. stay on the right words.
 *
 * Every inline node except unformatted text is tagged with `data-n` (its index in
 * `nodes`). Rebuilding clones the original node for each tag and creates plain text
 * nodes for bare text.
 */

export type LexicalNode = { [key: string]: unknown; children?: unknown[]; type?: unknown }

export const isObject = (v: unknown): v is LexicalNode => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Ghost writes `extended-text`; plain Lexical uses `text`. */
export const isTextNode = (n: LexicalNode) => (n.type === 'text' || n.type === 'extended-text') && typeof n.text === 'string'

// Lexical text format bits → the tag that shows the translator what the run is.
const FORMAT_TAGS: Array<[number, string]> = [
  [1, 'b'],
  [2, 'i'],
  [8, 'u'],
  [4, 's'],
  [16, 'code'],
  [32, 'sub'],
  [64, 'sup'],
  [128, 'mark'],
]

const isPlainText = (n: LexicalNode) => isTextNode(n) && !n.format && !n.style && (n.mode === undefined || n.mode === 'normal')

export function toInlineHtml(children: unknown[], nodes: LexicalNode[]): string {
  return children
    .map((child) => {
      if (!isObject(child)) return ''
      if (isTextNode(child)) {
        const text = child.text as string
        if (isPlainText(child)) return escapeHtml(text)
        const n = nodes.push(child) - 1
        const tag = FORMAT_TAGS.find(([bit]) => Number(child.format) & bit)?.[1] ?? 'span'
        // Inline code stays as is.
        const no = Number(child.format) & 16 ? ' translate="no"' : ''
        return `<${tag} data-n="${n}"${no}>${escapeHtml(text)}</${tag}>`
      }
      if (child.type === 'linebreak') return `<br data-n="${nodes.push(child) - 1}">`
      if (child.type === 'tab') return `<span data-n="${nodes.push(child) - 1}" translate="no">\t</span>`
      const n = nodes.push(child) - 1
      if (Array.isArray(child.children)) {
        const url = typeof child.url === 'string' ? child.url : undefined
        const isLink = child.type === 'link' || child.type === 'autolink' || child.type === 'at-link'
        const href = isLink && url ? ` href="${escapeHtml(url)}"` : ''
        const tag = isLink ? 'a' : 'span'
        return `<${tag} data-n="${n}"${href}>${toInlineHtml(child.children, nodes)}</${tag}>`
      }
      // Anything else inline is kept as is.
      return `<span data-n="${n}" translate="no"></span>`
    })
    .join('')
}

const textNode = (text: string, type: string): LexicalNode => ({
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
  text,
  type,
  version: 1,
})

function rebuild(parent: HTMLElement, nodes: LexicalNode[], used: Set<number>, textType: string): LexicalNode[] {
  const out: LexicalNode[] = []
  for (const child of parent.childNodes as HtmlNode[]) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      const text = child.text
      if (text !== '') out.push(textNode(text, textType))
      continue
    }
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue
    const el = child as HTMLElement
    const n = Number(el.getAttribute('data-n'))
    const orig = Number.isInteger(n) ? nodes[n] : undefined
    if (!orig || used.has(n)) {
      // A tag the translator added or duplicated: keep its text, drop the tag.
      out.push(...rebuild(el, nodes, used, textType))
      continue
    }
    used.add(n)
    const copy = structuredClone(orig)
    if (isTextNode(orig)) {
      copy.text = el.text
      if (copy.text !== '') out.push(copy)
    } else if (Array.isArray(orig.children)) {
      copy.children = rebuild(el, nodes, used, textType)
      out.push(copy)
    } else {
      out.push(copy)
    }
  }
  return out
}

/**
 * Rebuilds Lexical children from translated inline HTML; null if nothing usable came back.
 * `textType` is the node type for new plain text (`extended-text` in Ghost).
 */
export function fromInlineHtml(html: string, nodes: LexicalNode[], textType = 'extended-text'): LexicalNode[] | null {
  const root = parse(`<div>${html}</div>`).querySelector('div')
  if (!root) return null
  const children = rebuild(root, nodes, new Set(), textType)
  const first = children[0]
  if (first && isTextNode(first)) first.text = (first.text as string).replace(/^\s+/, '')
  const last = children[children.length - 1]
  if (last && isTextNode(last)) last.text = (last.text as string).replace(/\s+$/, '')
  const result = children.filter((c) => !(isTextNode(c) && c.text === ''))
  return result.length ? result : null
}
