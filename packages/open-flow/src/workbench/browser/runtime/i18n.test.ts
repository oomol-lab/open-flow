import { describe, expect, it } from 'vitest'
import { createI18n, locales } from './i18n.ts'
import en from './locales/en.json'

// Pinned so a missing locale file fails the parity test instead of passing vacuously.
const expectedLanguages = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'ru', 'fr'] as const

function messages(value: Readonly<Record<string, unknown>>, prefix = ''): [string, string][] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix == '' ? key : `${prefix}.${key}`
    return typeof child == 'object' && child != null ? messages(child as Readonly<Record<string, unknown>>, path) : [[path, String(child)]]
  })
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].flatMap((match) => match[1] ?? []).toSorted()
}

const english = new Map(messages(en))

describe('Workbench i18n', () => {
  it('ships every supported language', () => {
    expect(Object.keys(locales)).toEqual([...expectedLanguages])
  })

  for (const language of expectedLanguages) {
    describe(language, () => {
      const entries = messages(locales[language])

      it('keeps locale resources in sync', () => {
        expect(entries.map(([key]) => key).toSorted()).toEqual([...english.keys()].toSorted())
      })

      it('keeps the placeholders of every message', () => {
        const mismatched = entries.flatMap(([key, message]) => {
          const source = english.get(key)
          if (source == null) return [`${key}: not an English message`]
          const [actual, expected] = [placeholders(message).join('|'), placeholders(source).join('|')]
          return actual == expected ? [] : [`${key}: ${actual} instead of ${expected}`]
        })
        expect(mismatched).toEqual([])
      })

      it('never leaves a message empty', () => {
        for (const [key, message] of entries) expect([key, message.length > 0]).toEqual([key, true])
      })
    })
  }

  it('translates messages and interpolates values', () => {
    const i18n = createI18n('zh-CN')

    expect(i18n.t('resource.flows')).toBe('工作流')
    expect(i18n.t('notice.created', { name: '演示' })).toBe('已创建 演示。')

    i18n.dispose()
  })

  it('resolves the host language tag', () => {
    const i18n = createI18n('zh-Hant-HK')

    expect(i18n.lang).toBe('zh-TW')

    i18n.dispose()
  })

  it('falls back to English for unsupported host languages', () => {
    const i18n = createI18n('de-DE')

    expect(i18n.lang).toBe('en')

    i18n.dispose()
  })

  it('switches to the host language', async () => {
    const i18n = createI18n('zh-CN')

    await i18n.switchLang('en')

    expect(i18n.lang).toBe('en')

    i18n.dispose()
  })
})
