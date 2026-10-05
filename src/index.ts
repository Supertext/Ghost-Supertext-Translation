#!/usr/bin/env node
import { loadConfig } from './config.js'
import { createApp } from './server.js'

const config = loadConfig()
const app = createApp(config)

app.server.listen(config.port, config.host, () => {
  console.log(
    `[supertext] Listening on ${config.host}:${config.port} for ${config.siteUrl}` +
      (config.upstream ? ` (in front of Ghost at ${config.upstream})` : ''),
  )
  console.log(
    `[supertext] ${config.sourceLanguage} → ${config.languages.map((l) => l.code).join(', ') || '(no target languages)'}; ` +
      `Supertext API ${config.supertextApiUrl}${config.supertextApiKey ? '' : ' (SUPERTEXT_API_KEY is not set: translations will fail)'}`,
  )
})

// Create the request tags in Ghost once the API key and Ghost are available.
void (async () => {
  for (let attempt = 1; ; attempt++) {
    try {
      await app.ensureTags()
      console.log('[supertext] Ghost connection OK, tags in place')
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
