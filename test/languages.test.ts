import { LanguageCodes } from 'supertext-sdk'
import { describe, expect, it } from 'vitest'

import { parseTargetLanguages } from '../src/languages.js'

// The rules live in the Supertext SDK (LanguageCodes, tested there against the shared
// vectors); these cases pin what the connector relies on.
const sourceCode = (code: string) => LanguageCodes.source(code)
const targetCode = (code: string) => LanguageCodes.target(code)

describe('language codes', () => {
  it('sends a bare source language', () => {
    expect(sourceCode('en')).toBe('en')
  })
  it('strips the region from a regional source', () => {
    expect(sourceCode('en-GB')).toBe('en')
    expect(sourceCode('en_US')).toBe('en')
    expect(sourceCode(' DE-ch ')).toBe('de')
  })
  it('gives a bare target its default region', () => {
    expect(targetCode('de')).toBe('de-DE')
    expect(targetCode('en')).toBe('en-US')
    expect(targetCode('sl')).toBe('sl-SI')
    expect(targetCode('ZH')).toBe('zh-CN')
  })
  it('keeps a regional target and normalizes case and underscores', () => {
    expect(targetCode('de-CH')).toBe('de-CH')
    expect(targetCode('de_ch')).toBe('de-CH')
    expect(targetCode('fr-ch')).toBe('fr-CH')
    expect(targetCode('zh-hant')).toBe('zh-Hant')
    expect(targetCode('es-419')).toBe('es-419')
  })
  it('sends unknown bare codes unchanged', () => {
    expect(targetCode('xx')).toBe('xx')
  })
  it('keeps the configured code for tags and sends the regional code', () => {
    const [de, fr] = parseTargetLanguages('de, fr_ch')
    expect([de?.code, de?.target, de?.translateTag]).toEqual(['de', 'de-DE', '#translate-de'])
    expect([fr?.code, fr?.target, fr?.langTag]).toEqual(['fr_ch', 'fr-CH', '#lang-fr-ch'])
  })
})
