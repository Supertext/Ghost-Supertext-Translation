import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Supertext's logo, favicon and the bundled Inter font for the connector's own pages,
 * served from `public/` at STATIC_PATH. Outside /ghost/, so nothing here is ever proxied to Ghost.
 */
export const STATIC_PATH = '/supertext/static/'

const TYPES: Record<string, string> = {
  'favicon.svg': 'image/svg+xml',
  'fonts/Inter-LICENSE.txt': 'text/plain; charset=utf-8',
  'fonts/inter-latin-ext-wght-normal.woff2': 'font/woff2',
  'fonts/inter-latin-wght-normal.woff2': 'font/woff2',
  'supertext-logo.svg': 'image/svg+xml',
}

/** `public/` next to package.json: works from `src/` (tests), `dist/src/` (build) and the demo image. */
function publicDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'public', 'supertext-logo.svg'))) return join(dir, 'public')
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

const cache = new Map<string, Buffer>()
const root = publicDir()

/** The file for a path under STATIC_PATH (only the known files), or null. */
export function staticFile(name: string): { body: Buffer; type: string } | null {
  const type = TYPES[name]
  if (!type || !root) return null
  let body = cache.get(name)
  if (!body) {
    try {
      body = readFileSync(join(root, name))
    } catch {
      return null
    }
    cache.set(name, body)
  }
  return { body, type }
}

/** URL of a static file; `?v=` changes with the connector version, so a year of caching is safe. */
export const staticUrl = (name: string, version: string) => `${STATIC_PATH}${name}?v=${encodeURIComponent(version)}`

const LATIN =
  'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'

/** @font-face rules for the bundled Inter (variable weight, Latin and Latin Extended). */
export const fontFaces = (version: string) =>
  [
    ['inter-latin-wght-normal.woff2', LATIN],
    ['inter-latin-ext-wght-normal.woff2', LATIN_EXT],
  ]
    .map(
      ([file, range]) =>
        `@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url("${staticUrl(`fonts/${file}`, version)}") format("woff2");unicode-range:${range}}`,
    )
    .join('\n')
