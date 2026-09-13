import type { ConnectorAction, ConnectorConnection, ConnectorProvider } from '../../../control/common/api.ts'
import type { WorkbenchHost, WorkbenchPreferences } from './contract.ts'

import { val } from 'value-enhancer'
import { connection, connectorAction, connectorProvider } from '../../../control/common/connectorDecoders.ts'
import { record, invalidResponse } from '../../../control/common/decoding.ts'

type Kind = 'providers' | 'actions' | 'connections'
interface Entry {
  readonly data: unknown
  readonly etag: string | null
}

/** Reactive cached representations with background revalidation and explicit fresh reads. */
export class ConnectorCache {
  readonly providers = val<ReadonlyMap<string, Entry>>(new Map())
  readonly actions = val<ReadonlyMap<string, Entry>>(new Map())
  readonly connections = val<ReadonlyMap<string, Entry>>(new Map())
  readonly #nextCheck = new Map<string, number>()
  readonly #pending = new Map<string, { readonly signal?: AbortSignal }>()
  readonly #requests = new Map<string, symbol>()

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
    fresh = false,
  ): Promise<Value> {
    signal?.throwIfAborted()
    const key = path
    const storageKey = `open-flow:connector:v1:${encodeURIComponent(this.options?.namespace ?? '')}:${path}`
    const memory = this[kind]
    let cached = memory.value.get(key)
    try {
      const raw = this.#storage(kind)?.getItem(storageKey)
      if (cached == null && raw != null) {
        const entry = JSON.parse(raw) as Entry
        if (entry != null && (entry.etag === null || typeof entry.etag == 'string')) {
          decode(entry.data)
          cached = entry
        }
      }
    } catch {
      // Invalid or unavailable storage is a cache miss.
    }
    const refresh = async (): Promise<Value> => {
      const requestId = Symbol()
      this.#requests.set(key, requestId)
      const headers = new Headers()
      if (cached?.etag) headers.set('if-none-match', cached.etag)
      const response = await request(headers)
      signal?.throwIfAborted()
      let entry: Entry
      if (response.status == 304) {
        if (cached == null) return invalidResponse()
        entry = cached
      } else {
        let data: unknown
        try {
          data = await response.json()
        } catch {
          return invalidResponse()
        }
        entry = { data, etag: response.headers.get('etag')?.trim() || null }
      }
      const value = decode(entry.data)
      signal?.throwIfAborted()
      // Supersession only controls cache writes; this caller still received a valid response.
      if (this.#requests.get(key) != requestId) return value
      try {
        this.#storage(kind)?.setItem(storageKey, JSON.stringify(entry))
      } catch {
        // Storage is optional; quota and privacy settings must not break requests.
      }
      this.#nextCheck.set(key, Date.now() + (kind == 'providers' ? 5 * 60_000 : 30_000))
      if (JSON.stringify(memory.value.get(key)) != JSON.stringify(entry) || (kind == 'connections' && [...memory.value.keys()].at(-1) != key)) {
        const updated = new Map(memory.value)
        updated.delete(key)
        memory.set(updated.set(key, entry))
      }
      return value
    }
    if (!fresh && cached != null) {
      if (!memory.value.has(key)) memory.set(new Map(memory.value).set(key, cached))
      if (Date.now() >= (this.#nextCheck.get(key) ?? 0) && (!this.#pending.has(key) || this.#pending.get(key)?.signal?.aborted)) {
        const pending = { signal }
        this.#pending.set(key, pending)
        void refresh()
          .catch(() => {
            if (!signal?.aborted) this.#nextCheck.set(key, Date.now() + 30_000)
          })
          .finally(() => {
            if (this.#pending.get(key) == pending) this.#pending.delete(key)
          })
      }
      return decode(cached.data)
    }
    return refresh()
  }
}

/** Project only the active Flow and language; entries are ordered by their latest update. */
export function cachedConnectorActions(
  entries: ReadonlyMap<string, Entry>,
  flowId: string | undefined,
  locale: string,
): Readonly<Record<string, ConnectorAction>> {
  const actions: Record<string, ConnectorAction> = {}
  if (flowId == null) return actions
  for (const [path, entry] of entries) {
    const query = new URL(path, 'https://cache.invalid').searchParams
    if (query.get('flowId') != flowId || query.get('locale') != locale) continue
    const source = record(entry.data)
    const values = Array.isArray(source.actions) ? source.actions : [source.action]
    for (const value of values) {
      const action = connectorAction(value)
      actions[action.actionId] = action
    }
  }
  return actions
}

export function cachedConnectorConnections(
  entries: ReadonlyMap<string, Entry>,
  flowId: string | undefined,
): Readonly<Record<string, readonly ConnectorConnection[]>> {
  const connections: Record<string, readonly ConnectorConnection[]> = {}
  if (flowId == null) return connections
  for (const [path, entry] of entries) {
    if (new URL(path, 'https://cache.invalid').searchParams.get('flowId') != flowId) continue
    const source = record(entry.data)
    if (!Array.isArray(source.connections)) continue
    if (typeof source.serviceId == 'string') connections[source.serviceId] = source.connections.map(connection)
    else {
      // A full snapshot replaces the scope; newer service snapshots override only their service.
      for (const serviceId of Object.keys(connections)) connections[serviceId] = []
      for (const value of source.connections) {
        const item = connection(value)
        connections[item.serviceId] = [...(connections[item.serviceId] ?? []), item]
      }
    }
  }
  return connections
}

export function cachedConnectorProviders(entries: ReadonlyMap<string, Entry>, flowId: string | undefined): Readonly<Record<string, ConnectorProvider>> {
  const providers: Record<string, ConnectorProvider> = {}
  if (flowId == null) return providers
  for (const [path, entry] of entries) {
    if (new URL(path, 'https://cache.invalid').searchParams.get('flowId') != flowId) continue
    const source = record(entry.data)
    if (!Array.isArray(source.providers)) continue
    for (const value of source.providers) {
      const provider = connectorProvider(value)
      providers[provider.serviceId] = provider
    }
  }
  return providers
}
