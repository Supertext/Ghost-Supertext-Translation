import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = 'ghost-supertext-translation'
const RELEASES_URL = 'https://github.com/Supertext/Ghost-Supertext-Translation/releases/tag/'

/**
 * The connector's version, read once from its package.json (the only place it is set).
 * Searches upward from this file, so it works from `src/` (tests), `dist/src/` (build) and
 * the demo image (`/opt/supertext/dist/src/` next to `/opt/supertext/package.json`).
 */
function readVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    const file = join(dir, 'package.json')
    if (existsSync(file)) {
      try {
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string }
        if (pkg.name === PACKAGE_NAME && pkg.version) return pkg.version
      } catch {
        // not ours or unreadable; keep looking
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return 'unknown'
    dir = parent
  }
}

export const VERSION = readVersion()

/** GitHub release page for a release version (X.Y.Z), else undefined. */
export function releaseUrl(version: string): string | undefined {
  return /^\d+\.\d+\.\d+$/.test(version) ? `${RELEASES_URL}v${version}` : undefined
}
