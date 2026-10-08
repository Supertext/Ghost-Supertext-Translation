import { readFileSync, statSync } from 'node:fs'

import { type Language, parsePoliteness, parseTargetLanguages } from './languages.js'
import { SUPERTEXT_ENVIRONMENTS } from './supertext/client.js'

/**
 * All settings come from environment variables (see docs/INSTALLATION.md → All settings).
 * The Ghost key and webhook secret may instead come from a JSON file
 * (`GHOST_SETTINGS_FILE`), which the demo writes after creating the integration; it is
 * re-read whenever it changes.
 */
export type Config = {
  port: number
  host: string
  /** Public URL of the Ghost site. */
  siteUrl: string
  /** Proxy mode: Ghost's own address; the connector serves the site and adds /supertext/. */
  upstream: string | null
  supertextApiKey: string
  supertextApiUrl: string
  sourceLanguage: string
  languages: Language[]
  /** `en`, `de`, `fr`, `it`, or `auto` (status page follows the browser's Accept-Language). */
  uiLanguage: string
  settingsFile: string | null
  jobsFile: string | null
  /** Admin API key and webhook secret (env first, then the settings file). */
  ghostSecrets: () => { adminKey: string; webhookSecret: string }
}

const env = (name: string, fallback = '') => (process.env[name] ?? '').trim() || fallback

export function loadConfig(): Config {
  const upstream = env('GHOST_UPSTREAM') || null
  const siteUrl = (env('GHOST_URL') || env('url') || (env('RAILWAY_PUBLIC_DOMAIN') ? `https://${env('RAILWAY_PUBLIC_DOMAIN')}` : '')).replace(/\/+$/, '')
  if (!siteUrl) throw new Error('GHOST_URL is not set (the public URL of your Ghost site).')
  const settingsFile = env('GHOST_SETTINGS_FILE') || null

  let cache: { mtime: number; data: Record<string, string> } | null = null
  const fileSecrets = (): Record<string, string> => {
    if (!settingsFile) return {}
    try {
      const mtime = statSync(settingsFile).mtimeMs
      if (!cache || cache.mtime !== mtime) cache = { data: JSON.parse(readFileSync(settingsFile, 'utf8')), mtime }
      return cache.data
    } catch {
      return {}
    }
  }

  return {
    ghostSecrets: () => {
      const file = fileSecrets()
      return {
        adminKey: env('GHOST_ADMIN_API_KEY') || file.adminKey || '',
        webhookSecret: env('GHOST_WEBHOOK_SECRET') || file.webhookSecret || '',
      }
    },
    host: env('HOST', '0.0.0.0'),
    jobsFile: env('JOBS_FILE') || null,
    languages: parseTargetLanguages(env('TARGET_LANGUAGES', 'de-CH,fr-CH'), parsePoliteness(env('SUPERTEXT_POLITENESS'))),
    port: Number(env('PORT', '8080')),
    settingsFile,
    siteUrl,
    sourceLanguage: env('SOURCE_LANGUAGE', 'en'),
    supertextApiKey: env('SUPERTEXT_API_KEY'),
    supertextApiUrl: env('SUPERTEXT_API_URL', SUPERTEXT_ENVIRONMENTS.live),
    uiLanguage: env('UI_LANGUAGE', 'auto').toLowerCase(),
    upstream,
  }
}
