import type { WorkbenchHost, WorkbenchPreferences } from './contract.ts'

import { invalidResponse } from '../../../control/common/decoding.ts'

type Kind = 'providers' | 'actions' | 'connections'
interface Entry {
  readonly data: unknown
  readonly etag: string | null
}

/** Persist representations, but always validate with the server before exposing account-dependent data. */
export class ConnectorCache {
  constructor(private readonly options: WorkbenchHost['connectorCache']) {}

  #storage(kind: Kind): WorkbenchPreferences | undefined {
    if (this.options == null) return
    return kind == 'providers' ? (this.options.localStorage ?? window.localStorage) : (this.options.sessionStorage ?? window.sessionStorage)
  }

  async get<Value>(
    path: string,
    kind: Kind,
    signal: AbortSignal | undefined,
    decode: (value: unknown) => Value,
    request: (headers: Headers) => Promise<Response>,
  ): Promise<Value> {
    signal?.throwIfAborted()
    const key = `open-flow:connector:v1:${encodeURIComponent(this.options?.namespace ?? '')}:${path}`
    let cached: Entry | undefined
    try {
      const raw = this.#storage(kind)?.getItem(key)
      if (raw != null) {
        const entry = JSON.parse(raw) as Entry
        if (entry != null && (entry.etag === null || typeof entry.etag == 'string')) {
          decode(entry.data)
          cached = entry
        }
      }
    } catch {
      // Invalid or unavailable storage is a cache miss.
    }
    const headers = new Headers()
    if (cached?.etag) headers.set('if-none-match', cached.etag)
    const response = await request(headers)
    signal?.throwIfAborted()
    if (response.status == 304) {
      if (cached == null) return invalidResponse()
      return decode(cached.data)
    }
    let data: unknown
    try {
      data = await response.json()
    } catch {
      return invalidResponse()
    }
    const value = decode(data)
    signal?.throwIfAborted()
    try {
      this.#storage(kind)?.setItem(key, JSON.stringify({ data, etag: response.headers.get('etag')?.trim() || null }))
    } catch {
      // Storage is optional; quota and privacy settings must not break requests.
    }
    return value
  }
}
