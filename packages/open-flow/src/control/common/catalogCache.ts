import type { CacheDelegate } from '../../base/common/cache.ts'
import type { JsonValue } from '../../flow/common/change.ts'

import { jsonValue } from './decoding.ts'
import { ApiError } from './errors.ts'

export type ControlCacheDelegate = CacheDelegate

export interface ControlCacheRead {
  readonly path: string
  readonly source: 'cache' | 'network' | 'revalidated'
  readonly body: JsonValue
  readonly etag: string | null
  readonly validatedAt: number
  readonly stale: boolean
}

export interface ControlCacheOptions {
  /** Non-secret identity of the deployment and effective caller/resource scope. */
  readonly scope: string
  readonly delegate: ControlCacheDelegate
  readonly mode?: 'default' | 'refresh' | 'offline'
  readonly maxAgeMs?: number
  readonly onRead?: (read: ControlCacheRead) => void
}

interface CachedResponse {
  readonly version: 1
  readonly body: JsonValue
  readonly etag: string | null
  readonly validatedAt: number
}

interface CatalogQuery<Value> {
  readonly path: string
  readonly decode: (value: unknown) => Value
}

type CatalogLoad = (
  etag: string | null,
) => Promise<{ readonly modified: true; readonly data: JsonValue; readonly etag: string | null } | { readonly modified: false; readonly etag: string | null }>

function cachedResponse(value: unknown): CachedResponse | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const entry = value as Record<string, unknown>
  if (
    entry.version !== 1 ||
    !Object.hasOwn(entry, 'body') ||
    !(entry.etag === null || typeof entry.etag == 'string') ||
    typeof entry.validatedAt != 'number' ||
    !Number.isFinite(entry.validatedAt) ||
    entry.validatedAt < 0
  )
    return
  return { version: 1, body: jsonValue(entry.body), etag: entry.etag, validatedAt: entry.validatedAt }
}

/** Cancellation belongs to each waiter, not the shared metadata request. */
function wait<Value>(promise: Promise<Value>, signal?: AbortSignal): Promise<Value> {
  if (signal == null) return promise
  if (signal.aborted) {
    void promise.catch(() => {})
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Complete Flow API responses, never a merged store of catalog entities. */
export class ControlCatalogCache {
  readonly #pending = new Map<string, { readonly fresh: boolean; readonly promise: Promise<ControlCacheRead> }>()
  private readonly options: ControlCacheOptions

  constructor(options: ControlCacheOptions) {
    this.options = options
    if (!options.scope.trim()) throw new TypeError('Control cache scope must be nonempty.')
    if (options.maxAgeMs != null && (!Number.isFinite(options.maxAgeMs) || options.maxAgeMs < 0))
      throw new TypeError('Control cache maxAgeMs must be finite and nonnegative.')
  }

  async read<Value>(query: CatalogQuery<Value>, load: CatalogLoad, maxAgeMs: number, signal?: AbortSignal, fresh = false, cacheOnly = false) {
    signal?.throwIfAborted()
    const key = JSON.stringify(['open-flow:catalog', 1, this.options.scope, query.path])
    const result = await wait(
      cacheOnly
        ? this.#load(key, query, load, this.options.maxAgeMs ?? maxAgeMs, false, true)
        : this.#request(key, query, load, this.options.maxAgeMs ?? maxAgeMs, fresh || this.options.mode == 'refresh'),
      signal,
    )
    const data = query.decode(structuredClone(result.body))
    try {
      this.options.onRead?.({ ...result, body: structuredClone(result.body) })
    } catch {}
    return { data, etag: result.etag }
  }

  #request<Value>(key: string, query: CatalogQuery<Value>, load: CatalogLoad, maxAgeMs: number, fresh: boolean): Promise<ControlCacheRead> {
    const previous = this.#pending.get(key)
    if (previous != null) {
      if (!fresh || previous.fresh) return previous.promise
      // An explicit refresh must validate after a preceding ordinary lookup.
      return previous.promise.catch(() => undefined).then(() => this.#request(key, query, load, maxAgeMs, true))
    }
    const promise = this.#load(key, query, load, maxAgeMs, fresh).finally(() => {
      if (this.#pending.get(key)?.promise === promise) this.#pending.delete(key)
    })
    this.#pending.set(key, { fresh, promise })
    return promise
  }

  async #load<Value>(
    key: string,
    query: CatalogQuery<Value>,
    load: CatalogLoad,
    maxAgeMs: number,
    fresh: boolean,
    cacheOnly = false,
  ): Promise<ControlCacheRead> {
    let cached: CachedResponse | undefined
    try {
      const stored = await this.options.delegate.get(key)
      cached = cachedResponse(stored)
      if (cached != null) query.decode(structuredClone(cached.body))
      if (stored !== undefined && cached == null) await this.options.delegate.delete(key)
    } catch {
      cached = undefined
      try {
        await this.options.delegate.delete(key)
      } catch {}
    }
    const now = Date.now()
    const stale = cached == null || cached.validatedAt > now || now - cached.validatedAt >= maxAgeMs
    if (cached != null && (cacheOnly || this.options.mode == 'offline' || (!fresh && !stale))) return { ...cached, path: query.path, source: 'cache', stale }
    if (cacheOnly || this.options.mode == 'offline') throw new ApiError(503, 'catalog.cache-miss', `No compatible cached response for ${query.path}.`)

    const result = await load(cached?.etag ?? null)
    if (!result.modified && cached == null) throw new ApiError(502, 'response.invalid', 'A catalog returned 304 without a cached response.')
    const entry: CachedResponse = {
      version: 1,
      body: result.modified ? result.data : cached!.body,
      etag: result.etag ?? (result.modified ? null : cached!.etag),
      validatedAt: Date.now(),
    }
    query.decode(structuredClone(entry.body))
    try {
      await this.options.delegate.set(key, structuredClone({ ...entry }))
    } catch {}
    return { ...entry, path: query.path, source: result.modified ? 'network' : 'revalidated', stale: false }
  }
}
