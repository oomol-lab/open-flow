import type { ComputeGet, ReadonlyVal, Val } from 'value-enhancer'
import type { LocaleTextMap, LocaleTextStore } from '../../../../localization/common/localization.ts'

import { localeChain } from '../../../../localization/common/localization.ts'
import { getOwnValue, isEnglish } from '../../base/trivial.ts'

export function getNextLang(current: string | undefined): string {
  return current === 'en' ? 'zh-CN' : 'en'
}

/** Returns the English locale for English-looking values, otherwise the closest authored locale. */
export function getProperLocale$(userLocales: LocaleTextStore, lang: string, value: string): Val<LocaleTextMap> {
  if (value && isEnglish(value)) {
    return userLocales.en
  }
  return localeChain(userLocales, lang)[0] ?? userLocales.en
}

export function localize(data: LocaleTextStore, lang$: ReadonlyVal<string>, get: ComputeGet, key: string, defaultValue?: string): string {
  const lang = get(lang$)

  for (const locale$ of localeChain(data, lang)) {
    const value = getOwnValue(get(locale$), key)
    if (value) return value
  }

  return defaultValue ?? key
}
