import { describe, expect, it } from 'vitest'
import { parseLanguageMap, parsePoliteness, parseTargetLanguages, sourceCode, sourceCodeOrNull, targetCode, targetCodeOrNull } from '../src/languages.js'

describe('language codes (no guessing)', () => {
  it('sends a bare source language', () => {
    expect(sourceCode('en')).toBe('en')
  })
  it('sends a regional source as its language', () => {
    expect(sourceCode('en-GB')).toBe('en')
    expect(sourceCode('en_US')).toBe('en')
    expect(sourceCode(' DE-ch ')).toBe('de')
  })
  it('uses a code that is a Supertext target as it is, apart from case and _/-', () => {
    expect(targetCode('de-CH')).toBe('de-CH')
    expect(targetCode('de_ch')).toBe('de-CH')
    expect(targetCode('fr-ch')).toBe('fr-CH')
    expect(targetCode('zh-hant')).toBe('zh-Hant')
    expect(targetCode('es')).toBe('es')
    expect(targetCode('SL')).toBe('sl')
  })
  it('gives no default region: anything else is unsupported_language', () => {
    for (const code of ['de', 'en', 'zh-CN', 'es-ES', 'sl-SI', 'xx']) {
      expect(() => targetCode(code)).toThrow(expect.objectContaining({ code: 'unsupported_language' }))
      expect(targetCodeOrNull(code)).toBeNull()
    }
    expect(sourceCodeOrNull('xx')).toBeNull()
  })
  it('uses the mapping first, for targets and the source', () => {
    const map = { de: 'de-CH', 'zh-CN': 'zh-Hans', en: 'en-US' }
    expect(targetCode('de', map)).toBe('de-CH')
    expect(targetCode('zh_cn', map)).toBe('zh-Hans')
    expect(sourceCode('en', map)).toBe('en')
    expect(sourceCode('de', map)).toBe('de')
  })
  it('keeps the configured code for tags and sends the mapped or exact code', () => {
    const [de, fr, nl] = parseTargetLanguages('de, fr_ch, nl', {}, { de: 'de-AT' })
    expect([de?.code, de?.target, de?.translateTag]).toEqual(['de', 'de-AT', '#translate-de'])
    expect([fr?.code, fr?.target, fr?.langTag]).toEqual(['fr_ch', 'fr-CH', '#lang-fr-ch'])
    expect(nl?.target).toBe('nl')
  })
  it('marks an unmapped language instead of guessing', () => {
    const [de] = parseTargetLanguages('de')
    expect(de).toMatchObject({ code: 'de', target: null, translateTag: '#translate-de' })
  })
})

describe('SUPERTEXT_LANGUAGE_MAP', () => {
  it('reads code=code pairs and JSON', () => {
    expect(parseLanguageMap('de=de-CH, zh=zh-Hans;no=nb')).toEqual({ de: 'de-CH', no: 'nb', zh: 'zh-Hans' })
    expect(parseLanguageMap('{"de":"de-CH","x":1}')).toEqual({ de: 'de-CH' })
    expect(parseLanguageMap('')).toEqual({})
    expect(parseLanguageMap('{broken')).toEqual({})
    expect(parseLanguageMap('de=')).toEqual({})
  })
})

describe('formal/informal', () => {
  it('blocks a tone set for a target that has none, and ignores a tone set for all languages', () => {
    const own = parseTargetLanguages('en-US,de-CH', parsePoliteness('en-US=more,de-CH=more'))
    expect(own.map((l) => [l.code, l.politeness, l.politenessUnsupported])).toEqual([
      ['en-US', 'more', 'blocked'],
      ['de-CH', 'more', null],
    ])
    const all = parseTargetLanguages('en-US,de-CH', parsePoliteness('more'))
    expect(all.map((l) => l.politenessUnsupported)).toEqual(['ignored', null])
  })
})
