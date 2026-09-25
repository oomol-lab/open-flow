import type { CatalogCacheStorage } from '../contract.ts'

/** A failed cache is a miss. A stuck backend is disabled for this page lifetime. */
export function optionalStorage(storage: CatalogCacheStorage): CatalogCacheStorage {
  const existing = wrappers.get(storage)
  if (existing != null) return existing
  let disabled = false
  const writes = new Map<string, Promise<void>>()
  async function attempt<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (disabled) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            disabled = true
            resolve(undefined)
          }, 1_000)
        }),
      ])
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }
  const wrapped: CatalogCacheStorage = {
    get: (key) => attempt(() => storage.get(key)),
    set: (key, value) => {
      const pending = (writes.get(key) ?? Promise.resolve())
        .then(() => attempt(() => storage.set(key, value)))
        .then(() => {})
        .finally(() => {
          if (writes.get(key) === pending) writes.delete(key)
        })
      writes.set(key, pending)
      return pending
    },
  }
  wrappers.set(storage, wrapped)
  return wrapped
}
const wrappers = new WeakMap<CatalogCacheStorage, CatalogCacheStorage>()
