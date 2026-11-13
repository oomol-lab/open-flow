import type { CacheDelegate } from '../../base/common/cache.ts'

export type { CacheDelegate } from '../../base/common/cache.ts'

export type ProviderIconRequest =
  | { readonly kind: 'sprite'; readonly theme: 'light' | 'dark'; readonly url: string; readonly version: string }
  | { readonly kind: 'image'; readonly providerId: string; readonly url: string }

export interface ProviderIconCacheOptions {
  /** Non-secret identity of the artwork source or deployment. */
  readonly scope: string
  /** JSON storage retained for existing hosts. */
  readonly delegate?: CacheDelegate
  /** Native binary storage, such as IndexedDB. Defaults to instance-local memory. */
  readonly storage?: ProviderIconStorage
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

export interface ProviderIconBlobLoader {
  getBlob(request: ProviderIconRequest, options?: ProviderIconReadOptions): Promise<Blob>
}

export type ProviderIconSource = ProviderIconLoader | ProviderIconBlobLoader

/** Artwork records are opaque and contain a Blob; storage must support structured cloning. */
export interface ProviderIconStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: ProviderIconRecord): Promise<void>
  delete(key: string): Promise<void>
}

export interface ProviderIconRecord {
  readonly formatVersion: 2
  readonly sourceUrl: string
  readonly spriteVersion: string | null
  readonly contentType: string
  readonly body: Blob
  readonly etag: string | null
  readonly validatedAt: number
  /** Null means immutable artwork identified by a sprite version. */
  readonly maxAgeMs: number | null
}

type CachedIcon = ProviderIconRecord

const defaultMaxAgeMs = 24 * 60 * 60 * 1000

async function decodeRecord(value: unknown): Promise<CachedIcon | undefined> {
  if (value == null || typeof value !== 'object') return
  const v = value as Omit<CachedIcon, 'formatVersion' | 'body'> & { formatVersion: unknown; body: unknown }
  if (
    ![1, 2].includes(v.formatVersion as number) ||
    typeof v.sourceUrl !== 'string' ||
    !(v.spriteVersion === null || typeof v.spriteVersion === 'string') ||
    typeof v.contentType !== 'string' ||
    !/^image\/[\w.+-]+$/i.test(v.contentType) ||
    !(v.etag === null || typeof v.etag === 'string') ||
    !Number.isFinite(v.validatedAt) ||
    v.validatedAt < 0 ||
    !(v.maxAgeMs === null || (Number.isFinite(v.maxAgeMs) && v.maxAgeMs >= 0))
  )
    return
  let body: Blob
  if (v.formatVersion === 2 && v.body instanceof Blob) body = v.body
  else if (v.formatVersion === 2 && Array.isArray(v.body) && v.body.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255))
    body = new Blob([new Uint8Array(v.body)], { type: v.contentType })
  else if (v.formatVersion === 1 && typeof v.body === 'string' && v.body.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(v.body))
    body = await (await fetch(`data:${v.contentType};base64,${v.body}`)).blob()
  else return
  if (!body.size) return
  return { ...v, formatVersion: 2, body }
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
export class ProviderIconCache implements ProviderIconLoader, ProviderIconBlobLoader {
  readonly #memory = new Map<string, CachedIcon | undefined>()
  readonly #pending = new Map<string, Promise<Blob>>()
  readonly #targets = new Map<string, string>()
  readonly #writes = new Map<string, Promise<void>>()

  constructor(private readonly options: ProviderIconCacheOptions) {
    if (!options.scope.trim()) throw new TypeError('Provider icon cache scope must be nonempty.')
    if (options.delegate && options.storage) throw new TypeError('Choose one Provider icon storage delegate.')
  }

  /** Legacy data-URL reads. Browser rendering and exports use getBlob instead. */
  async get(request: ProviderIconRequest, options: ProviderIconReadOptions = {}): Promise<string> {
    if (request.url.startsWith('data:image/')) return request.url
    const blob = await this.getBlob(request, options)
    return `data:${blob.type};base64,${encodeBytes(new Uint8Array(await blob.arrayBuffer()))}`
  }

  getBlob(request: ProviderIconRequest, options: ProviderIconReadOptions = {}): Promise<Blob> {
    if (request.url.startsWith('data:image/')) return fetch(request.url).then((response) => response.blob())
    let protocol: string
    try {
      protocol = new URL(request.url).protocol
    } catch (error) {
      return Promise.reject(error)
    }
    if (!['http:', 'https:'].includes(protocol)) return Promise.reject(new TypeError('Unsupported Provider icon URL.'))
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
    const storage = this.options.storage ?? this.options.delegate
    if (!storage) return this.#memory.get(slot)
    try {
      const stored = await storage.get(slot)
      if (stored === undefined) return this.#memory.get(slot)
      const entry = await decodeRecord(stored)
      if (entry) {
        this.#memory.set(slot, entry)
        return entry
      }
      this.#memory.delete(slot)
      await storage.delete(slot)
    } catch {
      return this.#memory.get(slot)
    }
  }

  async #store(slot: string, identity: string, entry: CachedIcon | undefined): Promise<void> {
    const operation = (this.#writes.get(slot) ?? Promise.resolve()).then(async () => {
      if (this.#targets.get(slot) !== identity) return
      this.#memory.set(slot, entry)
      try {
        if (this.options.storage) {
          if (entry) await this.options.storage.set(slot, { ...entry })
          else await this.options.storage.delete(slot)
        } else if (this.options.delegate) {
          if (entry) await this.options.delegate.set(slot, { ...entry, body: Array.from(new Uint8Array(await entry.body.arrayBuffer())) })
          else await this.options.delegate.delete(slot)
        }
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

  async #load(slot: string, identity: string, url: string, version: string | null, offline: boolean): Promise<Blob> {
    const stored = await this.#read(slot, url, version)
    const cached = stored?.sourceUrl === url && stored.spriteVersion === version ? stored : undefined
    const age = cached == null ? Infinity : Date.now() - cached.validatedAt
    if (cached && (offline || (this.options.mode !== 'refresh' && age >= 0 && (cached.maxAgeMs === null || age < cached.maxAgeMs)))) return cached.body
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
    const body = response.status === 304 ? cached!.body : await response.blob()
    if (!body.size) throw new Error('Provider icon response is empty.')
    const entry: CachedIcon = {
      formatVersion: 2,
      sourceUrl: url,
      spriteVersion: version,
      contentType,
      body,
      etag: response.headers.get('etag') ?? (response.status === 304 ? cached!.etag : null),
      validatedAt: Date.now(),
      maxAgeMs: freshness(response, version !== null, response.status === 304 ? cached : undefined),
    }
    await this.#store(slot, identity, /\bno-store\b/i.test(response.headers.get('cache-control') ?? '') ? undefined : entry)
    return entry.body
  }
}
