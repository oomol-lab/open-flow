import type { ProviderIconSource, ProviderIconRequest, ProviderIconStorage } from '../../../connector/common/providerIconCache.ts'

import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { useVal } from 'use-value-enhancer'
import { val } from 'value-enhancer'
import { ProviderIconCache } from '../../../connector/common/providerIconCache.ts'

export const ProviderIconCacheContext = createContext<ProviderIconSource | undefined>(undefined)

/** IndexedDB stores the complete image Blob without text encoding. */
export function indexedDbIconDelegate(): ProviderIconStorage {
  let database: Promise<IDBDatabase> | undefined
  function open() {
    database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('open-flow-provider-icons', 1)
      request.addEventListener('upgradeneeded', () => request.result.createObjectStore('icons'), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('Provider icon cache is blocked.')), { once: true })
      request.addEventListener(
        'success',
        () => {
          const db = request.result
          db.addEventListener(
            'versionchange',
            () => {
              db.close()
              database = undefined
            },
            { once: true },
          )
          resolve(db)
        },
        { once: true },
      )
    }).catch((error: unknown) => {
      database = undefined
      throw error
    })
    return database
  }
  async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('icons', mode)
      const request = operation(tx.objectStore('icons'))
      tx.addEventListener('complete', () => resolve(request.result), { once: true })
      tx.addEventListener('abort', () => reject(tx.error ?? request.error), { once: true })
      tx.addEventListener('error', () => reject(tx.error ?? request.error), { once: true })
    })
  }
  return {
    get: (key) => transaction('readonly', (store) => store.get(key)),
    set: async (key, value) => {
      await transaction('readwrite', (store) => store.put(value, key))
    },
    delete: async (key) => {
      await transaction('readwrite', (store) => store.delete(key))
    },
  }
}

let browserCache: ProviderIconCache | undefined
export function defaultBrowserIconCache(): ProviderIconCache {
  return (browserCache ??= new ProviderIconCache({ scope: 'browser', storage: indexedDbIconDelegate() }))
}

export function useProviderIconCache(): ProviderIconSource {
  return useContext(ProviderIconCacheContext) ?? defaultBrowserIconCache()
}

type ReadyIcon = { readonly status: 'loaded'; readonly blob: Blob; readonly image: HTMLImageElement; readonly refreshing?: boolean }
type ResourceState = { readonly status: 'loading' } | { readonly status: 'failed' } | ReadyIcon
type IconState =
  | Exclude<ResourceState, ReadyIcon>
  | { readonly status: 'loaded'; readonly url: string; readonly image: HTMLImageElement; readonly refreshing?: boolean }
const loading: ResourceState = { status: 'loading' }

function createIconResource(cache: ProviderIconSource, request: ProviderIconRequest, ready?: ReadyIcon) {
  const state = val<ResourceState>(ready ?? loading)
  const urls = new Map<Blob, string>()
  const consumers = new Map<Blob, number>()
  let subscribers = 0
  let pending: Promise<void> | undefined
  let pendingBlob: Blob | undefined
  function releaseUrls() {
    const current = subscribers && state.value.status === 'loaded' ? state.value.blob : undefined
    for (const [blob, url] of urls) {
      if (consumers.has(blob) || blob === current || blob === pendingBlob) continue
      URL.revokeObjectURL(url)
      urls.delete(blob)
    }
  }
  const resource = {
    state,
    url(blob: Blob) {
      let url = urls.get(blob)
      if (!url) urls.set(blob, (url = URL.createObjectURL(blob)))
      return url
    },
    subscribe(blob?: Blob) {
      subscribers++
      if (blob) consumers.set(blob, (consumers.get(blob) ?? 0) + 1)
      return () => {
        subscribers--
        if (blob) {
          const remaining = consumers.get(blob)! - 1
          if (remaining) consumers.set(blob, remaining)
          else consumers.delete(blob)
        }
        queueMicrotask(releaseUrls)
      }
    },
    refresh() {
      if (pending) return pending
      const previous = state.value.status === 'loaded' ? state.value : undefined
      if (previous) state.set({ ...previous, refreshing: true })
      else if (state.value.status === 'failed') state.set(loading)
      pending = (async () => {
        let image: HTMLImageElement | undefined
        try {
          const blob = 'getBlob' in cache ? await cache.getBlob(request) : await (await fetch(await cache.get(request))).blob()
          if (previous?.blob === blob) {
            state.set({ ...previous, refreshing: false })
            return
          }
          pendingBlob = blob
          image = new Image()
          image.src = resource.url(blob)
          await image.decode()
          state.set({ status: 'loaded', blob, image })
        } catch {
          if (image) image.src = ''
          state.set(previous ? { ...previous, refreshing: false } : { status: 'failed' })
        }
      })().finally(() => {
        pending = undefined
        pendingBlob = undefined
        releaseUrls()
      })
      return pending
    },
  }
  return resource
}

type IconResource = ReturnType<typeof createIconResource>
// Only current logical slots are retained. Replaced resources live as long as their subscribers.
const resources = new WeakMap<ProviderIconSource, Map<string, { identity: string; resource: IconResource }>>()

/** Components read ready state synchronously; only the shared owner fetches and decodes. */
export function useProviderIconResource(request: ProviderIconRequest, crop?: { readonly x: number; readonly y: number; readonly size: number }): IconState {
  const cache = useProviderIconCache()
  const slot = JSON.stringify([request.kind, request.kind === 'sprite' ? request.theme : request.providerId])
  const identity = JSON.stringify([slot, request.url, request.kind === 'sprite' ? request.version : null])
  const previous = useRef<{ identity: string; resource: IconResource }>()
  const resource = useMemo(() => {
    let slots = resources.get(cache)
    if (!slots) {
      slots = new Map()
      resources.set(cache, slots)
    }
    let current = slots.get(slot)
    if (current?.identity !== identity) {
      const value = previous.current?.identity === identity ? previous.current.resource.state.value : undefined
      current = { identity, resource: createIconResource(cache, request, value?.status === 'loaded' ? value : undefined) }
      slots.set(slot, current)
    }
    previous.current = current
    return current.resource
  }, [cache, identity])
  const state = useVal(resource.state)
  const blob = state.status === 'loaded' ? state.blob : undefined
  // Retain committed artwork until each consumer has rendered its replacement.
  useEffect(() => resource.subscribe(blob), [resource, blob])
  useEffect(() => {
    void resource.refresh()
  }, [resource])

  // Crops are capture-local; the shared decoded sheet is reused by all of its icons.
  return useMemo(() => {
    if (state.status !== 'loaded') return state
    if (!crop) return { status: 'loaded', url: resource.url(state.blob), image: state.image, refreshing: state.refreshing }
    const canvas = document.createElement('canvas')
    try {
      canvas.width = canvas.height = crop.size
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not crop the Provider icon.')
      context.drawImage(state.image, crop.x, crop.y, crop.size, crop.size, 0, 0, crop.size, crop.size)
      return { status: 'loaded', url: canvas.toDataURL('image/png'), image: state.image, refreshing: state.refreshing }
    } catch {
      return { status: 'failed' }
    } finally {
      canvas.width = canvas.height = 0
    }
  }, [state, resource, crop?.x, crop?.y, crop?.size])
}
