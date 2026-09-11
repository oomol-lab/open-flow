import type { TriggerCatalog, TriggerCatalogCache } from '../../../../control/common/triggerCatalog.ts'
import type { UiLanguage } from '../../../../localization/common/languages.ts'
import type { WorkbenchClient } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'

import { val } from 'value-enhancer'
import { decodeTriggerCatalog } from '../../../../control/common/triggerCatalog.ts'

export interface TriggerCatalogStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function browserTriggerCatalogStorage(namespace: string, storage?: TriggerCatalogStorage): TriggerCatalogStorage {
  const prefix = `open-flow:trigger-catalog:v1:${encodeURIComponent(namespace)}:`
  return {
    getItem: (key) => (storage ?? window.localStorage).getItem(prefix + key),
    setItem: (key, value) => (storage ?? window.localStorage).setItem(prefix + key, value),
  }
}

/** Owns cached representations and conditional requests; callers own the displayed options. */
export class TriggerCatalogStore {
  readonly state = val({ revision: 0, failed: false })
  readonly #memory = new Map<UiLanguage, TriggerCatalogCache>()
  readonly #storage?: TriggerCatalogStorage
  #controller = new AbortController()
  #pending?: Promise<TriggerCatalogCache>
  #disposed = false

  constructor(
    private readonly client: WorkbenchClient,
    private language: UiLanguage,
    host: Pick<WorkbenchHost, 'triggerCatalogCache'>,
  ) {
    this.#storage =
      host.triggerCatalogCache == null ? undefined : browserTriggerCatalogStorage(host.triggerCatalogCache.namespace, host.triggerCatalogCache.storage)
  }

  setLanguage(language: UiLanguage): void {
    if (language == this.language || this.#disposed) return
    this.reset()
    this.language = language
    this.#changed(false)
  }

  reset(): void {
    this.#controller.abort()
    this.#controller = new AbortController()
    this.#pending = undefined
  }

  dispose(): void {
    this.#disposed = true
    this.reset()
    this.state.dispose()
  }

  #read(): TriggerCatalogCache | undefined {
    const memory = this.#memory.get(this.language)
    if (memory != null) return memory
    try {
      const raw = this.#storage?.getItem(this.language)
      if (raw == null) return
      const cached = JSON.parse(raw) as TriggerCatalogCache
      if (cached == null || (cached.etag !== null && typeof cached.etag != 'string')) return
      const data = decodeTriggerCatalog(cached.data)
      if (data.locale != this.language) return
      const entry = { data, etag: cached.etag }
      this.#memory.set(this.language, entry)
      return entry
    } catch {
      return
    }
  }

  async get(): Promise<TriggerCatalog> {
    const cached = this.#read()
    return cached?.data ?? (await this.refresh()).data
  }

  readonly open = (): void => {
    void this.refresh().catch(() => {})
  }

  refresh(): Promise<TriggerCatalogCache> {
    if (this.#pending != null) return this.#pending
    const locale = this.language
    const cached = this.#read()
    const signal = this.#controller.signal
    const request = this.client
      .getTriggerCatalog(locale, cached, signal)
      .then((entry) => {
        if (signal.aborted || this.#disposed) throw new DOMException('Catalog request cancelled', 'AbortError')
        this.#memory.set(locale, entry)
        try {
          this.#storage?.setItem(locale, JSON.stringify(entry))
        } catch {
          /* Storage is optional. */
        }
        this.#changed(false)
        return entry
      })
      .catch((error: unknown) => {
        if (!signal.aborted && !this.#disposed) this.#changed(true)
        throw error
      })
      .finally(() => {
        if (this.#pending == request) this.#pending = undefined
      })
    this.#pending = request
    return request
  }

  #changed(failed: boolean): void {
    this.state.set({ revision: this.state.value.revision + (failed ? 0 : 1), failed })
  }
}
