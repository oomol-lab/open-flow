export const uiLanguages = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'ru', 'fr'] as const

export type UiLanguage = (typeof uiLanguages)[number]

export const defaultUiLanguage: UiLanguage = 'en'

/** Endonyms, shown in language pickers regardless of the current UI language. */
export const uiLanguageNames: Readonly<Record<UiLanguage, string>> = {
  'en': 'English',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'ja': '日本語',
  'ko': '한국어',
  'ru': 'Русский',
  'fr': 'Français',
}

const uiLanguageTags: ReadonlyMap<string, UiLanguage> = new Map(uiLanguages.map((language) => [language.toLowerCase(), language]))
const traditionalChineseRegions: ReadonlySet<string> = new Set(['hk', 'mo', 'tw'])
const cjkLanguages: ReadonlySet<UiLanguage> = new Set<UiLanguage>(['zh-CN', 'zh-TW', 'ja', 'ko'])

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value == 'string' && uiLanguageTags.get(value.toLowerCase()) == value
}

/**
 * BCP 47 aware resolution over candidates such as `navigator.languages`: an exact tag match
 * (case-insensitive) wins; for zh an explicit script subtag beats the region (zh-Hant-* to zh-TW,
 * zh-Hans-* to zh-CN), then zh-TW, zh-HK and zh-MO map to zh-TW and any other zh* to zh-CN; en, ja,
 * ko, ru and fr also match on their primary subtag (fr-CA to fr, ja-JP to ja).
 */
export function resolveUiLanguage(candidates: Iterable<string | null | undefined>, fallback: UiLanguage = defaultUiLanguage): UiLanguage {
  for (const candidate of candidates) {
    const language = candidate == null ? undefined : matchUiLanguage(candidate)
    if (language != null) return language
  }
  return fallback
}

/** Languages written with CJK scripts: zh-CN, zh-TW, ja and ko. */
export function isCjkLanguage(language: string): boolean {
  const matched = matchUiLanguage(language)
  return matched != null && cjkLanguages.has(matched)
}

/**
 * Lookup order for package-author locale files (`oo-locales/<lang>.json`), which only exist for en
 * and zh-CN today. Traditional Chinese readers prefer Simplified Chinese over English; every other
 * language falls back to English first. The chain never repeats a locale.
 */
export function userLocaleFallbackChain(language: string): readonly string[] {
  if (language == 'zh-TW') return ['zh-TW', 'zh-CN', 'en']
  if (language == 'zh-CN') return ['zh-CN', 'en']
  if (language == 'en') return ['en', 'zh-CN']
  return [language, 'en', 'zh-CN']
}

function matchUiLanguage(candidate: string): UiLanguage | undefined {
  const tag = candidate.trim().toLowerCase()
  if (tag.length == 0) return undefined
  const exact = uiLanguageTags.get(tag)
  if (exact != null) return exact
  const subtags = tag.split('-')
  if (subtags[0] == 'zh') {
    if (subtags.includes('hant')) return 'zh-TW'
    if (subtags.includes('hans')) return 'zh-CN'
    return subtags.some((subtag) => traditionalChineseRegions.has(subtag)) ? 'zh-TW' : 'zh-CN'
  }
  return uiLanguageTags.get(subtags[0]!)
}
