import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderStatusPage, type StatusPageData } from '../src/status-page.js'
import { releaseUrl, VERSION } from '../src/version.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

const data = (version: string): StatusPageData => ({
  ghost: { detail: '(Ghost 6.0.0)', ok: true },
  jobs: [],
  languages: [],
  siteTitle: 'Demo',
  siteUrl: 'https://www.example.com',
  locale: 'en',
  sourceLanguage: 'en',
  supertext: { endpoint: 'https://api.supertext.com/v1/', keyConfigured: true },
  version,
  viewer: 'Editor (editor@example.com)',
  webhookSecret: true,
})

describe('connector version', () => {
  it('is read from package.json', () => {
    expect(VERSION).toBe(pkg.version)
  })

  it('links a release version to its GitHub release on the status page', () => {
    const html = renderStatusPage(data(VERSION))
    expect(html).toContain('<dt>Connector version</dt>')
    expect(html).toContain(
      `<a href="https://github.com/Supertext/Ghost-Supertext-Translation/releases/tag/v${VERSION}" target="_blank" rel="noopener">${VERSION}</a>`,
    )
  })

  it('shows other versions as plain text', () => {
    expect(releaseUrl('1.2.0-beta.1')).toBeUndefined()
    const html = renderStatusPage(data('1.2.0-beta.1'))
    expect(html).toContain('<dt>Connector version</dt><dd>1.2.0-beta.1</dd>')
    expect(html).not.toContain('releases/tag')
  })
})
