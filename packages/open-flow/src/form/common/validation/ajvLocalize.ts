import type { ErrorObject } from 'ajv'
import type { UiLanguage } from '../../../localization/common/languages.ts'

import ajvEN from 'ajv-i18n/localize/en/index.js'
import ajvFR from 'ajv-i18n/localize/fr/index.js'
import ajvJA from 'ajv-i18n/localize/ja/index.js'
import ajvKO from 'ajv-i18n/localize/ko/index.js'
import ajvRU from 'ajv-i18n/localize/ru/index.js'
import ajvZhTW from 'ajv-i18n/localize/zh-TW/index.js'
import ajvZH from 'ajv-i18n/localize/zh/index.js'
import { resolveUiLanguage } from '../../../localization/common/languages.ts'

/** Rewrites `error.message` in place, the shape every ajv-i18n localizer exposes. */
export type AjvLocalize = (errors?: ErrorObject[] | null) => void

// ajv-i18n names Simplified Chinese "zh"; every other UI language matches its own tag.
const ajvLocalizers: Readonly<Record<UiLanguage, AjvLocalize>> = {
  'en': ajvEN,
  'zh-CN': ajvZH,
  'zh-TW': ajvZhTW,
  'ja': ajvJA,
  'ko': ajvKO,
  'ru': ajvRU,
  'fr': ajvFR,
}

/** Returns the ajv-i18n localizer for a UI language tag, falling back to English for unknown tags. */
export function ajvLocalizeOf(language: string | undefined): AjvLocalize {
  return ajvLocalizers[resolveUiLanguage([language])]
}

/** Translates ajv errors in place into the UI language. */
export function localizeAjvErrors(language: string | undefined, errors: ErrorObject[] | null | undefined): void {
  ajvLocalizeOf(language)(errors)
}
