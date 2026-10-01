import type { ResourceCache } from '@oomol-lab/resource-cache'
import type { ReadonlyVal } from 'value-enhancer'

import { derive, val } from 'value-enhancer'

export interface ResourceState<T> {
  readonly data: T | undefined
  readonly refreshing: boolean
  readonly error: unknown
}

const dataSources = new WeakMap<ReadonlyVal<ResourceState<unknown>>, ReadonlyVal<unknown>>()

/** Keep data-only consumers independent from refresh and error notifications. */
export function resourceData<T>(source: ReadonlyVal<ResourceState<T>>): ReadonlyVal<T | undefined> {
  let data = dataSources.get(source)
  if (data == null) {
    data = derive(source, (state) => state.data)
    dataSources.set(source, data)
  }
  return data as ReadonlyVal<T | undefined>
}

/**
 * The browser Store contract is reactive, while resource-cache deliberately
 * exposes an async cache API. This adapter owns presentation freshness and
 * refresh coordination; cache identity, persistence, validation and conditional
 * request coordination stay in the resource-cache instance.
 */
export class CacheResource<T, Q> {
  readonly #state = val<ResourceState<T>>({ data: undefined, refreshing: false, error: undefined })
  readonly state: ReadonlyVal<ResourceState<T>> = this.#state
  #started = false
  #nextCheck = 0
  #pending?: Promise<void>
  #refreshAgain = false
  #disposed = false
  #cache?: ResourceCache<T, Q>
  #cachePromise?: Promise<ResourceCache<T, Q>>

  constructor(
    private readonly resolveCache: () => Promise<ResourceCache<T, Q>>,
    private readonly query: Q,
    private readonly closeCache = false,
    private readonly maxAge = 30_000,
  ) {}

  get(force = false): ReadonlyVal<ResourceState<T>> {
    if (!this.#disposed && (force || !this.#started || Date.now() >= this.#nextCheck)) {
      this.#started = true
      void this.refresh(force)
    }
    return this.state
  }

  refresh(force = false): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    if (this.#pending != null) {
      if (force) this.#refreshAgain = true
      return this.#pending
    }
    this.#started = true
    const pending = Promise.resolve()
      .then(async () => {
        let revalidate = force
        let repeat = false
        do {
          const queued = this.#refreshAgain
          this.#refreshAgain = false
          if (this.#disposed) return
          this.#state.set({ ...this.#state.value, refreshing: true })
          try {
            const cache = await (this.#cachePromise ??= this.resolveCache().then((resolved) => {
              this.#cache = resolved
              if (this.#disposed && this.closeCache) void resolved.dispose()
              return resolved
            }))
            const snapshot = await cache.peek(this.query)
            if (this.#disposed) return
            if (snapshot != null) {
              if (snapshot.fresh && !revalidate) {
                this.#nextCheck = snapshot.validatedAt + this.maxAge
                this.#state.set({ data: snapshot.data, refreshing: false, error: undefined })
                repeat = queued || this.#refreshAgain
                revalidate = repeat
                if (!repeat) return
                continue
              }
              this.#state.set({ data: snapshot.data, refreshing: true, error: undefined })
            }
            const data = await cache.get(this.query, { revalidate })
            if (!this.#disposed) {
              this.#nextCheck = Date.now() + this.maxAge
              this.#state.set({ data, refreshing: false, error: undefined })
            }
            repeat = queued || this.#refreshAgain
            revalidate = repeat
          } catch (error) {
            if (!this.#disposed && !this.#refreshAgain) {
              this.#nextCheck = Date.now() + 30_000
              this.#state.set({ ...this.#state.value, refreshing: false, error })
            }
            repeat = queued || this.#refreshAgain
            revalidate = repeat
          }
        } while (!this.#disposed && repeat)
      })
      .finally(() => {
        if (this.#pending === pending) this.#pending = undefined
      })
    this.#pending = pending
    return pending
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#state.set({ ...this.#state.value, refreshing: false })
    this.#state.dispose()
    if (this.closeCache && this.#cache != null) void this.#cache.dispose()
  }
}

export type ResourceSource<T> = ReadonlyVal<ResourceState<T>> | Promise<T | undefined>

/** Wait for a value without cancelling the shared cache request. */
export function resourceValue<T>(state: ReadonlyVal<ResourceState<T>>, signal?: AbortSignal, settled = false): Promise<T> {
  return new Promise((resolve, reject) => {
    let stop: (() => void) | undefined
    const finish = () => {
      stop?.()
      signal?.removeEventListener('abort', aborted)
    }
    const aborted = () => {
      finish()
      reject(signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
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
      }
      if (value.data !== undefined) {
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
    return
  }
  const publish = () => {
    if (!signal.aborted) update(source.value)
  }
  const stop = source.subscribe(publish)
  signal.addEventListener('abort', stop, { once: true })
  publish()
}
