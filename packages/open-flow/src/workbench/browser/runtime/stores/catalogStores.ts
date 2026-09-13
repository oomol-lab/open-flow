import type { ReadonlyVal } from 'value-enhancer'
import type { ConnectorActionMetadata, ConnectorConnection, ConnectorProvider } from '../../../../control/common/api.ts'
import type { WorkbenchClient } from '../api.ts'
import type { WorkbenchHost } from '../contract.ts'
import type { ProxyResponse } from './proxyCatalog.ts'
import type { ResourceState } from './resource.ts'

import { compute } from 'value-enhancer'
import { connectorActionMetadata } from '../../../../control/common/connectorDecoders.ts'
import { invalidResponse, record } from '../../../../control/common/decoding.ts'
import { action, app, provider, proxyResponse, validateAction } from './proxyCatalog.ts'
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
    private readonly kind: 'providers' | 'actions' | 'apps',
    private readonly options?: WorkbenchHost['connectorCache'],
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
      const decode = (value: unknown) =>
        proxyResponse(
          value,
          this.kind == 'providers'
            ? provider
            : this.kind == 'apps'
              ? app
              : (item) => {
                  validateAction(item)
                  if (item.service != service) return invalidResponse()
                },
        )
      entry = new Resource(
        (etag, signal) => this.client.readProxyCatalog({ path, decode }, etag, signal),
        this.kind == 'providers' ? 300_000 : 30_000,
        this.options == null
          ? undefined
          : {
              key: `open-flow:proxy:${this.kind}:v1:${encodeURIComponent(this.options.namespace)}:${path}`,
              storage: () =>
                this.kind == 'apps' ? (this.options!.sessionStorage ?? window.sessionStorage) : (this.options!.localStorage ?? window.localStorage),
              decode,
            },
      )
      this.entries.set(path, entry)
    }
    return entry.get(force)
  }
  retryFailed(): void {
    for (const entry of this.entries.values()) if (entry.state.value.error != null) void entry.refresh()
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
  constructor(client: WorkbenchClient, options?: WorkbenchHost['connectorCache']) {
    this.raw = new ProxyStore(client, 'providers', options)
  }
  get(flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<readonly ConnectorProvider[]>> {
    return this.#views.get(identity(flowId, locale), [this.raw.get(flowId, locale, undefined, force)], (response) => response.data.map(provider))
  }
  retryFailed(): void {
    this.raw.retryFailed()
  }
  dispose(): void {
    this.#views.dispose()
    this.raw.dispose()
  }
}

export class ConnectionStore {
  readonly #raw: ProxyStore
  readonly #views = new Views<readonly ConnectorConnection[]>()
  constructor(client: WorkbenchClient, options?: WorkbenchHost['connectorCache']) {
    this.#raw = new ProxyStore(client, 'apps', options)
  }
  get(serviceId: string | undefined, flowId?: string, force = false): ReadonlyVal<ResourceState<readonly ConnectorConnection[]>> {
    return this.#views.get(identity(flowId, serviceId), [this.#raw.get(flowId, undefined, undefined, force)], (response) =>
      response.data.filter((item) => serviceId == null || item.service == serviceId).map(app),
    )
  }
  retryFailed(): void {
    this.#raw.retryFailed()
  }
  dispose(): void {
    this.#views.dispose()
    this.#raw.dispose()
  }
}

export class ActionStore {
  readonly #raw: ProxyStore
  readonly #views = new Views<readonly ConnectorActionMetadata[]>()
  readonly #details = new Map<string, ReadonlyVal<ResourceState<ConnectorActionMetadata>>>()
  readonly #searches = new Set<Resource<readonly ConnectorActionMetadata[]>>()
  constructor(
    private readonly client: WorkbenchClient,
    private readonly providers: ProviderStore,
    options?: WorkbenchHost['connectorCache'],
  ) {
    this.#raw = new ProxyStore(client, 'actions', options)
  }
  get(serviceId: string, flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<readonly ConnectorActionMetadata[]>> {
    return this.#views.get(
      identity(flowId, serviceId, locale),
      [this.#raw.get(flowId, locale, serviceId, force), this.providers.raw.get(flowId, locale)],
      (actions, providers) => actions.data.map((item) => action(item, providers)),
    )
  }
  detail(actionId: string, flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<ConnectorActionMetadata>> {
    const source = this.get(actionId.slice(0, actionId.indexOf('.')), flowId, locale, force)
    const key = identity(flowId, actionId, locale)
    let detail = this.#details.get(key)
    if (detail == null) {
      detail = compute((get) => {
        const state = get(source)
        const data = state.data?.find((item) => item.actionId == actionId)
        return { ...state, data, error: state.error ?? (state.data != null && data == null ? new Error(`Action ${actionId} was not found.`) : undefined) }
      })
      this.#details.set(key, detail)
    }
    return detail
  }
  search(query: string, flowId: string | undefined, locale: string, signal: AbortSignal): Resource<readonly ConnectorActionMetadata[]> {
    const params = new URLSearchParams({ ...(flowId == null ? {} : { flowId }), q: query.trim(), locale })
    const resource = new Resource(
      (_etag, requestSignal) => this.client.readCatalog({ path: `/v1/connector/action-metadata?${params}`, decode: actionsResponse }, null, requestSignal),
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
    this.#raw.retryFailed()
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
  constructor(client: WorkbenchClient, options?: WorkbenchHost['connectorCache']) {
    this.providers = new ProviderStore(client, options)
    this.actions = new ActionStore(client, this.providers, options)
    this.connections = new ConnectionStore(client, options)
  }
  dispose(): void {
    this.actions.dispose()
    this.connections.dispose()
    this.providers.dispose()
  }
}
