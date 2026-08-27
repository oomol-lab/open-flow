import type { Result } from '@wopjs/tsur'
import type { Val } from 'value-enhancer'

import { userLocaleFallbackChain } from './languages.ts'

export interface LocaleTextMap {
  readonly [key: string]: string
}

export interface LocaleTextStore {
  readonly 'en': Val<LocaleTextMap>
  readonly 'zh-CN': Val<LocaleTextMap>
  readonly [language: string]: Val<LocaleTextMap> | undefined
}

export interface TranslateText {
  (text: string, from?: string, to?: string): Promise<Result<string, string>>
}

/**
 * The authored locales to consult for a UI language, most preferred first. Package authors only
 * write `oo-locales/en.json` and `oo-locales/zh-CN.json`, so the chain skips absent languages: a
 * zh-TW reader sees Simplified Chinese before English, ja/ko/ru/fr readers see English first.
 */
export function localeChain<T>(locales: { readonly [language: string]: T | undefined }, language: string): readonly T[] {
  const chain: T[] = []
  for (const candidate of userLocaleFallbackChain(language)) {
    const locale = locales[candidate]
    if (locale != null) chain.push(locale)
  }
  return chain
}
