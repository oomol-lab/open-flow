import { afterEach, expect, it, vi } from 'vitest'
import { initialLanguage, languagePreference } from '../browser/language.ts'

function stubBrowser(stored: string | null, languages: readonly string[]): void {
  vi.stubGlobal('localStorage', { getItem: (key: string) => (key == languagePreference ? stored : null) })
  vi.stubGlobal('navigator', { languages })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('keeps a supported stored preference', () => {
  stubBrowser('zh-TW', ['fr-FR'])

  expect(initialLanguage()).toBe('zh-TW')
})

it('resolves the browser languages when nothing is stored', () => {
  stubBrowser(null, ['fr-CA', 'en-US'])

  expect(initialLanguage()).toBe('fr')
})

it('maps Traditional Chinese regions to zh-TW', () => {
  stubBrowser(null, ['zh-HK', 'en'])

  expect(initialLanguage()).toBe('zh-TW')
})

it('ignores a preference that is no longer supported', () => {
  stubBrowser('de', ['ja-JP'])

  expect(initialLanguage()).toBe('ja')
})

it('falls back to English for unsupported browser languages', () => {
  stubBrowser(null, ['de-DE'])

  expect(initialLanguage()).toBe('en')
})
