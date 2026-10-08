import { describe, expect, it } from 'vitest'
import { CATALOGS, format, pickLocale, t, UI_LOCALES } from '../src/i18n/index.js'
import { managedTags, parseTargetLanguages } from '../src/languages.js'
import { renderStatusPage, type StatusPageData } from '../src/status-page.js'
import { statusError, SupertextError } from '../src/supertext/client.js'

const placeholders = (s: string) => [...s.matchAll(/\{\w+\}|<[^>]+>|https?:\/\/\S+/g)].map((m) => m[0]).sort()

describe('catalogs', () => {
  const en = CATALOGS.en
  for (const locale of UI_LOCALES) {
    it(`${locale} has every English key with the same placeholders, tags and links`, () => {
      const catalog = CATALOGS[locale]
      expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort())
      for (const [key, text] of Object.entries(catalog)) {
        expect(text.trim(), key).not.toBe('')
        expect(placeholders(text), key).toEqual(placeholders(en[key as keyof typeof en]))
        if (en[key as keyof typeof en].includes('Supertext')) expect(text, key).toContain('Supertext')
        if (en[key as keyof typeof en].includes('Integrations → API')) expect(text, key).toContain('Integrations → API')
      }
    })
  }

  it('uses non-breaking spaces before French double punctuation', () => {
    for (const [key, text] of Object.entries(CATALOGS.fr)) expect(text, key).not.toMatch(/ [?!:;]/)
  })
})

describe('pickLocale', () => {
  it('uses UI_LANGUAGE when it names a UI language', () => {
    expect(pickLocale('it', 'fr-CH,fr;q=0.9')).toBe('it')
  })
  it('otherwise follows Accept-Language, by quality', () => {
    expect(pickLocale('auto', 'fr-CH,fr;q=0.9,en;q=0.8')).toBe('fr')
    expect(pickLocale('auto', 'es;q=1, de-CH;q=0.7, it;q=0.8')).toBe('it')
    expect(pickLocale('', 'de-DE')).toBe('de')
  })
  it('falls back to English', () => {
    expect(pickLocale('auto', 'es,ja')).toBe('en')
    expect(pickLocale('auto', undefined)).toBe('en')
  })
})

describe('localized messages', () => {
  it('shows language names in the reader’s language', () => {
    const m = { key: 'job.created', params: { language: 'de-CH', title: 'Hallo' } } as const
    expect(t('en', m.key, m.params)).toBe('Created the German (Switzerland) draft "Hallo".')
    expect(format('fr', [m])).toBe('Brouillon en allemand (Suisse) « Hallo » créé.')
    expect(format('it', [m])).toBe('Creata la bozza in tedesco (Svizzera) «Hallo».')
  })

  it('translates Supertext errors, keeping the API detail as sent', () => {
    const err = statusError(500, 'upstream down')
    expect(err).toBeInstanceOf(SupertextError)
    expect(err.message).toBe('Supertext service unavailable. — upstream down')
    expect(format('de', err.localized)).toBe('Der Supertext-Dienst ist nicht verfügbar. — upstream down')
  })

  it('writes tag descriptions in the chosen language but never renames tags', () => {
    const languages = parseTargetLanguages('de-CH')
    const en = managedTags(languages)
    const it = managedTags(languages, 'https://x.test/ghost/supertext/', 'it')
    expect(it.map((t) => t.name)).toEqual(en.map((t) => t.name))
    expect(it[2]?.description).toBe(
      'Supertext: lo aggiunga a un articolo e salvi per ottenere una bozza in tedesco (Svizzera). Risultati: https://x.test/ghost/supertext/',
    )
  })

  it('renders the status page in the chosen language', () => {
    const data: StatusPageData = {
      ghost: { detail: '(Ghost 6.0.0)', ok: true },
      jobs: [
        {
          at: '2026-10-08T10:00:00.000Z',
          force: false,
          id: 1,
          language: 'fr-CH',
          languageLabel: 'French (Switzerland)',
          localized: [{ key: 'job.created', params: { language: 'fr-CH', title: 'Bonjour' } }],
          message: 'Created the French (Switzerland) draft "Bonjour".',
          postId: 'abc',
          postTitle: 'Hello',
          resource: 'posts',
          status: 'created',
          translationId: 'def',
        },
      ],
      languages: parseTargetLanguages('fr-CH'),
      locale: 'de',
      siteTitle: 'Demo',
      siteUrl: 'https://www.example.com',
      sourceLanguage: 'en',
      supertext: { endpoint: 'https://api.supertext.com/v1/', keyConfigured: false },
      version: '0.1.0',
      viewer: 'Editor (editor@example.com)',
      webhookSecret: true,
    }
    const html = renderStatusPage(data)
    expect(html).toContain('<html lang="de">')
    expect(html).toContain('<h2>Letzte Übersetzungen</h2>')
    expect(html).toContain('Entwurf in Französisch (Schweiz) „Bonjour“ erstellt.')
    expect(html).toContain('<span class="badge created">Erstellt</span>')
    expect(html).toContain('<code class="tag">#translate-all</code> übersetzt in alle')
    expect(html).toContain('href="https://www.supertext.com/person/en/account/signin" target="_blank" rel="noopener"')
    expect(html).toContain('Ausgangssprache: <strong>Englisch</strong>')
  })

  it('still shows the English message of jobs saved by older versions', () => {
    const html = renderStatusPage({
      ghost: { detail: '', ok: true },
      jobs: [
        {
          at: '2026-10-08T10:00:00.000Z',
          force: false,
          id: 1,
          language: 'de-CH',
          languageLabel: 'German (Switzerland)',
          message: 'Old message',
          postId: 'abc',
          postTitle: 'Hello',
          resource: 'posts',
          status: 'failed',
        },
      ],
      languages: [],
      locale: 'fr',
      siteTitle: 'Demo',
      siteUrl: 'https://www.example.com',
      sourceLanguage: 'en',
      supertext: { endpoint: '', keyConfigured: true },
      version: '0.1.0',
      viewer: 'x',
      webhookSecret: true,
    })
    expect(html).toContain('<td>Old message</td>')
    expect(html).toContain('allemand (Suisse)')
  })
})
