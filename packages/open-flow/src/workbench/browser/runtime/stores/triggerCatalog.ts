import type { ReadonlyVal } from 'value-enhancer'
import type { TriggerCatalog } from '../../../../control/common/triggerCatalog.ts'
import type { UiLanguage } from '../../../../localization/common/languages.ts'
import type { WorkbenchClient } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'
import type { ResourceState } from './resource.ts'

import { compute, val } from 'value-enhancer'
import { decodeTriggerCatalog } from '../../../../control/common/triggerCatalog.ts'
import { catalogPersistence } from './catalogStorage.ts'
import { Resource } from './resource.ts'

export class TriggerCatalogStore {
  readonly #language
  readonly #entries = new Map<UiLanguage, Resource<TriggerCatalog>>()
  readonly state: ReadonlyVal<ResourceState<TriggerCatalog>>
  constructor(
    private readonly client: WorkbenchClient,
    language: UiLanguage,
    private readonly host: Pick<WorkbenchHost, 'catalogCache'>,
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
      const persistence = catalogPersistence(this.host.catalogCache, 'triggers', locale)
      entry = new Resource(
        (etag, signal) => this.client.readCatalog({ path: `/v1/trigger-keys/catalog?locale=${encodeURIComponent(locale)}`, decode }, etag, signal),
        300_000,
        persistence == null ? undefined : { ...persistence, decode },
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
