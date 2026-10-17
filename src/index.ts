#!/usr/bin/env node
import { loadConfig } from './config.js'
import { sourceCodeOrNull } from './languages.js'
import { createApp } from './server.js'
import { API_KEY_URL, SIGNUP_URL } from './supertext/client.js'
import { VERSION } from './version.js'

const config = loadConfig()
const app = createApp(config)

app.server.listen(config.port, config.host, () => {
  console.log(
    `[supertext] Connector ${VERSION} listening on ${config.host}:${config.port} for ${config.siteUrl}` +
      (config.upstream ? ` (in front of Ghost at ${config.upstream})` : ''),
  )
  const shown = (code: string, sent: string | null) => (sent === null ? `${code} (not mapped)` : sent === code ? code : `${code}=${sent}`)
  const map = app.languageMap()
  const languages = app.languages()
  console.log(
    `[supertext] ${shown(config.sourceLanguage, sourceCodeOrNull(config.sourceLanguage, map))} → ` +
      `${languages.map((l) => shown(l.code, l.target)).join(', ') || '(no target languages)'}; ` +
      `Supertext API ${config.supertextApiUrl}${config.supertextApiKey ? '' : ` (SUPERTEXT_API_KEY is not set: translations will fail. Create an account at ${SIGNUP_URL}, then generate a key at ${API_KEY_URL})`}`,
  )
  const unmapped = [config.sourceLanguage, ...languages.map((l) => l.code)].filter(
    (code, i) => (i === 0 ? sourceCodeOrNull(code, map) : languages[i - 1]?.target) === null,
  )
  if (unmapped.length) {
    console.log(
      `[supertext] No Supertext language for ${unmapped.join(', ')}: choose one on the status page (${config.upstream ? `${config.siteUrl}/ghost/supertext/` : '/ghost/supertext/'} → Language mapping) or set SUPERTEXT_LANGUAGE_MAP (e.g. de-LI=de-CH). Nothing is sent for it.`,
    )
  }
  if (app.settings.file === null) console.log('[supertext] No STATE_FILE or SUPERTEXT_SETTINGS_FILE: the language mapping chosen on the status page is kept in memory only.')
  for (const l of languages) {
    if (l.politenessUnsupported === 'blocked') console.log(`[supertext] Supertext offers no formal/informal tone for ${l.target}: remove ${l.code} from SUPERTEXT_POLITENESS (its translations fail until then).`)
  }
  console.log(
    `[supertext] Version information to Supertext: ${app.reporting.enabled ? `on (ping ${app.reporting.callbackUrl ?? 'none: set CONNECTOR_URL'})` : 'off (SUPERTEXT_VERSION_REPORTS)'}`,
  )
})

// Create the request tags in Ghost once the API key and Ghost are available.
void (async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      await app.ensureTags()
      console.log('[supertext] Ghost connection OK, tags in place')
      // Commando Center: checks a new or changed API key and reports an install or upgrade (never throws).
      await app.reporting.run('onRequest')
      return
    } catch (err) {
      if (attempt === 1 || attempt % 30 === 0) {
        console.log(`[supertext] Waiting for Ghost: ${err instanceof Error ? err.message : String(err)}`)
      }
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
})()

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.server.close()
    void app.idle().then(() => process.exit(0))
    setTimeout(() => process.exit(0), 10_000).unref()
  })
}
