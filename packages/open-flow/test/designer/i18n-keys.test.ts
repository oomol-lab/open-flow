import { glob, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/** The shipped UI languages, pinned here so an unbuilt locale file fails loudly instead of silently. */
const uiLanguageTags = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'ru', 'fr'] as const

type LocaleMap = ReadonlyMap<string, string>

interface LocaleBundle {
  /** Locale files keyed by language tag, always covering every entry of `uiLanguageTags`. */
  readonly locales: ReadonlyMap<string, LocaleMap>
  readonly name: string
  /** Source files whose `t()` calls must resolve inside this bundle. */
  readonly sources: string
}

// val-i18n only interpolates double-brace placeholders, `{{@}}` included.
const placeholderPattern = /\{\{([^{}]*)\}\}/g
const keyPattern = /(?:\b(?:t|t\$|translate)|\.t)\(\s*(['"`])([^'"`$]+)\1/g

function flattenLocale(locale: object, prefix: string = '', entries: Map<string, string> = new Map()): Map<string, string> {
  for (const [name, value] of Object.entries(locale)) {
    const key = prefix ? `${prefix}.${name}` : name
    if (typeof value == 'string') {
      entries.set(key, value)
    } else if (value && typeof value == 'object' && !Array.isArray(value)) {
      flattenLocale(value, key, entries)
    }
  }
  return entries
}

function placeholdersOf(message: string): readonly string[] {
  return [...new Set([...message.matchAll(placeholderPattern)].map((match) => match[1]!))].toSorted()
}

async function loadBundle(name: string, dirs: readonly string[], sources: string): Promise<LocaleBundle> {
  const locales = new Map<string, LocaleMap>()
  for (const lang of uiLanguageTags) {
    const parts = await Promise.all(dirs.map(async (dir) => JSON.parse(await readFile(`${dir}/${lang}.json`, 'utf8'))))
    locales.set(lang, flattenLocale(Object.assign({}, ...parts)))
  }
  return { locales, name, sources }
}

const shared = 'src/ui/browser/locales'
const form = 'src/form/browser/locales'
const bundles: readonly LocaleBundle[] = [
  await loadBundle('canvas', ['src/canvas/browser/i18n/locales', shared], 'src/canvas/browser/**/*.{ts,tsx}'),
  await loadBundle('IconPicker', ['src/ui/browser/icons/picker/locales'], 'src/ui/browser/icons/picker/**/*.{ts,tsx}'),
  await loadBundle('workbench', ['src/workbench/browser/runtime/locales', shared, form], 'src/workbench/browser/**/*.{ts,tsx}'),
  await loadBundle('shared UI', [shared], 'src/ui/browser/**/*.{ts,tsx}'),
  await loadBundle('form', [shared, form], 'src/form/browser/**/*.{ts,tsx}'),
]

const iconPickerPath = '/icons/picker/'

describe.each(bundles)('$name translations', ({ locales, name, sources }) => {
  const en = locales.get('en')!
  const translated = uiLanguageTags.filter((lang) => lang != 'en')

  it('ships one locale file per UI language', () => {
    expect([...locales.keys()]).toEqual([...uiLanguageTags])
  })

  it.each(translated)('keeps %s aligned with English', (lang) => {
    const locale = locales.get(lang)!

    expect([...en.keys()].filter((key) => !locale.has(key))).toEqual([])
    expect([...locale.keys()].filter((key) => !en.has(key))).toEqual([])
  })

  it.each(translated)('keeps %s placeholders identical to English', (lang) => {
    const locale = locales.get(lang)!
    const mismatched = [...en].filter(([key, message]) => {
      const translation = locale.get(key)
      return translation != null && placeholdersOf(translation).join() != placeholdersOf(message).join()
    })

    expect(mismatched.map(([key]) => key)).toEqual([])
  })

  it.each([...uiLanguageTags])('leaves no blank message in %s', (lang) => {
    const blank = [...locales.get(lang)!].filter(([, message]) => message.trim() == '')

    expect(blank.map(([key]) => key)).toEqual([])
  })

  it('defines every statically referenced product translation', async () => {
    const missing = new Set<string>()

    for await (const file of glob(sources)) {
      // The IconPicker carries its own bundle, so the canvas scan leaves those keys to it.
      // glob 返回平台原生路径分隔符，先统一后再判断语言包边界。
      if (name != 'IconPicker' && file.replaceAll('\\', '/').includes(iconPickerPath)) continue
      const source = await readFile(file, 'utf8')
      for (const match of source.matchAll(keyPattern)) {
        const key = match[2]!
        if (uiLanguageTags.some((lang) => !locales.get(lang)!.has(key))) missing.add(key)
      }
    }

    expect([...missing].toSorted()).toEqual([])
  })
})
