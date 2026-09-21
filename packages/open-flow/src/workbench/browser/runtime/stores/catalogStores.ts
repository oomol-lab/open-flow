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
  constructor(client: WorkbenchClient, options?: WorkbenchHost['connectorCache']) {
    this.raw = new ProxyStore(client, 'providers', options)
  }
  get(flowId?: string, locale = 'en', force = false): ReadonlyVal<ResourceState<readonly ConnectorProvider[]>> {
    return this.#views.get(identity(flowId, locale), [this.raw.get(flowId, locale, undefined, force)], (response) => response.data.map(provider))
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
  refreshFlow(flowId: string): void {
    this.#raw.refreshFlow(flowId)
  }
  dispose(): void {
    this.#views.dispose()
    this.#raw.dispose()
  }
}

export class ActionStore {
  readonly #raw: ProxyStore
  readonly #views = new Views<readonly ConnectorActionMetadata[]>()
  readonly #details = new Map<string, Resource<ConnectorActionMetadata>>()
  readonly #searches = new Set<Resource<readonly ConnectorActionMetadata[]>>()
  readonly #searchSessions = new WeakMap<AbortSignal, Map<string, Resource<readonly ConnectorActionMetadata[]>>>()
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
    const params = new URLSearchParams({ ...(flowId == null ? {} : { flowId }), locale })
    const path = `/v1/connector/action-metadata/${encodeURIComponent(actionId)}?${params}`
    let detail = this.#details.get(path)
    if (detail == null) {
      detail = new Resource(
        (etag, signal) =>
          this.client.readCatalog(
            {
              path,
              decode: (value) => {
                const source = record(value)
                if (source.version != 1) return invalidResponse()
                const metadata = connectorActionMetadata(source.action)
                if (metadata.actionId != actionId) return invalidResponse()
                return metadata
              },
            },
            etag,
            signal,
          ),
        30_000,
      )
      this.#details.set(path, detail)
    }
    return detail.get(force)
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
    for (const detail of this.#details.values()) if (detail.state.value.error != null) void detail.refresh()
  }
  refreshFlow(flowId: string): void {
    this.#raw.refreshFlow(flowId)
    for (const [path, detail] of this.#details) {
      if (new URL(path, 'https://open-flow.invalid').searchParams.get('flowId') == flowId) void detail.refresh(true)
    }
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
  refreshFlow(flowId: string): void {
    this.actions.refreshFlow(flowId)
    this.connections.refreshFlow(flowId)
    this.providers.refreshFlow(flowId)
  }
}
