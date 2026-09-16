import type { Locale } from 'val-i18n'
import type { UiLanguage } from '../../../localization/common/languages.ts'

import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

/** The IANA-keyed city names shared by the canvas schedule summary and schedule editor. */
export const timeZoneLocales: Readonly<Record<UiLanguage, Locale>> = {
  'en': { timeZoneNames: en.timeZoneNames },
  'zh-CN': { timeZoneNames: zhCN.timeZoneNames },
  'zh-TW': { timeZoneNames: zhTW.timeZoneNames },
  'ja': { timeZoneNames: ja.timeZoneNames },
  'ko': { timeZoneNames: ko.timeZoneNames },
  'ru': { timeZoneNames: ru.timeZoneNames },
  'fr': { timeZoneNames: fr.timeZoneNames },
}
