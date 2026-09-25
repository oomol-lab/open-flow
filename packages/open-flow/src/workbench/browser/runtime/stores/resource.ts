import type { ReadonlyVal } from 'value-enhancer'
import type { ConditionalResult } from '../../../../control/common/api.ts'
import type { CatalogCacheStorage } from '../contract.ts'

import { derive, val } from 'value-enhancer'
import { optionalStorage } from './resourceStorage.ts'

export interface ResourceState<T> {
  readonly data: T | undefined
  readonly refreshing: boolean
  readonly error: unknown
}
// One selector per source: loading/error changes must not invalidate data-only consumers.
const dataSources = new WeakMap<ReadonlyVal<ResourceState<unknown>>, ReadonlyVal<unknown>>()

export function resourceData<T>(source: ReadonlyVal<ResourceState<T>>): ReadonlyVal<T | undefined> {
  let data = dataSources.get(source)
  if (data == null) {
    data = derive(source, (state) => state.data)
    dataSources.set(source, data)
  }
  return data as ReadonlyVal<T | undefined>
}

interface ResourcePersistence<T> {
  readonly key: string
  readonly storage: CatalogCacheStorage
  readonly decode: (data: unknown) => T
}

/** Refresh coordination for one Store-owned business value. Has no URL or query registry. */
export class Resource<T> {
  readonly #state = val<ResourceState<T>>({ data: undefined, refreshing: false, error: undefined })
  readonly state: ReadonlyVal<ResourceState<T>> = this.#state
  #etag: string | null = null
  #nextCheck = 0
  #pending?: Promise<void>
  #refreshAgain = false
  #disposed = false
  #restored = false
  readonly #controller = new AbortController()
  private readonly persistence?: ResourcePersistence<T>

  constructor(
    private readonly read: (etag: string | null, signal: AbortSignal) => Promise<ConditionalResult<T>>,
    private readonly interval: number,
    persistence?: ResourcePersistence<T>,
  ) {
    this.persistence = persistence == null ? undefined : { ...persistence, storage: optionalStorage(persistence.storage) }
  }

  async #restore(): Promise<void> {
    this.#restored = true
    const persistence = this.persistence
    if (persistence == null) return
    try {
      const entry = await persistence.storage.get(persistence.key)
      if (!this.#disposed && entry != null && typeof entry === 'object' && 'etag' in entry && 'data' in entry) {
        if (entry.etag === null || typeof entry.etag == 'string') {
          const data = persistence.decode(entry.data)
          this.#etag = entry.etag
          this.#state.set({ data, refreshing: true, error: undefined })
        }
      }
    } catch {
      /* Invalid or unavailable storage is a miss. */
    }
  }
  get(force = false): ReadonlyVal<ResourceState<T>> {
    if (!this.#disposed && (force || Date.now() >= this.#nextCheck)) void this.refresh(force)
    return this.state
  }

  refresh(force = false): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    if (this.#pending != null) {
      if (force) this.#refreshAgain = true
      return this.#pending
    }
    // Publish asynchronously so accessing a resource inside a computed Val is safe.
    const pending = Promise.resolve()
      .then(async () => {
        if (this.#disposed) return
        if (!this.#restored && this.persistence != null) await this.#restore()
        if (this.#disposed) return
        this.#state.set({ ...this.#state.value, refreshing: true })
        do {
          // A forced read must start after the change that invalidated the current request.
          this.#refreshAgain = false
          try {
            const result = await this.read(this.#etag, this.#controller.signal)
            if (this.#disposed) return
            if (this.#refreshAgain) continue
            const data = result.modified ? result.data : this.#state.value.data
            if (data === undefined) throw new Error('Received 304 without cached data.')
            const previousEtag = this.#etag
            this.#etag = result.modified ? result.etag : (result.etag ?? this.#etag)
            this.#nextCheck = Date.now() + this.interval
            this.#state.set({ data, refreshing: false, error: undefined })
            if (this.persistence != null && (result.modified || this.#etag !== previousEtag)) {
              void this.persistence.storage.set(this.persistence.key, { data, etag: this.#etag })
            }
          } catch (error) {
            if (!this.#disposed && !this.#refreshAgain) {
              this.#nextCheck = Date.now() + 30_000
              this.#state.set({ ...this.#state.value, refreshing: false, error })
            }
          }
        } while (!this.#disposed && this.#refreshAgain)
      })
      .finally(() => {
        if (this.#pending === pending) this.#pending = undefined
      })
    this.#pending = pending
    return pending
  }

  dispose(): void {
    this.#disposed = true
    this.#controller.abort()
    this.#state.set({ ...this.#state.value, refreshing: false, error: this.#controller.signal.reason })
    this.#state.dispose()
  }
}

/** Imperative business operations may wait for their first value; rendering subscribes directly. */
export function resourceValue<T>(state: ReadonlyVal<ResourceState<T>>, signal?: AbortSignal, settled = false): Promise<T> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined
    const finish = () => {
      stop?.()
      signal?.removeEventListener('abort', aborted)
    }
    const aborted = () => {
      finish()
      reject(signal?.reason)
    }
    const check = () => {
      const value = state.value
      if (signal?.aborted) {
        aborted()
        return true
      }
      if (settled && value.refreshing) return false
      if (value.error != null && (settled || value.data === undefined)) {
        finish()
        reject(value.error)
        return true
      } else if (value.data !== undefined) {
        finish()
        resolve(value.data)
        return true
      }
      return false
    }
    if (check()) return
    stop = state.subscribe(check)
    signal?.addEventListener('abort', aborted, { once: true })
    check()
  })
}

export type ResourceSource<T> = ReadonlyVal<ResourceState<T>> | Promise<T | undefined>

export function observeResource<T>(source: ResourceSource<T>, signal: AbortSignal, update: (state: ResourceState<T>) => void): void {
  if (signal.aborted) return
  if ('then' in source) {
    update({ data: undefined, refreshing: true, error: undefined })
    void source.then(
      (data) => {
        if (!signal.aborted) update({ data, refreshing: false, error: undefined })
      },
      (error) => {
        if (!signal.aborted) update({ data: undefined, refreshing: false, error })
      },
    )
  } else {
    const publish = () => {
      if (!signal.aborted) update(source.value)
    }
    const stop = source.subscribe(publish)
    signal.addEventListener('abort', stop, { once: true })
    publish()
  }
}
