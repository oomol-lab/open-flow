import { glob, readFile } from 'node:fs/promises'
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
  return [...message.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].flatMap((match) => match[1] ?? []).toSorted()
}

interface JsonFrame {
  readonly keys: Set<string>
  readonly kind: 'array' | 'object'
  pendingKey: string | undefined
  readonly prefix: string
}

/**
 * Object keys that appear more than once in raw JSON text, reported as `path.to.key`. `JSON.parse`
 * keeps the last duplicate and drops the rest without complaining, so the text is scanned instead.
 */
function duplicateJsonKeys(source: string): readonly string[] {
  const duplicates: string[] = []
  const stack: JsonFrame[] = []
  let index = 0
  while (index < source.length) {
    const character = source[index]!
    const frame = stack.at(-1)
    if (character == '"') {
      const start = index
      index += 1
      while (index < source.length && source[index] != '"') index += source[index] == '\\' ? 2 : 1
      index += 1
      const text = JSON.parse(source.slice(start, index)) as string
      if (frame != null && frame.kind == 'object' && frame.pendingKey == null) {
        if (frame.keys.has(text)) duplicates.push(`${frame.prefix}${text}`)
        frame.keys.add(text)
        frame.pendingKey = text
      }
      continue
    }
    if (character == '{' || character == '[') {
      const prefix = frame == null ? '' : frame.kind == 'object' ? `${frame.prefix}${frame.pendingKey}.` : frame.prefix
      stack.push({ keys: new Set(), kind: character == '{' ? 'object' : 'array', pendingKey: undefined, prefix })
    } else if (character == '}' || character == ']') {
      stack.pop()
    } else if (character == ',' && frame != null) {
      frame.pendingKey = undefined
    }
    index += 1
  }
  return duplicates
}

const english = new Map(messages(en))
const keyPattern = /(?:\b(?:t|translate)|\.t)\(\s*(['"`])([^'"`$]+)\1/g

const localeDirectory = new URL('../browser/locales/', import.meta.url)
const sourceDirectory = new URL('../browser/', import.meta.url)
const localeFiles: string[] = []
for await (const name of glob('*.json', { cwd: localeDirectory })) localeFiles.push(name)
localeFiles.sort()

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

  it('defines every statically referenced browser message', async () => {
    const missing = new Set<string>()
    for await (const name of glob('**/*.{ts,tsx}', { cwd: sourceDirectory })) {
      const source = await readFile(new URL(name, sourceDirectory), 'utf8')
      for (const match of source.matchAll(keyPattern)) if (!english.has(match[2]!)) missing.add(match[2]!)
    }
    expect([...missing].toSorted()).toEqual([])
  })

  it('reports duplicate keys with their path', () => {
    expect(duplicateJsonKeys('{"a": {"b": 1, "b": 2}, "a": 3}')).toEqual(['a.b', 'a'])
    expect(duplicateJsonKeys('{"a\\"b": 1, "a\\"b": 2}')).toEqual(['a"b'])
    expect(duplicateJsonKeys('{"a": "{\\"b\\": 1, \\"b\\": 2}"}')).toEqual([])
  })

  for (const name of localeFiles) {
    it(`never repeats a key in ${name}`, async () => {
      expect(duplicateJsonKeys(await readFile(new URL(name, localeDirectory), 'utf8'))).toEqual([])
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
