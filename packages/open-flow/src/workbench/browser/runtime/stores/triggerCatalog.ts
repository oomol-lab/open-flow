import type { ReadonlyVal, Val } from 'value-enhancer'
import type { TriggerCatalog } from '../../../../control/common/triggerCatalog.ts'
import type { UiLanguage } from '../../../../localization/common/languages.ts'
import type { WorkbenchClient } from '../api.ts'
import type { ResourceState } from './resource.ts'

import { createPersistentCache } from '@oomol-lab/resource-cache'
import { compute, val } from 'value-enhancer'
import { decodeTriggerCatalog } from '../../../../control/common/triggerCatalog.ts'
import { CacheResource } from './resource.ts'

export class TriggerCatalogStore {
  readonly #language: Val<UiLanguage>
  readonly #entries = new Map<UiLanguage, CacheResource<TriggerCatalog, void>>()
  readonly state: ReadonlyVal<ResourceState<TriggerCatalog>>
  constructor(
    private readonly client: WorkbenchClient,
    language: UiLanguage,
    private readonly environment = 'production',
  ) {
    this.#language = val(language)
    this.state = compute((get) => get(this.#entry(get(this.#language)).state))
  }
  #entry(locale: UiLanguage): CacheResource<TriggerCatalog, void> {
    let entry = this.#entries.get(locale)
    if (entry == null) {
      const decode = (value: unknown) => {
        const data = decodeTriggerCatalog(value)
        if (data.locale != locale) throw new Error('Unexpected Trigger catalog language.')
        return data
      }
      const cache = createPersistentCache<TriggerCatalog, void>({
        namespace: JSON.stringify(['open-flow:trigger-catalog', this.environment]),
        schemaVersion: 1,
        maxAge: 300_000,
        key: () => locale,
        decode,
        load: async (_query, validation) =>
          this.client.readCatalog({ path: `/v1/trigger-keys/catalog?locale=${encodeURIComponent(locale)}`, decode }, validation.etag, validation.signal),
      })
      entry = new CacheResource(async () => cache, undefined, true, 300_000)
      this.#entries.set(locale, entry)
    }
    return entry
  }
  setLanguage(language: UiLanguage): void {
    this.#language.set(language)
  }
  get(force = false): ReadonlyVal<ResourceState<TriggerCatalog>> {
    this.#entry(this.#language.value).get(force)
    return this.state
  }
  readonly retry = (): void => {
    this.get(true)
  }
  refresh(): Promise<void> {
    return this.#entry(this.#language.value).refresh()
  }
  dispose(): void {
    this.state.dispose()
    this.#language.dispose()
    for (const entry of this.#entries.values()) entry.dispose()
    this.#entries.clear()
  }
}
