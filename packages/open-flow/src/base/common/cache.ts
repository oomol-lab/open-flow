import type { JsonValue } from '../../types/index.ts'

/** Storage is host-owned. Keys and JSON records are opaque to the delegate. */
export interface CacheDelegate {
  get(key: string): Promise<unknown>
  set(key: string, value: JsonValue): Promise<void>
  delete(key: string): Promise<void>
}
