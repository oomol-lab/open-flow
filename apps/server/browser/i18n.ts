import type { WorkbenchLanguage } from '@oomol-lab/open-flow/workbench'
import type { Locale, Locales } from 'val-i18n'

import { resolveWorkbenchLanguage, workbenchLanguages } from '@oomol-lab/open-flow/workbench'
import { I18n } from 'val-i18n'
import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

const resources: Readonly<Record<WorkbenchLanguage, Locale>> = {
  'en': en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja': ja,
  'ko': ko,
  'ru': ru,
  'fr': fr,
}

export const locales: Locales = Object.fromEntries(workbenchLanguages.map((language) => [language, resources[language]]))

export function createI18n(language: string): I18n {
  return new I18n(resolveWorkbenchLanguage([language]), locales)
}
