import { describe, expect, it } from 'vitest'
import { createI18n, locales } from '../browser/i18n.ts'
import en from '../browser/locales/en.json'

// Pinned so a missing locale file fails the parity test instead of passing vacuously.
const expectedLanguages = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'ru', 'fr'] as const

function messages(value: Readonly<Record<string, unknown>>, prefix = ''): [string, string][] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix == '' ? key : `${prefix}.${key}`
    return typeof child == 'object' && child != null ? messages(child as Readonly<Record<string, unknown>>, path) : [[path, String(child)]]
  })
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]!).toSorted()
}

const english = new Map(messages(en))

describe('Server browser i18n', () => {
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
        for (const [key, message] of entries) expect([key, placeholders(message)]).toEqual([key, placeholders(english.get(key)!)])
      })

      it('never leaves a message empty', () => {
        for (const [key, message] of entries) expect([key, message.length > 0]).toEqual([key, true])
      })
    })
  }

  it('translates the operator session copy', () => {
    const i18n = createI18n('zh-CN')

    expect(i18n.t('session.signIn')).toBe('登录')
    expect(i18n.t('shell.notifications')).toBe('通知')

    i18n.dispose()
  })

  it('resolves the host language tag', () => {
    const i18n = createI18n('zh-HK')

    expect(i18n.lang).toBe('zh-TW')

    i18n.dispose()
  })

  it('falls back to English for unsupported host languages', () => {
    const i18n = createI18n('de')

    expect(i18n.lang).toBe('en')

    i18n.dispose()
  })

  it('switches to the operator language', async () => {
    const i18n = createI18n('en')

    await i18n.switchLang('ja')

    expect(i18n.t('session.signOut')).toBe('ログアウト')

    i18n.dispose()
  })
})
