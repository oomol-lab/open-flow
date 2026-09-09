import type { Locale } from 'val-i18n'
import type { UiLanguage } from '../../localization/common/languages.ts'

import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

export const formLocales: Readonly<Record<UiLanguage, Locale>> = {
  'en': en,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja': ja,
  'ko': ko,
  'ru': ru,
  'fr': fr,
}
