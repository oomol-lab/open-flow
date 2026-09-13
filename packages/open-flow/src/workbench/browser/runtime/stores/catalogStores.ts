import type { ReadonlyVal } from 'value-enhancer'
import type { ConnectorActionMetadata, ConnectorConnection, ConnectorProvider } from '../../../../control/common/api.ts'
import type { WorkbenchClient } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'
import type { ResourceState } from './resource.ts'

import { compute } from 'value-enhancer'
import { connectorActionMetadata, connectorProvider, connection } from '../../../../control/common/connectorDecoders.ts'
import { connectorProvidersQuery, allConnectorConnectionsQuery, connectorConnectionsQuery } from '../../../../control/common/connectorQueries.ts'
import { invalidResponse, record } from '../../../../control/common/decoding.ts'
import { Resource } from './resource.ts'

function list<T>(value: unknown, decode: (value: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) return invalidResponse()
  return value.map(decode)
}
function actionsResponse(value: unknown): readonly ConnectorActionMetadata[] {
  const source = record(value)
  if (source.version != 1) return invalidResponse()
  return list(source.actions, connectorActionMetadata)
}
const identity = (...parts: (string | undefined)[]) => JSON.stringify(parts)

export class ProviderStore {
  readonly #entries = new Map<string, Resource<readonly ConnectorProvider[]>>()
  constructor(
    private readonly client: WorkbenchClient,
    private readonly options?: WorkbenchHost['connectorCache'],
  ) {}
  get(flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<readonly ConnectorProvider[]>> {
    const key = identity(flowId, locale)
    let entry = this.#entries.get(key)
    if (entry == null) {
      const query = connectorProvidersQuery(flowId, locale)
      entry = new Resource(
        (etag, signal) => this.client.readCatalog(query, etag, signal),
        300_000,
        this.options == null
          ? undefined
          : {
              key: `open-flow:providers:v2:${encodeURIComponent(this.options.namespace)}:${key}`,
              storage: () => this.options!.localStorage ?? window.localStorage,
              decode: (value) => list(value, connectorProvider),
            },
      )
      this.#entries.set(key, entry)
    }
    return entry.get(force)
  }
  retryFailed(): void {
    for (const entry of this.#entries.values()) if (entry.state.value.error != null) void entry.refresh()
  }
  dispose(): void {
    for (const entry of this.#entries.values()) entry.dispose()
    this.#entries.clear()
  }
}

export class ConnectionStore {
  readonly #entries = new Map<string, Resource<readonly ConnectorConnection[]>>()
  constructor(
    private readonly client: WorkbenchClient,
    private readonly options?: WorkbenchHost['connectorCache'],
  ) {}
  get(serviceId: string | undefined, flowId?: string, force = false): ReadonlyVal<ResourceState<readonly ConnectorConnection[]>> {
    const key = identity(flowId, serviceId)
    let entry = this.#entries.get(key)
    if (entry == null) {
      const query = serviceId == null ? allConnectorConnectionsQuery(flowId) : connectorConnectionsQuery(serviceId, flowId)
      entry = new Resource(
        (etag, signal) => this.client.readCatalog(query, etag, signal),
        30_000,
        this.options == null
          ? undefined
          : {
              key: `open-flow:connections:v2:${encodeURIComponent(this.options.namespace)}:${key}`,
              storage: () => this.options!.sessionStorage ?? window.sessionStorage,
              decode: (value) => {
                const connections = list(value, connection)
                if (serviceId != null && connections.some((item) => item.serviceId != serviceId)) return invalidResponse()
                return connections
              },
            },
      )
      this.#entries.set(key, entry)
    }
    return entry.get(force)
  }
  retryFailed(): void {
    for (const entry of this.#entries.values()) if (entry.state.value.error != null) void entry.refresh()
  }
  dispose(): void {
    for (const entry of this.#entries.values()) entry.dispose()
    this.#entries.clear()
  }
}

export class ActionStore {
  readonly #searches = new Set<Resource<readonly ConnectorActionMetadata[]>>()
  readonly #entries = new Map<string, Resource<readonly ConnectorActionMetadata[]>>()
  readonly #details = new Map<string, ReadonlyVal<ResourceState<ConnectorActionMetadata>>>()
  constructor(
    private readonly client: WorkbenchClient,
    private readonly options?: WorkbenchHost['connectorCache'],
  ) {}
  get(serviceId: string, flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<readonly ConnectorActionMetadata[]>> {
    const key = identity(flowId, serviceId, locale)
    let entry = this.#entries.get(key)
    if (entry == null) {
      const decode = (value: unknown) => {
        const actions = list(value, connectorActionMetadata)
        if (actions.some((action) => action.serviceId != serviceId)) return invalidResponse()
        return actions
      }
      const params = new URLSearchParams({ ...(flowId == null ? {} : { flowId }), service: serviceId, locale })
      const query = { path: `/v1/connector/action-metadata?${params}`, decode: (value: unknown) => decode(actionsResponse(value)) }
      entry = new Resource(
        (etag, signal) => this.client.readCatalog(query, etag, signal),
        30_000,
        this.options == null
          ? undefined
          : {
              key: `open-flow:actions:v3:${encodeURIComponent(this.options.namespace)}:${key}`,
              storage: () => this.options!.localStorage ?? window.localStorage,
              decode,
            },
      )
      this.#entries.set(key, entry)
    }
    return entry.get(force)
  }
  detail(actionId: string, flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<ConnectorActionMetadata>> {
    const service = actionId.slice(0, actionId.indexOf('.'))
    const source = this.get(service, flowId, locale, force)
    const key = identity(flowId, actionId, locale)
    let detail = this.#details.get(key)
    if (detail == null) {
      detail = compute((get) => {
        const state = get(source)
        const data = state.data?.find((action) => action.actionId == actionId)
        return { ...state, data, error: state.error ?? (state.data != null && data == null ? new Error(`Action ${actionId} was not found.`) : undefined) }
      })
      this.#details.set(key, detail)
    }
    return detail
  }
  search(query: string, flowId: string | undefined, locale: string, signal: AbortSignal): Resource<readonly ConnectorActionMetadata[]> {
    const params = new URLSearchParams({ ...(flowId == null ? {} : { flowId }), q: query.trim(), locale })
    const resource = new Resource(
      (etag, requestSignal) => this.client.readCatalog({ path: `/v1/connector/action-metadata?${params}`, decode: actionsResponse }, etag, requestSignal),
      30_000,
    )
    this.#searches.add(resource)
    signal.addEventListener(
      'abort',
      () => {
        resource.dispose()
        this.#searches.delete(resource)
      },
      { once: true },
    )
    if (signal.aborted) {
      resource.dispose()
      this.#searches.delete(resource)
    }
    return resource
  }
  retryFailed(): void {
    for (const entry of this.#entries.values()) if (entry.state.value.error != null) void entry.refresh()
  }
  dispose(): void {
    for (const search of this.#searches) search.dispose()
    this.#searches.clear()
    for (const detail of this.#details.values()) detail.dispose()
    for (const entry of this.#entries.values()) entry.dispose()
    this.#details.clear()
    this.#entries.clear()
  }
}

export class CatalogStores {
  readonly providers: ProviderStore
  readonly actions: ActionStore
  readonly connections: ConnectionStore
  constructor(client: WorkbenchClient, options?: WorkbenchHost['connectorCache']) {
    this.providers = new ProviderStore(client, options)
    this.actions = new ActionStore(client, options)
    this.connections = new ConnectionStore(client, options)
  }
  dispose(): void {
    this.providers.dispose()
    this.actions.dispose()
    this.connections.dispose()
  }
}
