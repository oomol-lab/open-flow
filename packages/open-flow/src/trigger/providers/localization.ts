import type { TriggerDisplay } from '../../control/common/triggerCatalog.ts'
import type { TriggerKeySnapshot } from '../../flow/common/change.ts'
import type { UiLanguage } from '../../localization/common/languages.ts'

type Translations = Readonly<Record<string, Partial<TriggerDisplay>>>

const loaders = {
  'zh-CN': () => import('./locales/zh-CN.ts'),
  'zh-TW': () => import('./locales/zh-TW.ts'),
  'ja': () => import('./locales/ja.ts'),
  'ko': () => import('./locales/ko.ts'),
  'ru': () => import('./locales/ru.ts'),
  'fr': () => import('./locales/fr.ts'),
} satisfies Record<Exclude<UiLanguage, 'en'>, () => Promise<{ default: Translations }>>

const cached = new Map<UiLanguage, Promise<Translations>>()
const english = Promise.resolve<Translations>({})

export function loadTriggerTranslations(locale: UiLanguage): Promise<Translations> {
  if (locale == 'en') return english
  const existing = cached.get(locale)
  if (existing != null) return existing
  const request = loaders[locale]().then((module) => module.default)
  cached.set(locale, request)
  void request.catch(() => {
    if (cached.get(locale) == request) cached.delete(locale)
  })
  return request
}

export async function localizeTrigger(definition: TriggerKeySnapshot, locale: UiLanguage): Promise<TriggerDisplay> {
  const translations = await loadTriggerTranslations(locale)
  const copy = translations[definition.key]
  return { displayName: copy?.displayName ?? definition.displayName, description: copy?.description ?? definition.description }
}
