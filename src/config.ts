import { readFileSync, statSync } from 'node:fs'

import { settingsPath } from './settings.js'
import { type Language, parseLanguageMap, parsePoliteness, parseTargetLanguages } from './languages.js'
import { reportsEnabled } from './vendor/supertext-plugin-health/index.js'
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
  /**
   * `SUPERTEXT_LANGUAGE_MAP`: configured code → Supertext code (targets and source). Overrides
   * the mapping chosen on the status page (`SUPERTEXT_SETTINGS_FILE`) for the languages it names.
   */
  languageMap: Record<string, string>
  /** "Send version information to Supertext": `SUPERTEXT_VERSION_REPORTS` (default on). */
  versionReports: boolean
  /** Public URL of the connector in setup B (`CONNECTOR_URL`), for the ping address; null if not set. */
  connectorUrl: string | null
  /** JSON file for the Commando Center state (what was reported, the latest key check). */
  stateFile: string | null
  /** JSON file for the settings chosen on the status page (`SUPERTEXT_SETTINGS_FILE`, else next to `STATE_FILE`). */
  connectorSettingsFile?: string | null
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

  const languageMap = parseLanguageMap(env('SUPERTEXT_LANGUAGE_MAP'))
  const connectorUrl = env('CONNECTOR_URL').replace(/\/+$/, '')

  return {
    connectorSettingsFile: settingsPath(env('SUPERTEXT_SETTINGS_FILE') || null, env('STATE_FILE') || null),
    connectorUrl: /^https?:\/\/[^/]/i.test(connectorUrl) ? connectorUrl : null,
    ghostSecrets: () => {
      const file = fileSecrets()
      return {
        adminKey: env('GHOST_ADMIN_API_KEY') || file.adminKey || '',
        webhookSecret: env('GHOST_WEBHOOK_SECRET') || file.webhookSecret || '',
      }
    },
    host: env('HOST', '0.0.0.0'),
    jobsFile: env('JOBS_FILE') || null,
    languageMap,
    languages: parseTargetLanguages(env('TARGET_LANGUAGES', 'de-CH,fr-CH'), parsePoliteness(env('SUPERTEXT_POLITENESS')), languageMap),
    port: Number(env('PORT', '8080')),
    settingsFile,
    siteUrl,
    sourceLanguage: env('SOURCE_LANGUAGE', 'en'),
    stateFile: env('STATE_FILE') || null,
    supertextApiKey: env('SUPERTEXT_API_KEY'),
    supertextApiUrl: env('SUPERTEXT_API_URL', SUPERTEXT_ENVIRONMENTS.live),
    uiLanguage: env('UI_LANGUAGE', 'auto').toLowerCase(),
    upstream,
    versionReports: reportsEnabled(null, env('SUPERTEXT_VERSION_REPORTS') || null),
  }
}
