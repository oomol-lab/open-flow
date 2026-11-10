import type { CacheDelegate } from '../../base/common/cache.ts'

export type { CacheDelegate } from '../../base/common/cache.ts'

export type ProviderIconRequest =
  | { readonly kind: 'sprite'; readonly theme: 'light' | 'dark'; readonly url: string; readonly version: string }
  | { readonly kind: 'image'; readonly providerId: string; readonly url: string }

export interface ProviderIconCacheOptions {
  /** Non-secret identity of the artwork source or deployment. */
  readonly scope: string
  /** Defaults to instance-local memory. Records contain base64 image bytes. */
  readonly delegate?: CacheDelegate
  readonly mode?: 'default' | 'refresh' | 'offline'
  readonly fetch?: typeof fetch
}

export interface ProviderIconReadOptions {
  /** Restricts this read even if another caller is loading the same resource online. */
  readonly allowNetwork?: boolean
}

/** The browser renderer can consume the same interface over a Node bridge. */
export interface ProviderIconLoader {
  get(request: ProviderIconRequest, options?: ProviderIconReadOptions): Promise<string>
}

interface CachedIcon {
  readonly formatVersion: 1
  readonly sourceUrl: string
  readonly spriteVersion: string | null
  readonly contentType: string
  readonly body: string
  readonly etag: string | null
  readonly validatedAt: number
  /** Null means immutable artwork identified by a sprite version. */
  readonly maxAgeMs: number | null
}

const defaultMaxAgeMs = 24 * 60 * 60 * 1000
const dataUrl = (entry: CachedIcon) => `data:${entry.contentType};base64,${entry.body}`

function decodeRecord(value: unknown): CachedIcon | undefined {
  if (value == null || typeof value !== 'object') return
  const v = value as CachedIcon
  if (
    v.formatVersion !== 1 ||
    typeof v.sourceUrl !== 'string' ||
    !(v.spriteVersion === null || typeof v.spriteVersion === 'string') ||
    typeof v.contentType !== 'string' ||
    !/^image\/[\w.+-]+$/i.test(v.contentType) ||
    typeof v.body !== 'string' ||
    !v.body ||
    v.body.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(v.body) ||
    !(v.etag === null || typeof v.etag === 'string') ||
    !Number.isFinite(v.validatedAt) ||
    v.validatedAt < 0 ||
    !(v.maxAgeMs === null || (Number.isFinite(v.maxAgeMs) && v.maxAgeMs >= 0))
  )
    return
  return v
}

function encodeBytes(bytes: Uint8Array): string {
  let text = ''
  for (let index = 0; index < bytes.length; index += 8192) text += String.fromCharCode(...bytes.subarray(index, index + 8192))
  return btoa(text)
}

function freshness(response: Response, immutable: boolean, previous?: CachedIcon): number | null {
  const control = response.headers.get('cache-control') ?? ''
  if (/\bno-cache\b/i.test(control)) return 0
  if (immutable) return null
  const maxAge = /(?:^|,)\s*max-age\s*=\s*"?(\d+)/i.exec(control)
  if (maxAge) return Math.max(0, Number(maxAge[1]) * 1000 - (Number(response.headers.get('age')) || 0) * 1000)
  const expires = Date.parse(response.headers.get('expires') ?? '')
  if (Number.isFinite(expires)) return Math.max(0, expires - Date.parse(response.headers.get('date') ?? new Date().toUTCString()))
  return previous?.maxAgeMs ?? defaultMaxAgeMs
}

/** Complete image responses in bounded, identity-checked slots; no catalog entities live here. */
export class ProviderIconCache implements ProviderIconLoader {
  readonly #memory = new Map<string, CachedIcon | undefined>()
  readonly #pending = new Map<string, Promise<string>>()
  readonly #targets = new Map<string, string>()
  readonly #writes = new Map<string, Promise<void>>()

  constructor(private readonly options: ProviderIconCacheOptions) {
    if (!options.scope.trim()) throw new TypeError('Provider icon cache scope must be nonempty.')
  }

  get(request: ProviderIconRequest, options: ProviderIconReadOptions = {}): Promise<string> {
    if (request.url.startsWith('data:image/')) return Promise.resolve(request.url)
    if (!['http:', 'https:'].includes(new URL(request.url).protocol)) return Promise.reject(new TypeError('Unsupported Provider icon URL.'))
    const slot = JSON.stringify([
      'open-flow:provider-icons',
      1,
      this.options.scope,
      request.kind,
      request.kind === 'sprite' ? request.theme : request.providerId,
    ])
    const version = request.kind === 'sprite' ? request.version : null
    const identity = JSON.stringify([request.url, version])
    const offline = options.allowNetwork === false || this.options.mode === 'offline'
    const key = JSON.stringify([slot, identity, offline])
    const pending = this.#pending.get(key)
    if (pending) return pending
    if (!offline) this.#targets.set(slot, identity)
    const promise = this.#load(slot, identity, request.url, version, offline).finally(() => this.#pending.delete(key))
    this.#pending.set(key, promise)
    return promise
  }

  async #read(slot: string, url: string, version: string | null): Promise<CachedIcon | undefined> {
    const memory = this.#memory.get(slot)
    if (this.#memory.has(slot) && (!memory || (memory.sourceUrl === url && memory.spriteVersion === version))) return memory
    if (!this.options.delegate) return this.#memory.get(slot)
    try {
      const stored = await this.options.delegate.get(slot)
      if (stored === undefined) return this.#memory.get(slot)
      const entry = decodeRecord(stored)
      if (entry) {
        this.#memory.set(slot, entry)
        return entry
      }
      this.#memory.delete(slot)
      await this.options.delegate.delete(slot)
    } catch {
      return this.#memory.get(slot)
    }
  }

  async #store(slot: string, identity: string, entry: CachedIcon | undefined): Promise<void> {
    const operation = (this.#writes.get(slot) ?? Promise.resolve()).then(async () => {
      if (this.#targets.get(slot) !== identity) return
      this.#memory.set(slot, entry)
      if (!this.options.delegate) return
      try {
        if (entry) await this.options.delegate.set(slot, { ...entry })
        else await this.options.delegate.delete(slot)
      } catch {
        // Successful image loads survive unavailable or full persistent storage.
      }
    })
    this.#writes.set(slot, operation)
    try {
      await operation
    } finally {
      if (this.#writes.get(slot) === operation) this.#writes.delete(slot)
    }
  }

  async #load(slot: string, identity: string, url: string, version: string | null, offline: boolean): Promise<string> {
    const stored = await this.#read(slot, url, version)
    const cached = stored?.sourceUrl === url && stored.spriteVersion === version ? stored : undefined
    const age = cached == null ? Infinity : Date.now() - cached.validatedAt
    if (cached && (offline || (this.options.mode !== 'refresh' && age >= 0 && (cached.maxAgeMs === null || age < cached.maxAgeMs)))) return dataUrl(cached)
    if (offline) throw new Error(`Provider icon is not cached: ${url}`)
    const response = await (this.options.fetch ?? globalThis.fetch)(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(15_000),
      headers: cached?.etag ? { 'if-none-match': cached.etag } : {},
    })
    if (response.status !== 304 && !response.ok) throw new Error(`Could not load Provider icon: ${response.status}`)
    if (response.status === 304 && !cached) throw new Error('Provider icon returned 304 without a cached image.')
    const contentType = response.status === 304 ? cached!.contentType : response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
    if (!contentType || !/^image\/[\w.+-]+$/i.test(contentType)) throw new Error('Provider icon response is not an image.')
    const body = response.status === 304 ? cached!.body : encodeBytes(new Uint8Array(await response.arrayBuffer()))
    if (!body) throw new Error('Provider icon response is empty.')
    const entry: CachedIcon = {
      formatVersion: 1,
      sourceUrl: url,
      spriteVersion: version,
      contentType,
      body,
      etag: response.headers.get('etag') ?? (response.status === 304 ? cached!.etag : null),
      validatedAt: Date.now(),
      maxAgeMs: freshness(response, version !== null, response.status === 304 ? cached : undefined),
    }
    await this.#store(slot, identity, /\bno-store\b/i.test(response.headers.get('cache-control') ?? '') ? undefined : entry)
    return dataUrl(entry)
  }
}
