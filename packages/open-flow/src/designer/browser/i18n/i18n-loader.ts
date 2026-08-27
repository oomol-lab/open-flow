import type { Locale, Locales } from 'val-i18n'

import { I18n } from 'val-i18n'
import { defaultUiLanguage, resolveUiLanguage } from '../../../localization/common/languages.ts'
import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ko from './locales/ko.json'
import ru from './locales/ru.json'
import zh_CN from './locales/zh-CN.json'
import zh_TW from './locales/zh-TW.json'

// Declared in `uiLanguages` order; `localeLangs` and the HMR block below both read back from here.
const locales: Locales = {
  'en': en,
  'zh-CN': zh_CN,
  'zh-TW': zh_TW,
  'ja': ja,
  'ko': ko,
  'ru': ru,
  'fr': fr,
}

export const defaultLang: string = defaultUiLanguage

export const localeLangs: readonly string[] = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.keys(locales))

const hmrI18ns: Set<WeakRef<I18n>> = new Set()

/** `navigator.languages` where the host provides it; empty in non-browser hosts such as tests. */
function preferredLanguages(): readonly string[] {
  const languages: unknown = typeof navigator == 'undefined' ? undefined : navigator.languages
  return Array.isArray(languages) ? (languages as readonly string[]) : []
}

export const createI18n = (lang: string): I18n => {
  const initLang = resolveUiLanguage([lang, ...preferredLanguages()], defaultUiLanguage)

  if (import.meta.hot) {
    const instance = new I18n(initLang, locales)
    hmrI18ns.add(new WeakRef(instance))
    return instance
  }

  return new I18n(initLang, locales)
}

if (import.meta.hot) {
  // Vite only lexes a literal dependency array, so the paths repeat the `locales` order once here.
  import.meta.hot.accept(
    ['./locales/en.json', './locales/zh-CN.json', './locales/zh-TW.json', './locales/ja.json', './locales/ko.json', './locales/ru.json', './locales/fr.json'],
    (updated) => {
      for (const i18nReference of hmrI18ns) {
        const i18n = i18nReference.deref()
        if (!i18n) {
          hmrI18ns.delete(i18nReference)
          continue
        }

        const next: { [lang: string]: Locale } = { ...i18n.locales }
        localeLangs.forEach((lang, index) => {
          const locale = updated[index]?.default as Locale | undefined
          if (locale) next[lang] = locale
        })
        i18n.locales$.set(next)
      }
    },
  )
}
