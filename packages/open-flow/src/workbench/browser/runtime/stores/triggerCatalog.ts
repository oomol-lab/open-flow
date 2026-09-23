import type { ReadonlyVal } from 'value-enhancer'
import type { TriggerCatalog } from '../../../../control/common/triggerCatalog.ts'
import type { UiLanguage } from '../../../../localization/common/languages.ts'
import type { WorkbenchClient } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'
import type { ResourceState, ResourceStorage } from './resource.ts'

import { compute, val } from 'value-enhancer'
import { decodeTriggerCatalog } from '../../../../control/common/triggerCatalog.ts'
import { Resource } from './resource.ts'

export type TriggerCatalogStorage = ResourceStorage
export function browserTriggerCatalogStorage(namespace: string, storage?: TriggerCatalogStorage): TriggerCatalogStorage {
  const prefix = `open-flow:trigger-catalog:v4:${encodeURIComponent(namespace)}:`
  return {
    getItem: (key) => (storage ?? window.localStorage).getItem(prefix + key),
    setItem: (key, value) => (storage ?? window.localStorage).setItem(prefix + key, value),
  }
}

export class TriggerCatalogStore {
  readonly #language
  readonly #entries = new Map<UiLanguage, Resource<TriggerCatalog>>()
  readonly state: ReadonlyVal<ResourceState<TriggerCatalog>>
  constructor(
    private readonly client: WorkbenchClient,
    language: UiLanguage,
    private readonly host: Pick<WorkbenchHost, 'triggerCatalogCache'>,
  ) {
    this.#language = val(language)
    this.state = compute((get) => get(this.#entry(get(this.#language)).state))
  }
  #entry(locale: UiLanguage): Resource<TriggerCatalog> {
    let entry = this.#entries.get(locale)
    if (entry == null) {
      const decode = (value: unknown) => {
        const data = decodeTriggerCatalog(value)
        if (data.locale != locale) throw new Error('Unexpected Trigger catalog language.')
        return data
      }
      const storage = this.host.triggerCatalogCache
      entry = new Resource(
        (etag, signal) => this.client.readCatalog({ path: `/v1/trigger-keys/catalog?locale=${encodeURIComponent(locale)}`, decode }, etag, signal),
        300_000,
        storage == null ? undefined : { key: locale, storage: () => browserTriggerCatalogStorage(storage.namespace, storage.storage), decode },
      )
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
