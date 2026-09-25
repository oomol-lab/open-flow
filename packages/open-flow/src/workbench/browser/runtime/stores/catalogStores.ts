import type { ReadonlyVal } from 'value-enhancer'
import type { ConnectorActionMetadata, ConnectorConnection, ConnectorProvider } from '../../../../control/common/api.ts'
import type { WorkbenchClient } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'
import type { ProxyResponse } from './proxyCatalog.ts'
import type { ResourceState } from './resource.ts'

import { compute, derive } from 'value-enhancer'
import { connection, connectorActionMetadata } from '../../../../control/common/connectorDecoders.ts'
import { allConnectorConnectionsQuery } from '../../../../control/common/connectorQueries.ts'
import { invalidResponse, record } from '../../../../control/common/decoding.ts'
import { ApiError } from '../api.ts'
import { catalogPersistence } from './catalogStorage.ts'
import { action, provider, proxyResponse, validateAction } from './proxyCatalog.ts'
import { Resource } from './resource.ts'

function actionsResponse(value: unknown): readonly ConnectorActionMetadata[] {
  const source = record(value)
  if (source.version != 1 || !Array.isArray(source.actions)) return invalidResponse()
  return source.actions.map(connectorActionMetadata)
}
const identity = (...parts: (string | undefined)[]) => JSON.stringify(parts)

/** Each entry owns one complete upstream response, never a merged entity catalog. */
class ProxyStore {
  readonly entries = new Map<string, Resource<ProxyResponse>>()
  constructor(
    private readonly client: WorkbenchClient,
    private readonly kind: 'providers' | 'actions',
    private readonly options?: WorkbenchHost['catalogCache'],
  ) {}
  get(flowId?: string, locale?: string, service?: string, force = false): ReadonlyVal<ResourceState<ProxyResponse>> {
    const params = new URLSearchParams({
      ...(flowId == null ? {} : { flowId }),
      ...(service == null ? {} : { service }),
      ...(locale == null ? {} : { locale }),
    })
    const path = `/v1/connector/proxy/${this.kind}${params.size ? `?${params}` : ''}`
    let entry = this.entries.get(path)
    if (entry == null) {
      const decode = (value: unknown) => proxyResponse(value, this.kind == 'providers' ? provider : undefined)
      const cacheParams = new URLSearchParams(params)
      cacheParams.delete('flowId')
      const persistence = catalogPersistence(this.options, this.kind, cacheParams.toString())
      entry = new Resource(
        (etag, signal) => this.client.readProxyCatalog({ path, decode }, etag, signal),
        this.kind == 'providers' ? 300_000 : 30_000,
        persistence == null ? undefined : { ...persistence, decode },
      )
      this.entries.set(path, entry)
    }
    return entry.get(force)
  }
  retryFailed(): void {
    for (const entry of this.entries.values()) if (entry.state.value.error != null) void entry.refresh()
  }
  refreshFlow(flowId: string): void {
    for (const [path, entry] of this.entries) {
      if (new URL(path, 'https://open-flow.invalid').searchParams.get('flowId') == flowId) void entry.refresh(true)
    }
  }
  dispose(): void {
    for (const entry of this.entries.values()) entry.dispose()
    this.entries.clear()
  }
}

class Views<T> {
  readonly entries = new Map<string, ReadonlyVal<ResourceState<T>>>()
  get(key: string, sources: readonly ReadonlyVal<ResourceState<ProxyResponse>>[], project: (...data: ProxyResponse[]) => T): ReadonlyVal<ResourceState<T>> {
    let view = this.entries.get(key)
    if (view == null) {
      let previous: readonly ProxyResponse[] | undefined
      let projected: T | undefined
      view = compute((get) => {
        const states = sources.map((source) => get(source))
        const base = { refreshing: states.some((state) => state.refreshing), error: states.find((state) => state.error != null)?.error }
        try {
          if (!states.every((state) => state.data != null)) return { ...base, data: undefined }
          const responses = states.map((state) => state.data!)
          if (previous == null || responses.some((response, index) => response !== previous![index])) {
            projected = project(...responses)
            previous = responses
          }
          return { ...base, data: projected }
        } catch (error) {
          return { ...base, data: undefined, error }
        }
      })
      this.entries.set(key, view)
    }
    return view
  }
  dispose(): void {
    for (const entry of this.entries.values()) entry.dispose()
    this.entries.clear()
  }
}

export class ProviderStore {
  readonly raw: ProxyStore
  readonly #views = new Views<readonly ConnectorProvider[]>()
  constructor(client: WorkbenchClient, options?: WorkbenchHost['catalogCache']) {
    this.raw = new ProxyStore(client, 'providers', options)
  }
  get(flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<readonly ConnectorProvider[]>> {
    return this.#views.get(identity(flowId, locale), [this.raw.get(flowId, locale, undefined, force)], (response) =>
      response.data.map((item) => provider(item, (response.meta as { iconSprite?: unknown } | undefined)?.iconSprite)),
    )
  }
  retryFailed(): void {
    this.raw.retryFailed()
  }
  refreshFlow(flowId: string): void {
    this.raw.refreshFlow(flowId)
  }
  dispose(): void {
    this.#views.dispose()
    this.raw.dispose()
  }
}

export class ConnectionStore {
  readonly #storage = {
    get: async (key: string): Promise<unknown> => {
      const raw = (this.options?.storage ?? window.sessionStorage).getItem(key)
      return raw == null ? undefined : JSON.parse(raw)
    },
    set: async (key: string, value: unknown): Promise<void> => {
      const storage = this.options?.storage ?? window.sessionStorage
      storage.setItem(key, JSON.stringify(value))
    },
  }
  readonly #entries = new Map<string | undefined, Resource<readonly ConnectorConnection[]>>()
  readonly #views = new Map<string, ReadonlyVal<ResourceState<readonly ConnectorConnection[]>>>()
  constructor(
    private readonly client: WorkbenchClient,
    private readonly options?: WorkbenchHost['connectionCache'],
  ) {}
  get(serviceId: string | undefined, flowId?: string, force = false): ReadonlyVal<ResourceState<readonly ConnectorConnection[]>> {
    let entry = this.#entries.get(flowId)
    if (entry == null) {
      const query = allConnectorConnectionsQuery(flowId)
      entry = new Resource(
        (etag, signal) => this.client.readCatalog(query, etag, signal),
        30_000,
        this.options == null
          ? undefined
          : {
              key: `open-flow:connections:v1:${query.path}`,
              storage: this.#storage,
              decode: (value) => {
                if (!Array.isArray(value)) return invalidResponse()
                return value.map(connection)
              },
            },
      )
      this.#entries.set(flowId, entry)
    }
    const source = entry.get(force)
    if (serviceId == null) return source
    const key = identity(flowId, serviceId)
    let view = this.#views.get(key)
    if (view == null) {
      view = derive(source, (state) => ({ ...state, data: state.data?.filter((item) => item.serviceId == serviceId) }))
      this.#views.set(key, view)
    }
    return view
  }
  retryFailed(): void {
    for (const entry of this.#entries.values()) if (entry.state.value.error != null) void entry.refresh()
  }
  refreshFlow(flowId: string): void {
    void this.#entries.get(flowId)?.refresh(true)
  }
  dispose(): void {
    for (const view of this.#views.values()) view.dispose()
    this.#views.clear()
    for (const entry of this.#entries.values()) entry.dispose()
    this.#entries.clear()
  }
}

export class ActionStore {
  readonly #raw: ProxyStore
  readonly #views = new Views<readonly ConnectorActionMetadata[]>()
  readonly #details = new Map<string, ReadonlyVal<ResourceState<ConnectorActionMetadata>>>()
  readonly #searches = new Set<Resource<readonly ConnectorActionMetadata[]>>()
  readonly #searchSessions = new WeakMap<AbortSignal, Map<string, Resource<readonly ConnectorActionMetadata[]>>>()
  constructor(
    private readonly client: WorkbenchClient,
    private readonly providers: ProviderStore,
    options?: WorkbenchHost['catalogCache'],
  ) {
    this.#raw = new ProxyStore(client, 'actions', options)
  }
  get(serviceId: string, flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<readonly ConnectorActionMetadata[]>> {
    return this.#views.get(
      identity(flowId, serviceId, locale),
      [this.#raw.get(flowId, locale, serviceId, force), this.providers.raw.get(flowId, locale)],
      (actions, providers) =>
        actions.data.flatMap((item) => {
          try {
            const source = record(item)
            validateAction(source)
            if (source.service != serviceId) return invalidResponse()
            return [action(source, providers)]
          } catch (error) {
            console.warn('Could not load Connector Action.', { serviceId, actionId: item?.id, error })
            return []
          }
        }),
    )
  }
  detail(actionId: string, flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<ConnectorActionMetadata>> {
    const serviceId = actionId.split('.')[0]!
    const source = this.get(serviceId, flowId, locale, force)
    const key = identity(flowId, actionId, locale)
    let detail = this.#details.get(key)
    if (detail == null) {
      const missing = new ApiError(404, 'connector.action-not-found', `Connector Action "${actionId}" was not found.`)
      detail = derive(source, (state) => {
        const data = state.data?.find((candidate) => candidate.actionId == actionId)
        return {
          data,
          refreshing: state.refreshing,
          error: state.error ?? (state.data != null && data == null && !state.refreshing ? missing : undefined),
        }
      })
      this.#details.set(key, detail)
    }
    return detail
  }

  search(query: string, flowId: string | undefined, locale: string, signal: AbortSignal): Resource<readonly ConnectorActionMetadata[]> {
    const params = new URLSearchParams({ ...(flowId == null ? {} : { flowId }), q: query.trim(), locale })
    const key = params.toString()
    let entries = this.#searchSessions.get(signal)
    if (entries == null) {
      entries = new Map()
      this.#searchSessions.set(signal, entries)
      const session = entries
      signal.addEventListener(
        'abort',
        () => {
          for (const resource of session.values()) {
            resource.dispose()
            this.#searches.delete(resource)
          }
          session.clear()
          this.#searchSessions.delete(signal)
        },
        { once: true },
      )
    }
    const cached = entries.get(key)
    if (cached != null) {
      // Keep the complete response visible while revalidating this exact search.
      void cached.refresh()
      return cached
    }
    const resource = new Resource(
      (_etag, requestSignal) => this.client.readCatalog({ path: `/v1/connector/action-metadata?${params}`, decode: actionsResponse }, null, requestSignal),
      30_000,
    )
    if (signal.aborted) resource.dispose()
    else {
      entries.set(key, resource)
      this.#searches.add(resource)
    }
    return resource
  }
  retryFailed(): void {
    this.#raw.retryFailed()
  }
  refreshFlow(flowId: string): void {
    this.#raw.refreshFlow(flowId)
  }
  dispose(): void {
    for (const search of this.#searches) search.dispose()
    this.#searches.clear()
    for (const detail of this.#details.values()) detail.dispose()
    this.#details.clear()
    this.#views.dispose()
    this.#raw.dispose()
  }
}

export class CatalogStores {
  readonly providers: ProviderStore
  readonly actions: ActionStore
  readonly connections: ConnectionStore
  constructor(client: WorkbenchClient, options?: WorkbenchHost['catalogCache'], connections?: WorkbenchHost['connectionCache']) {
    this.providers = new ProviderStore(client, options)
    this.actions = new ActionStore(client, this.providers, options)
    this.connections = new ConnectionStore(client, connections)
  }
  dispose(): void {
    this.actions.dispose()
    this.connections.dispose()
    this.providers.dispose()
  }
  refreshFlow(flowId: string): void {
    this.actions.refreshFlow(flowId)
    this.connections.refreshFlow(flowId)
    this.providers.refreshFlow(flowId)
  }
}
