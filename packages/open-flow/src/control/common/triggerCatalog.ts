import type { TriggerKeySnapshot } from '../../flow/common/change.ts'
import type { UiLanguage } from '../../localization/common/languages.ts'

import { isUiLanguage } from '../../localization/common/languages.ts'
import { exact, invalidResponse, record, string } from './decoding.ts'
import { triggerKey } from './triggerDecoders.ts'

export interface TriggerDisplay {
  readonly displayName: string
  readonly description: string
}

export interface TriggerCatalog {
  readonly version: 1
  readonly locale: UiLanguage
  readonly definitions: readonly TriggerKeySnapshot[]
  readonly display: Readonly<Record<string, TriggerDisplay>>
}

export interface TriggerCatalogCache {
  readonly data: TriggerCatalog
  readonly etag: string | null
}

export function decodeTriggerCatalog(value: unknown): TriggerCatalog {
  const source = record(value)
  exact(source, ['version', 'locale', 'definitions', 'display'])
  if (source.version != 1 || !isUiLanguage(source.locale) || !Array.isArray(source.definitions)) return invalidResponse()
  const definitions = source.definitions.map(triggerKey)
  const entries = record(source.display)
  const keys = new Set(definitions.map((definition) => definition.key))
  if (keys.size != definitions.length || Object.keys(entries).length != keys.size) return invalidResponse()
  const display = Object.fromEntries(
    definitions.map(({ key }) => {
      const copy = record(entries[key])
      exact(copy, ['displayName', 'description'])
      return [key, { displayName: string(copy.displayName), description: typeof copy.description == 'string' ? copy.description : invalidResponse() }]
    }),
  )
  return { version: 1, locale: source.locale, definitions, display }
}
