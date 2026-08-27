import { describe, expect, it } from 'vitest'
import { defaultUiLanguage, isCjkLanguage, isUiLanguage, resolveUiLanguage, uiLanguageNames, uiLanguages, userLocaleFallbackChain } from './languages.ts'

describe('UI languages', () => {
  it('names every supported language with its endonym', () => {
    expect(uiLanguages).toEqual(['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'ru', 'fr'])
    expect(Object.keys(uiLanguageNames)).toEqual([...uiLanguages])
    expect(uiLanguages.includes(defaultUiLanguage)).toBe(true)
  })

  it('accepts only exact supported tags', () => {
    for (const language of uiLanguages) expect(isUiLanguage(language)).toBe(true)
    expect(isUiLanguage('zh-cn')).toBe(false)
    expect(isUiLanguage('de')).toBe(false)
    expect(isUiLanguage('')).toBe(false)
    expect(isUiLanguage(undefined)).toBe(false)
    expect(isUiLanguage(null)).toBe(false)
    expect(isUiLanguage(1)).toBe(false)
  })
})

describe('resolveUiLanguage', () => {
  it('keeps exact tags', () => {
    expect(resolveUiLanguage(['zh-TW'])).toBe('zh-TW')
    expect(resolveUiLanguage(['zh-CN'])).toBe('zh-CN')
  })

  it('maps Chinese variants by script and region', () => {
    expect(resolveUiLanguage(['zh-Hant-HK'])).toBe('zh-TW')
    expect(resolveUiLanguage(['zh-HK'])).toBe('zh-TW')
    expect(resolveUiLanguage(['zh-MO'])).toBe('zh-TW')
    expect(resolveUiLanguage(['zh'])).toBe('zh-CN')
    expect(resolveUiLanguage(['zh-Hans-SG'])).toBe('zh-CN')
  })

  it('prefers an explicit script subtag over the region', () => {
    expect(resolveUiLanguage(['zh-Hans-TW'])).toBe('zh-CN')
    expect(resolveUiLanguage(['zh-Hans-HK'])).toBe('zh-CN')
    expect(resolveUiLanguage(['zh-Hans-MO'])).toBe('zh-CN')
    expect(resolveUiLanguage(['zh-Hant-CN'])).toBe('zh-TW')
    expect(resolveUiLanguage(['zh-Hant-SG'])).toBe('zh-TW')
  })

  it('matches other languages on their primary subtag and prefers the first candidate', () => {
    expect(resolveUiLanguage(['fr-CA', 'en-US'])).toBe('fr')
    expect(resolveUiLanguage(['de', 'ru-RU'])).toBe('ru')
    expect(resolveUiLanguage(['ko-KR'])).toBe('ko')
  })

  it('ignores case and empty candidates', () => {
    expect(resolveUiLanguage(['JA-jp'])).toBe('ja')
    expect(resolveUiLanguage(['ZH-hant'])).toBe('zh-TW')
    expect(resolveUiLanguage([undefined, null, '', '  ', 'ja'])).toBe('ja')
  })

  it('falls back when no candidate is supported', () => {
    expect(resolveUiLanguage(['de'])).toBe('en')
    expect(resolveUiLanguage([])).toBe('en')
    expect(resolveUiLanguage(['de'], 'zh-CN')).toBe('zh-CN')
  })
})

describe('isCjkLanguage', () => {
  it('covers Chinese, Japanese and Korean', () => {
    expect(isCjkLanguage('zh-CN')).toBe(true)
    expect(isCjkLanguage('zh-TW')).toBe(true)
    expect(isCjkLanguage('ja')).toBe(true)
    expect(isCjkLanguage('ko')).toBe(true)
    expect(isCjkLanguage('ja-JP')).toBe(true)
  })

  it('excludes the other languages', () => {
    expect(isCjkLanguage('en')).toBe(false)
    expect(isCjkLanguage('ru')).toBe(false)
    expect(isCjkLanguage('fr')).toBe(false)
    expect(isCjkLanguage('de')).toBe(false)
    expect(isCjkLanguage('')).toBe(false)
  })
})

describe('userLocaleFallbackChain', () => {
  it('prefers Simplified Chinese for Traditional Chinese readers', () => {
    expect(userLocaleFallbackChain('zh-TW')).toEqual(['zh-TW', 'zh-CN', 'en'])
  })

  it('keeps the authored locales in their own order', () => {
    expect(userLocaleFallbackChain('en')).toEqual(['en', 'zh-CN'])
    expect(userLocaleFallbackChain('zh-CN')).toEqual(['zh-CN', 'en'])
  })

  it('falls back to English first for every other language', () => {
    expect(userLocaleFallbackChain('ja')).toEqual(['ja', 'en', 'zh-CN'])
    expect(userLocaleFallbackChain('fr')).toEqual(['fr', 'en', 'zh-CN'])
  })

  it('never repeats a locale', () => {
    for (const language of [...uiLanguages, 'de']) {
      const chain = userLocaleFallbackChain(language)
      expect(new Set(chain).size).toBe(chain.length)
    }
  })
})
