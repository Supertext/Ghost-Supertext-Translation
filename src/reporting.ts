/**
 * Version reports to the Supertext Commando Center, the automatic API key check and the
 * callback ping (Commando-Center-Supertext-Translation → docs/DEVELOPER.md → Report protocol).
 * The protocol is Supertext Plugin Health's (`InstallationReporter`, `pingResponse`; copied
 * into src/vendor/supertext-plugin-health), the key check the Supertext SDK's (`checkApiKey()`,
 * `apiKeyFingerprint`). This file only gives them what the connector knows: the Ghost site URL, the connector and Ghost versions, the ping
 * address, and a place to keep the reporter's state (`STATE_FILE`, else memory).
 *
 * All settings live in the environment, so there is no "settings saved": the key check runs
 * when the key in SUPERTEXT_API_KEY is new or changed (fingerprint), and after a 401/403 from
 * Supertext. Nothing here ever throws into a request or a translation.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { Config } from './config.js'
import {
  EMPTY_REPORTER_STATE,
  InstallationReporter,
  type KeyCheck,
  pingResponse,
  type PingResponse,
  type ReporterOptions,
  type ReporterResult,
  reporterState,
  type ReporterState,
} from './vendor/supertext-plugin-health/index.js'
import { SDK_VERSION } from './vendor/supertext-sdk/index.js'
import { apiKeyFingerprint, type FetchLike, SupertextClient } from './vendor/supertext-sdk/v1/index.js'
import { USER_AGENT, VERSION } from './version.js'

/** The GitHub repository name: the center reads the latest release from it. */
export const PLUGIN_NAME = 'Ghost-Supertext-Translation'
/** The public ping route, on the connector itself. */
export const PING_PATH = '/supertext/ping'

/**
 * The ping endpoint's absolute URL, or null when it has no known public address:
 * `CONNECTOR_URL` (setup B), else in setup A the site's own host (the connector answers
 * `/supertext/…` at the root of the host it serves). The center only pings addresses on the
 * site's host or a subdomain of it.
 */
export function callbackUrl(config: Pick<Config, 'connectorUrl' | 'upstream' | 'siteUrl'>): string | null {
  if (config.connectorUrl) return `${config.connectorUrl}${PING_PATH}`
  if (config.upstream) {
    try {
      return `${new URL(config.siteUrl).origin}${PING_PATH}`
    } catch {
      return null
    }
  }
  return null
}

/** The reporter's state as a small JSON file (`STATE_FILE`); in memory without one. Never throws. */
export class StateStore {
  private memory: ReporterState = EMPTY_REPORTER_STATE

  constructor(
    private readonly file: string | null,
    private readonly log: (message: string) => void = () => {},
  ) {}

  load(): ReporterState {
    if (!this.file) return this.memory
    try {
      return reporterState(readFileSync(this.file, 'utf8'))
    } catch {
      return this.memory // first start, or unreadable: what this process knows
    }
  }

  save(state: ReporterState): void {
    this.memory = state
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(state))
      renameSync(tmp, this.file)
    } catch (err) {
      this.log(`Could not write STATE_FILE (${err instanceof Error ? err.message : String(err)}); keeping the state in memory`)
    }
  }
}

export type Action = 'onRequest' | 'authenticationFailed'

export type ReportingDeps = {
  /** Ghost's version (`GET site/`), or null when Ghost can't be reached. */
  ghostVersion: () => Promise<string | null>
  log?: (message: string) => void
  /** HTTP for the key check against Supertext (tests, proxies); the global fetch by default. */
  fetch?: typeof fetch
  /** Tests: options for Plugin Health's reporter (fetch, report URL, clock). */
  reporterOverrides?: Partial<ReporterOptions>
}

/**
 * The connector's side of the Commando Center. Calls are serialized, so two requests
 * don't report twice.
 */
export class Reporting {
  readonly store: StateStore
  readonly callbackUrl: string | null
  private queue: Promise<unknown> = Promise.resolve()
  private knownGhostVersion: string | null = null

  constructor(
    private readonly config: Config,
    private readonly deps: ReportingDeps,
  ) {
    this.store = new StateStore(config.stateFile, deps.log)
    this.callbackUrl = callbackUrl(config)
  }

  /** "Send version information to Supertext" (`SUPERTEXT_VERSION_REPORTS`, default on). */
  get enabled(): boolean {
    return this.config.versionReports
  }

  /** The answer of `GET /supertext/ping?challenge=…` (404 while reports are off). */
  ping(challenge: string | null): PingResponse {
    return pingResponse(challenge, { enabled: this.enabled, plugin: PLUGIN_NAME })
  }

  reporter(ghostVersion: string | null): InstallationReporter {
    const clientOptions = {
      baseUrl: this.config.supertextApiUrl,
      userAgent: USER_AGENT,
      ...(this.deps.fetch ? { fetch: this.deps.fetch as FetchLike } : {}),
      ...(this.deps.reporterOverrides?.now ? { now: this.deps.reporterOverrides.now } : {}),
    }
    return new InstallationReporter({
      callbackUrl: this.callbackUrl,
      enabled: this.enabled,
      keyChecker: { check: (apiKey) => new SupertextClient(apiKey, clientOptions).checkApiKey(), fingerprint: apiKeyFingerprint },
      plugin: { name: PLUGIN_NAME, version: VERSION },
      siteUrl: this.config.siteUrl,
      sdkVersion: SDK_VERSION,
      system: { name: 'Ghost', version: ghostVersion },
      ...this.deps.reporterOverrides,
    })
  }

  /** Runs one reporter action with the stored state and stores the result. Never throws. */
  run(action: Action, httpStatus?: number): Promise<ReporterResult | null> {
    const task = this.queue.then(async () => {
      try {
        const version = await this.deps.ghostVersion().catch(() => null)
        // Keep the last known version while Ghost is briefly unreachable, so that isn't an "upgrade".
        if (version) this.knownGhostVersion = version
        const reporter = this.reporter(this.knownGhostVersion)
        const state = this.store.load()
        const key = this.config.supertextApiKey
        const result =
          action === 'authenticationFailed' ? await reporter.authenticationFailed(state, key, httpStatus ?? 401) : await reporter.onRequest(state, key)
        this.store.save(result.state)
        if (result.event) this.deps.log?.(`Version report ${result.event}: ${result.sent ? 'sent' : 'not sent'}`)
        return result
      } catch (err) {
        this.deps.log?.(`Version report skipped: ${err instanceof Error ? err.message : String(err)}`)
        return null
      }
    })
    this.queue = task
    return task
  }

  /** For requests: runs in the background, so nobody waits for Supertext or the center. */
  inBackground(action: Action, httpStatus?: number): Promise<ReporterResult | null> {
    const task = this.run(action, httpStatus)
    void task
    return task
  }

  /** The latest stored key check (status page). */
  lastCheck(): KeyCheck | null {
    try {
      return this.store.load().keyCheck
    } catch {
      return null
    }
  }
}
