import type { ResourceCache, LoadResult } from '@oomol-lab/resource-cache'
import type { ActionsResponse, ConnectionsResponse, ProvidersResponse } from '@oomol-lab/resource-cache/oomol'
import type { ReadonlyVal } from 'value-enhancer'
import type { ConnectorActionMetadata, ConnectorConnection, ConnectorProvider } from '../../../../control/common/api.ts'
import type { WorkbenchClient } from '../api.ts'
import type { ProxyResponse } from './proxyCatalog.ts'
import type { ResourceState } from './resource.ts'

import { createSessionCache } from '@oomol-lab/resource-cache'
import { getActionsCache, getConnectionsCache, getProvidersCache } from '@oomol-lab/resource-cache/oomol'
import { compute, derive } from 'value-enhancer'
import { connection, connectorActionMetadata } from '../../../../control/common/connectorDecoders.ts'
import { allConnectorConnectionsQuery } from '../../../../control/common/connectorQueries.ts'
import { invalidResponse, record } from '../../../../control/common/decoding.ts'
import { ApiError } from '../api.ts'
import { action, provider, proxyResponse, validateAction } from './proxyCatalog.ts'
import { CacheResource } from './resource.ts'

const catalogMaxAge = { providers: 300_000, actions: 30_000, connections: 30_000 } as const
const identity = (...parts: (string | undefined)[]) => JSON.stringify(parts)

type CacheScope = Readonly<{
  readonly sessionId: string
  readonly environment?: string
  readonly connectorOwnerId?: string
}>

type AnyCache = ResourceCache<unknown, unknown>

function mapCache<T, U, Q, R>(cache: ResourceCache<T, R>, toValue: (value: T) => U, toSnapshot: (value: T) => U, query: (value: Q) => R): ResourceCache<U, Q> {
  return {
    get: async (value, options) => toValue(await cache.get(query(value), options)),
    peek: async (value) => {
      const snapshot = await cache.peek(query(value))
      return snapshot == null ? undefined : { ...snapshot, data: toSnapshot(snapshot.data) }
    },
    invalidate: (value) => cache.invalidate(query(value)),
    remove: (value) => cache.remove(query(value)),
    clear: () => cache.clear(),
    dispose: () => cache.dispose(),
  }
}

function providerCacheValue(value: unknown): ProvidersResponse {
  return proxyResponse(value) as unknown as ProvidersResponse
}
function actionCacheValue(value: unknown): ActionsResponse {
  return proxyResponse(value) as unknown as ActionsResponse
}
function connectionsCacheValue(value: unknown): ConnectionsResponse {
  const source = record(value)
  if (source.success === true && Array.isArray(source.data)) return source as unknown as ConnectionsResponse
  if (source.version == 1 && Array.isArray(source.connections)) {
    return {
      success: true,
      message: '',
      data: source.connections,
      meta: {
        summary: {
          providerCount: 0,
          connectableProviderCount: 0,
          connectedProviderCount: 0,
          activeConnectedProviderCount: 0,
          connectedAppCount: source.connections.length,
          activeConnectedAppCount: source.connections.length,
          filteredAppCount: source.connections.length,
        },
      },
    } as ConnectionsResponse
  }
  return invalidResponse()
}
function connectionsAsProxy(value: ConnectionsResponse): readonly ConnectorConnection[] {
  return value.data.map(connection)
}

/** Shared cache construction for one Workbench session. */
class CacheFactory {
  // OOMOL cache factories return process-shared singletons. Only caches created
  // for this Workbench session belong in this set and may be disposed here.
  readonly #caches = new Set<AnyCache>()
  readonly #entries = new Map<string, Promise<AnyCache>>()
  #disposed = false
  constructor(private readonly scope: CacheScope) {}

  cache<T, Q>(key: string, create: () => Promise<ResourceCache<T, Q>>, owned = true): Promise<ResourceCache<T, Q>> {
    let entry = this.#entries.get(key)
    if (entry == null) {
      entry = create().then((cache) => {
        if (owned) {
          if (this.#disposed) void cache.dispose()
          else this.#caches.add(cache as AnyCache)
        }
        return cache as AnyCache
      })
      this.#entries.set(key, entry)
    }
    return entry as Promise<ResourceCache<T, Q>>
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    await Promise.all([...this.#caches].map((cache) => cache.dispose()))
    this.#caches.clear()
    this.#entries.clear()
  }

  get environment(): string {
    return this.scope.environment ?? 'production'
  }
  get sessionId(): string {
    return this.scope.sessionId
  }
  get connectorOwnerId(): string | undefined {
    return this.scope.connectorOwnerId
  }
}

/** Each entry owns one complete upstream response; views are derived below. */
class ProxyStore {
  readonly entries = new Map<string, CacheResource<ProxyResponse, void>>()
  readonly #factory: CacheFactory
  constructor(
    private readonly client: WorkbenchClient,
    private readonly kind: 'providers' | 'actions',
    scope: CacheScope,
  ) {
    this.#factory = new CacheFactory(scope)
  }

  get(flowId?: string, locale = 'en', service?: string, force = false): ReadonlyVal<ResourceState<ProxyResponse>> {
    const params = new URLSearchParams({ ...(flowId == null ? {} : { flowId }), ...(service == null ? {} : { service }), locale })
    const path = `/v1/connector/proxy/${this.kind}?${params}`
    let entry = this.entries.get(path)
    if (entry == null) {
      entry = new CacheResource(() => this.#cache(flowId, locale, service, path), undefined, false, catalogMaxAge[this.kind])
      this.entries.set(path, entry)
    }
    return entry.get(force)
  }

  async #cache(flowId: string | undefined, locale: string, service: string | undefined, path: string): Promise<ResourceCache<ProxyResponse, void>> {
    const ownerId = this.#factory.connectorOwnerId
    const key = JSON.stringify([this.kind, flowId ?? null, locale, service ?? null, ownerId ?? null])
    return this.#factory.cache(
      key,
      async () => {
        if (ownerId != null) {
          if (this.kind == 'providers') {
            const cache = getProvidersCache({
              environment: this.#factory.environment,
              locale,
              schemaVersion: 1,
              maxAge: catalogMaxAge.providers,
              decode: providerCacheValue,
              load: async (_query, validation) => {
                const result = await this.client.readProxyCatalog({ path, decode: providerCacheValue }, validation.etag, validation.signal)
                return result as LoadResult<ProvidersResponse>
              },
            })
            return mapCache(
              cache,
              (value) => value as unknown as ProxyResponse,
              (value) => value as unknown as ProxyResponse,
              () => undefined,
            )
          }
          const cache = getActionsCache({
            environment: this.#factory.environment,
            locale,
            schemaVersion: 1,
            maxAge: catalogMaxAge.actions,
            decode: actionCacheValue,
            load: async ({ service: requestedService }, validation) => {
              if (requestedService != service) throw new Error('Action cache service mismatch.')
              const result = await this.client.readProxyCatalog({ path, decode: actionCacheValue }, validation.etag, validation.signal)
              return result as LoadResult<ActionsResponse>
            },
          })
          return mapCache(
            cache,
            (value) => value as unknown as ProxyResponse,
            (value) => value as unknown as ProxyResponse,
            () => service ?? '',
          )
        }
        const cache = createSessionCache<ProxyResponse, void>({
          namespace: JSON.stringify(['open-flow:connector-proxy', this.#factory.environment, this.kind, flowId ?? null]),
          schemaVersion: 1,
          sessionId: this.#factory.sessionId,
          maxAge: this.kind == 'providers' ? catalogMaxAge.providers : catalogMaxAge.actions,
          key: () => JSON.stringify([locale, service ?? null]),
          decode: proxyResponse,
          load: async (_query, validation) => this.client.readProxyCatalog({ path, decode: proxyResponse }, validation.etag, validation.signal),
        })
        return cache
      },
      ownerId == null,
    )
  }

  retryFailed(): void {
    for (const entry of this.entries.values()) if (entry.state.value.error != null) void entry.refresh(true)
  }
  refreshFlow(flowId: string): void {
    for (const [path, entry] of this.entries) if (new URL(path, 'https://open-flow.invalid').searchParams.get('flowId') == flowId) void entry.refresh(true)
  }
  dispose(): void {
    for (const entry of this.entries.values()) entry.dispose()
    this.entries.clear()
    void this.#factory.dispose()
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
  constructor(client: WorkbenchClient, scope: CacheScope) {
    this.raw = new ProxyStore(client, 'providers', scope)
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
  readonly #entries = new Map<string | undefined, CacheResource<readonly ConnectorConnection[], void>>()
  readonly #views = new Map<string, ReadonlyVal<ResourceState<readonly ConnectorConnection[]>>>()
  readonly #factory: CacheFactory
  constructor(
    private readonly client: WorkbenchClient,
    scope: CacheScope,
  ) {
    this.#factory = new CacheFactory(scope)
  }
  get(serviceId: string | undefined, flowId?: string, force = false): ReadonlyVal<ResourceState<readonly ConnectorConnection[]>> {
    let entry = this.#entries.get(flowId)
    if (entry == null) {
      entry = new CacheResource(() => this.#cache(flowId), undefined, false, catalogMaxAge.connections)
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
  async #cache(flowId?: string): Promise<ResourceCache<readonly ConnectorConnection[], void>> {
    const query = allConnectorConnectionsQuery(flowId)
    const ownerId = this.#factory.connectorOwnerId
    const key = JSON.stringify(['connections', flowId ?? null, ownerId ?? null])
    return this.#factory.cache(
      key,
      async () => {
        if (ownerId != null) {
          const cache = getConnectionsCache({
            environment: this.#factory.environment,
            sessionId: this.#factory.sessionId,
            ownerId,
            schemaVersion: 1,
            maxAge: catalogMaxAge.connections,
            decode: connectionsCacheValue,
            load: async (_query, validation) => {
              const result = await this.client.readCatalog(query, validation.etag, validation.signal)
              return result.modified ? { modified: true, data: connectionsCacheValue({ version: 1, connections: result.data }), etag: result.etag } : result
            },
          })
          return mapCache(cache, connectionsAsProxy, connectionsAsProxy, () => undefined)
        }
        return createSessionCache<readonly ConnectorConnection[], void>({
          namespace: JSON.stringify(['open-flow:connections', this.#factory.environment, flowId ?? null]),
          schemaVersion: 1,
          sessionId: this.#factory.sessionId,
          maxAge: catalogMaxAge.connections,
          key: () => 'all',
          decode: (value) => {
            if (!Array.isArray(value)) return invalidResponse()
            return value.map(connection)
          },
          load: async (_query, validation) => this.client.readCatalog(query, validation.etag, validation.signal),
        })
      },
      ownerId == null,
    )
  }
  retryFailed(): void {
    for (const entry of this.#entries.values()) if (entry.state.value.error != null) void entry.refresh(true)
  }
  refreshFlow(flowId: string): void {
    void this.#entries.get(flowId)?.refresh(true)
  }
  dispose(): void {
    for (const view of this.#views.values()) view.dispose()
    this.#views.clear()
    for (const entry of this.#entries.values()) entry.dispose()
    this.#entries.clear()
    void this.#factory.dispose()
  }
}

export class ActionStore {
  readonly #raw: ProxyStore
  readonly #views = new Views<readonly ConnectorActionMetadata[]>()
  readonly #details = new Map<string, ReadonlyVal<ResourceState<ConnectorActionMetadata>>>()
  readonly #searches = new Set<CacheResource<readonly ConnectorActionMetadata[], void>>()
  readonly #searchSessions = new WeakMap<AbortSignal, Map<string, CacheResource<readonly ConnectorActionMetadata[], void>>>()
  constructor(
    private readonly client: WorkbenchClient,
    private readonly providers: ProviderStore,
    scope: CacheScope,
  ) {
    this.#raw = new ProxyStore(client, 'actions', scope)
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
        return { data, refreshing: state.refreshing, error: state.error ?? (state.data != null && data == null && !state.refreshing ? missing : undefined) }
      })
      this.#details.set(key, detail)
    }
    return detail
  }
  search(query: string, flowId: string | undefined, locale: string, signal: AbortSignal): CacheResource<readonly ConnectorActionMetadata[], void> {
    const params = new URLSearchParams({ ...(flowId == null ? {} : { flowId }), q: query.trim(), locale })
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
    const key = params.toString()
    const cached = entries.get(key)
    if (cached != null) {
      void cached.refresh(true)
      return cached
    }
    const cache = createSessionCache<readonly ConnectorActionMetadata[], void>({
      namespace: JSON.stringify(['open-flow:action-search', crypto.randomUUID()]),
      schemaVersion: 1,
      sessionId: 'search',
      maxAge: 0,
      key: () => 'result',
      decode: (value) => {
        if (!Array.isArray(value)) return invalidResponse()
        return value.map(connectorActionMetadata)
      },
      load: async (_query, validation) =>
        this.client.readCatalog(
          {
            path: `/v1/connector/action-metadata?${params}`,
            decode: (value) => {
              const source = record(value)
              if (source.version != 1 || !Array.isArray(source.actions)) return invalidResponse()
              return source.actions.map(connectorActionMetadata)
            },
          },
          validation.etag,
          validation.signal,
        ),
    })
    // The explicit resolver keeps search cache lifetime local to this AbortSignal.
    const result = new CacheResource(async () => cache, undefined, true, 0)
    if (signal.aborted) result.dispose()
    else {
      entries.set(key, result)
      this.#searches.add(result)
    }
    return result
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
  constructor(client: WorkbenchClient, scope: CacheScope = { sessionId: crypto.randomUUID() }) {
    this.providers = new ProviderStore(client, scope)
    this.actions = new ActionStore(client, this.providers, scope)
    this.connections = new ConnectionStore(client, scope)
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
