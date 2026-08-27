import type { Locale, Locales } from 'val-i18n'
import type { UiLanguage } from '../../../localization/common/languages.ts'
import type { WorkbenchLanguage } from './contract.ts'

import { I18n } from 'val-i18n'
import { defaultUiLanguage, resolveUiLanguage, uiLanguages } from '../../../localization/common/languages.ts'
import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

const resources: Readonly<Record<UiLanguage, Locale>> = {
  'en': en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja': ja,
  'ko': ko,
  'ru': ru,
  'fr': fr,
}

export const locales: Locales = Object.fromEntries(uiLanguages.map((language) => [language, resources[language]]))

export function createI18n(initialLanguage: string = defaultUiLanguage): I18n {
  const language: WorkbenchLanguage = resolveUiLanguage([initialLanguage])
  return new I18n(language, locales)
}
