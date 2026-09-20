import type { TriggerKeySnapshot } from '../../flow/common/change.ts'
import type { UiLanguage } from '../../localization/common/languages.ts'

import { isUiLanguage } from '../../localization/common/languages.ts'
import { exact, invalidResponse, record, string } from './decoding.ts'
import { triggerKey } from './triggerDecoders.ts'

export interface TriggerDisplay {
  readonly configInputs: Readonly<Record<string, string>>
  readonly displayName: string
  readonly description: string
  readonly outputs: Readonly<Record<string, string>>
}

export interface TriggerCatalog {
  readonly version: 2
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
  if (source.version != 2 || !isUiLanguage(source.locale) || !Array.isArray(source.definitions)) return invalidResponse()
  const definitions = source.definitions.map(triggerKey)
  const entries = record(source.display)
  const keys = new Set(definitions.map((definition) => definition.key))
  if (keys.size != definitions.length || Object.keys(entries).length != keys.size) return invalidResponse()
  const display = Object.fromEntries(
    definitions.map((definition) => {
      const { key } = definition
      const copy = record(entries[key])
      exact(copy, ['configInputs', 'displayName', 'description', 'outputs'])
      return [
        key,
        {
          configInputs: descriptions(
            copy.configInputs,
            definition.configInputs.flatMap((field) => ('handle' in field ? [field.handle] : [])),
          ),
          displayName: string(copy.displayName),
          description: string(copy.description),
          outputs: descriptions(
            copy.outputs,
            definition.outputs.map((field) => field.handle),
          ),
        },
      ]
    }),
  )
  return { version: 2, locale: source.locale, definitions, display }
}

function descriptions(value: unknown, handles: readonly string[]): Readonly<Record<string, string>> {
  const source = record(value)
  exact(source, handles)
  return Object.fromEntries(Object.entries(source).map(([handle, description]) => [handle, string(description)]))
}
