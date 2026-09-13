import { val } from 'value-enhancer'
import { invalidResponse } from '../../../control/common/decoding.ts'

interface StoredResponse {
  readonly data: unknown
  readonly etag: string | null
}
interface CachedResponse extends StoredResponse {
  readonly value: unknown
}
interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export interface RequestCachePolicy {
  readonly maxAgeMs: number
  readonly storage?: () => Storage
}

/** Each URL owns one complete response. No entity indexing or cross-query merging. */
export class RequestCache {
  readonly responses = val<ReadonlyMap<string, CachedResponse>>(new Map())
  readonly #nextCheck = new Map<string, number>()
  readonly #pending = new Map<string, { signal?: AbortSignal; promise: Promise<unknown> }>()
  readonly #listeners = new Set<(path: string) => void>()

  constructor(private readonly namespace: string) {}

  subscribe(listener: (path: string) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #publish(path: string, entry: CachedResponse): void {
    const previous = this.responses.value.get(path)
    if (previous != null && previous.etag == entry.etag && (previous.data === entry.data || JSON.stringify(previous.data) == JSON.stringify(entry.data))) return
    this.responses.set(new Map(this.responses.value).set(path, entry))
    for (const listener of this.#listeners) listener(path)
  }

  async get<Value>(
    path: string,
    policy: RequestCachePolicy,
    signal: AbortSignal | undefined,
    decode: (value: unknown) => Value,
    request: (headers: Headers) => Promise<Response>,
    fresh = false,
  ): Promise<Value> {
    signal?.throwIfAborted()
    const storageKey = `${this.namespace}:${path}`
    let cached = this.responses.value.get(path)
    if (cached == null) {
      try {
        const raw = policy.storage?.().getItem(storageKey)
        if (raw != null) {
          const stored = JSON.parse(raw) as StoredResponse
          if (stored != null && (stored.etag === null || typeof stored.etag == 'string')) {
            cached = { ...stored, value: decode(stored.data) }
            this.#publish(path, cached)
          }
        }
      } catch {
        // Invalid or unavailable storage is a cache miss.
      }
    }
    const refresh = (): Promise<Value> => {
      // The request runs in a microtask so even synchronous failures use the same cleanup.
      const promise = Promise.resolve()
        .then(async () => {
          const headers = new Headers()
          if (cached?.etag) headers.set('if-none-match', cached.etag)
          const response = await request(headers)
          signal?.throwIfAborted()
          let entry: CachedResponse
          if (response.status == 304) {
            if (cached == null) return invalidResponse()
            entry = { ...cached, etag: response.headers.get('etag')?.trim() || cached.etag }
          } else {
            if (!response.ok) return invalidResponse()
            const data: unknown = await response.json()
            entry = { data, etag: response.headers.get('etag')?.trim() || null, value: decode(data) }
          }
          signal?.throwIfAborted()
          if (this.#pending.get(path)?.promise == promise) {
            try {
              policy.storage?.().setItem(storageKey, JSON.stringify({ data: entry.data, etag: entry.etag }))
            } catch {
              // Storage is optional.
            }
            this.#nextCheck.set(path, Date.now() + policy.maxAgeMs)
            this.#publish(path, entry)
          }
          return entry.value as Value
        })
        .catch((error: unknown) => {
          if (this.#pending.get(path)?.promise == promise && !signal?.aborted) this.#nextCheck.set(path, Date.now() + 30_000)
          throw error
        })
        .finally(() => {
          if (this.#pending.get(path)?.promise == promise) this.#pending.delete(path)
        })
      this.#pending.set(path, { signal, promise })
      return promise
    }
    const pending = this.#pending.get(path)
    if (!fresh && cached != null) {
      if (Date.now() >= (this.#nextCheck.get(path) ?? 0) && (pending == null || pending.signal?.aborted)) {
        void refresh().catch(() => {})
      }
      return cached.value as Value
    }
    // Share cold reads only when cancellation has the same owner.
    if (!fresh && pending != null && pending.signal === signal && !signal?.aborted) return pending.promise as Promise<Value>
    return refresh()
  }
}

export function cachedResponse<Value>(
  responses: ReadonlyMap<string, CachedResponse>,
  query: { readonly path: string; readonly decode: (data: unknown) => Value },
): Value | undefined {
  return responses.get(query.path)?.value as Value | undefined
}
