import type { CacheDelegate } from '../../../base/common/cache.ts'
import type { ProviderIconLoader, ProviderIconRequest } from '../../../connector/common/providerIconCache.ts'

import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { useVal } from 'use-value-enhancer'
import { val } from 'value-enhancer'
import { ProviderIconCache } from '../../../connector/common/providerIconCache.ts'

export const ProviderIconCacheContext = createContext<ProviderIconLoader | undefined>(undefined)

/** IDB holds the same opaque JSON records as a host's disk delegate. */
export function indexedDbIconDelegate(): CacheDelegate {
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
  return (browserCache ??= new ProviderIconCache({ scope: 'browser', delegate: indexedDbIconDelegate() }))
}

export function useProviderIconCache(): ProviderIconLoader {
  return useContext(ProviderIconCacheContext) ?? defaultBrowserIconCache()
}

type ReadyIcon = { readonly status: 'loaded'; readonly url: string; readonly image: HTMLImageElement; readonly refreshing?: boolean }
type IconState = { readonly status: 'loading' } | { readonly status: 'failed' } | ReadyIcon
const loading: IconState = { status: 'loading' }

function createIconResource(cache: ProviderIconLoader, request: ProviderIconRequest, ready?: ReadyIcon) {
  const state = val<IconState>(ready ?? loading)
  let pending: Promise<void> | undefined
  return {
    state,
    refresh() {
      if (pending) return pending
      const previous = state.value.status === 'loaded' ? state.value : undefined
      if (previous) state.set({ ...previous, refreshing: true })
      else if (state.value.status === 'failed') state.set(loading)
      pending = (async () => {
        let image: HTMLImageElement | undefined
        try {
          const url = await cache.get(request)
          if (previous?.url === url) {
            state.set({ ...previous, refreshing: false })
            return
          }
          image = new Image()
          image.src = url
          await image.decode()
          state.set({ status: 'loaded', url, image })
        } catch {
          if (image) image.src = ''
          state.set(previous ? { ...previous, refreshing: false } : { status: 'failed' })
        }
      })().finally(() => {
        pending = undefined
      })
      return pending
    },
  }
}

type IconResource = ReturnType<typeof createIconResource>
// Only current logical slots are retained. Replaced resources live as long as their subscribers.
const resources = new WeakMap<ProviderIconLoader, Map<string, { identity: string; resource: IconResource }>>()

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
  useEffect(() => {
    void resource.refresh()
  }, [resource])

  // Crops are capture-local; the shared decoded sheet is reused by all of its icons.
  return useMemo(() => {
    if (state.status !== 'loaded' || !crop) return state
    const canvas = document.createElement('canvas')
    try {
      canvas.width = canvas.height = crop.size
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not crop the Provider icon.')
      context.drawImage(state.image, crop.x, crop.y, crop.size, crop.size, 0, 0, crop.size, crop.size)
      return { ...state, url: canvas.toDataURL('image/png') }
    } catch {
      return { status: 'failed' }
    } finally {
      canvas.width = canvas.height = 0
    }
  }, [state, crop?.x, crop?.y, crop?.size])
}
