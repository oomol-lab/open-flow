import type { CatalogCacheStorage, WorkbenchHost } from '../contract.ts'

import { createStore, get, set } from 'idb-keyval'

const responses = createStore('open-flow-cache', 'responses')
const indexedStorage: CatalogCacheStorage = {
  get: (key) => get(key, responses),
  set: (key, value) => set(key, value, responses),
}

export function catalogPersistence(options: WorkbenchHost['catalogCache'], kind: 'providers' | 'actions' | 'triggers', query: string) {
  if (options == null) return undefined
  const storage = options.storage ?? indexedStorage
  return { key: `${kind}:v1:${query}`, storage }
}
