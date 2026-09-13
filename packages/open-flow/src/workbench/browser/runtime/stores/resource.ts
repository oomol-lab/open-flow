import type { ReadonlyVal } from 'value-enhancer'
import type { ConditionalResult } from '../../../../control/common/api.ts'

import { val } from 'value-enhancer'

export interface ResourceState<T> {
  readonly data: T | undefined
  readonly refreshing: boolean
  readonly error: unknown
}
export interface ResourceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Refresh coordination for one Store-owned business value. Has no URL or query registry. */
export class Resource<T> {
  readonly #state = val<ResourceState<T>>({ data: undefined, refreshing: false, error: undefined })
  readonly state: ReadonlyVal<ResourceState<T>> = this.#state
  #etag: string | null = null
  #nextCheck = 0
  #pending?: Promise<void>
  #disposed = false
  #restored = false
  readonly #controller = new AbortController()

  constructor(
    private readonly read: (etag: string | null, signal: AbortSignal) => Promise<ConditionalResult<T>>,
    private readonly interval: number,
    persistence?: { key: string; storage: () => ResourceStorage; decode: (data: unknown) => T },
  ) {
    this.persistence = persistence
  }

  #restore(): void {
    if (this.#restored) return
    this.#restored = true
    const persistence = this.persistence
    try {
      const raw = persistence?.storage().getItem(persistence.key)
      if (raw != null) {
        const entry = JSON.parse(raw)
        if (entry != null && (entry.etag === null || typeof entry.etag == 'string')) {
          const data = persistence!.decode(entry.data)
          this.#etag = entry.etag
          this.#state.set({ data, refreshing: false, error: undefined })
        }
      }
    } catch {
      /* Invalid or unavailable storage is a miss. */
    }
  }
  private readonly persistence?: { key: string; storage: () => ResourceStorage; decode: (data: unknown) => T }

  get(force = false): ReadonlyVal<ResourceState<T>> {
    this.#restore()
    if (!this.#disposed && (force || Date.now() >= this.#nextCheck)) void this.refresh()
    return this.state
  }

  refresh(): Promise<void> {
    this.#restore()
    if (this.#disposed) return Promise.resolve()
    if (this.#pending != null) return this.#pending
    // Publish asynchronously so accessing a resource inside a computed Val is safe.
    const pending = Promise.resolve()
      .then(async () => {
        if (this.#disposed) return
        this.#state.set({ ...this.#state.value, refreshing: true })
        try {
          const result = await this.read(this.#etag, this.#controller.signal)
          if (this.#disposed) return
          const data = result.modified ? result.data : this.#state.value.data
          if (data === undefined) throw new Error('Received 304 without cached data.')
          this.#etag = result.modified ? result.etag : (result.etag ?? this.#etag)
          this.#nextCheck = Date.now() + this.interval
          try {
            this.persistence?.storage().setItem(this.persistence.key, JSON.stringify({ data, etag: this.#etag }))
          } catch {
            /* Storage is optional. */
          }
          this.#state.set({ data, refreshing: false, error: undefined })
        } catch (error) {
          if (!this.#disposed) {
            this.#nextCheck = Date.now() + 30_000
            this.#state.set({ ...this.#state.value, refreshing: false, error })
          }
        }
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
        return
      }
      if (settled && value.refreshing) return
      if (value.error != null && (settled || value.data === undefined)) {
        finish()
        reject(value.error)
      } else if (value.data !== undefined) {
        finish()
        resolve(value.data)
      }
    }
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
