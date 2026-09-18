import type { Locale, TFunction } from 'val-i18n'
import type { UiLanguage } from '../../../localization/common/languages.ts'

import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'

const descriptions = (locale: typeof en): Locale => ({
  canvasCard: {
    waitBranchDescription: locale.canvasCard.waitBranchDescription,
  },
})

/** Canvas-owned copy shared with other surfaces that present Wait and Approval branches. */
export const waitBranchLocales: Readonly<Record<UiLanguage, Locale>> = {
  'en': descriptions(en),
  'zh-CN': descriptions(zhCN),
  'zh-TW': descriptions(zhTW),
  'ja': descriptions(ja),
  'ko': descriptions(ko),
  'ru': descriptions(ru),
  'fr': descriptions(fr),
}

export function waitBranchDescription(t: TFunction, kind: 'approval' | 'wait', branch: string): string {
  return t(`canvasCard.waitBranchDescription.${branch === 'pending' ? `pending.${kind}` : branch}`)
}
