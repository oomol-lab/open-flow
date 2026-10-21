import type { CreateEventSource, EventSource, UpdateEventSource } from '@oomol-lab/open-flow/control-api'
import type { SourceSubscription as ResourceSubscription } from '@oomol-lab/open-flow/event-source'
import type { IntegrationDefinition, IntegrationReconcileContext, IntegrationReconcileResult } from '@oomol-lab/open-flow/integration-trigger'
import type { ConnectorAccessHost } from '../deployment/connector-access.ts'
import type { ConnectorAccessContext, ConnectorHost } from '../deployment/connector-contract.ts'
import type { StoredEventSource, SourceSubscription } from '../storage/event-source-store.ts'
import type { Store } from '../storage/store.ts'
import type { IntegrationOptions } from './integration-runtime.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { eventSourceDefinition, SourceIdentityError } from '@oomol-lab/open-flow/event-source'
import { IntegrationConnectionError, PermanentIntegrationError, TransientIntegrationError } from '@oomol-lab/open-flow/integration-trigger'
import { z } from 'zod'
import { ConnectorTaskError } from '../deployment/connector-contract.ts'
import { ControlError } from '../error.ts'

export class EventSourceRuntime {
  readonly #store: Store
  readonly #connector: () => ConnectorHost | undefined
  readonly #connectorAccess: ConnectorAccessHost
  readonly #options: () => IntegrationOptions | undefined
  readonly #clock: () => number
  readonly #wake: () => void
  readonly #operations = new Map<string, Promise<void>>()

  constructor(
    store: Store,
    connector: () => ConnectorHost | undefined,
    connectorAccess: ConnectorAccessHost,
    options: () => IntegrationOptions | undefined,
    clock: () => number,
    wake: () => void,
  ) {
    this.#store = store
    this.#connector = connector
    this.#connectorAccess = connectorAccess
    this.#options = options
    this.#clock = clock
    this.#wake = wake
  }

  list(teamId?: string | null): { readonly version: 1; readonly sources: readonly EventSource[] } {
    return { version: 1, sources: this.#store.eventSources.list(this.#options()?.publicOrigin, teamId) }
  }

  async create(input: CreateEventSource, signal: AbortSignal): Promise<EventSource> {
    const connector = this.#connector()
    if (connector == null) throw new ControlError(controlErrorCode.connectorUnconfigured, 'Connector is not configured.')
    const definition = eventSourceDefinition(input.kind ?? 'feishu')
    const provider = definition.provider
    const access = this.#operatorContext(provider, input.teamId ?? undefined)
    const connections = await connector.listConnections(provider, signal, access)
    const connection = connections.find((item) => item.connectionId == input.connectionId && item.status == 'active')
    if (connection == null) {
      throw new ControlError(controlErrorCode.eventSourceInvalid, 'Choose an active Connection in this Connector Team.')
    }
    let configuration
    try {
      configuration = definition.initialize(input, connection.providerAccountId)
      if (definition.verifyIdentity != null) {
        if (connector.trigger == null) throw new ControlError(controlErrorCode.eventSourceInvalid, 'Connector Trigger transport is unavailable.')
        configuration = await definition.verifyIdentity(configuration, (config) =>
          connector.trigger!(provider, input.connectionId, definition.resources.triggerId, { operation: 'sourceIdentity', config }, signal, access),
        )
      }
    } catch (error) {
      if (error instanceof SourceIdentityError) throw new ControlError(controlErrorCode.eventSourceIdentityUnavailable, error.message)
      throw error
    }
    signal.throwIfAborted()
    const source = this.#store.eventSources.create(input, definition.kind, configuration)
    return this.#store.eventSources.view(source, this.#options()?.publicOrigin)
  }

  update(sourceId: string, input: UpdateEventSource): EventSource {
    let source: StoredEventSource
    try {
      source = this.#store.eventSources.update(sourceId, input)
    } catch (error) {
      if (error instanceof SourceIdentityError) throw new ControlError(controlErrorCode.eventSourceInvalid, error.message)
      throw error
    }
    this.#wake()
    return this.#store.eventSources.view(source, this.#options()?.publicOrigin)
  }

  delete(sourceId: string, revision: number): void {
    this.#store.eventSources.delete(sourceId, revision)
  }

  async receiveApplication(kind: string, appId: string, request: Request): Promise<Response> {
    const sources = this.#store.eventSources.applicationSources(kind, appId).filter((source) => source.enabled === 1)
    if (sources.length === 0) return new Response(null, { status: 404 })
    return this.#receive(sources, request)
  }

  async receive(sourceId: string, request: Request): Promise<Response> {
    if (request.method != 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
    const source = this.#store.eventSources.get(sourceId)
    if (source == null || source.enabled != 1) return new Response(null, { status: 404 })
    return this.#receive([source], request)
  }

  async #receive(sources: readonly StoredEventSource[], request: Request): Promise<Response> {
    if (request.method != 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
    const definition = eventSourceDefinition(sources[0]!.kind)
    if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() != 'application/json') return new Response(null, { status: 415 })
    const reader = request.body?.getReader()
    if (reader == null) return new Response(null, { status: 400 })
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.length
        if (size > definition.maximumBodyBytes) {
          await reader.cancel()
          return new Response(null, { status: 413 })
        }
        chunks.push(part.value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    let response: Response | undefined
    for (const source of sources) {
      const result = await this.#deliver(source.sourceId, bytes, request.headers, request.signal)
      if (!result.ok) return result
      response ??= result
    }
    return response!
  }

  async #deliver(sourceId: string, bytes: Uint8Array, headers: Headers, signal: AbortSignal): Promise<Response> {
    const source = this.#store.eventSources.get(sourceId)
    if (source == null || source.enabled != 1) return new Response(null, { status: 404 })
    const definition = eventSourceDefinition(source.kind)
    let received
    try {
      received = await definition.receive(source, bytes, headers, this.#clock(), async (operation) => {
        const connector = this.#connector()
        if (connector?.trigger == null) throw new TransientIntegrationError('Connector Trigger transport is unavailable.')
        return connector.trigger(
          source.provider,
          source.connectionId,
          definition.resources.triggerId,
          operation,
          signal,
          this.#operatorContext(source.provider, source.teamId ?? undefined),
        )
      })
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof ConnectorTaskError || error instanceof TransientIntegrationError) return new Response(null, { status: 503 })
      return new Response(null, { status: 401 })
    }
    signal.throwIfAborted()
    if ('response' in received) {
      if (!this.#store.eventSources.saveState(source, received.state)) return new Response(null, { status: 409 })
      return received.response
    }
    if (received.state != null && !this.#store.eventSources.saveState(source, received.state)) return new Response(null, { status: 409 })
    if (!source.eventTypes.includes(received.event.type)) return Response.json({})
    const result = this.#store.eventSources.receive(source, received.event, this.#clock())
    if (result != 'accepted') return new Response(null, { status: result == 'overloaded' ? 429 : result == 'conflict' ? 409 : 503 })
    this.#wake()
    return Response.json({})
  }

  async reconcile(
    definition: IntegrationDefinition,
    bindingId: string,
    connectionId: string,
    flowId: string,
    access: ConnectorAccessContext,
    context: IntegrationReconcileContext,
  ): Promise<IntegrationReconcileResult> {
    if (!context.active) {
      this.#store.eventSources.release(bindingId)
      return { outcome: 'ready' }
    }
    const source = this.#store.eventSources.get(String(context.config.sourceId))
    if (
      source == null ||
      source.provider != definition.snapshot.provider ||
      source.connectionId != connectionId ||
      source.teamId != (this.#store.connectorTeams.get(flowId) ?? null)
    ) {
      throw new PermanentIntegrationError('The event source does not authorize this Connection and Flow scope.')
    }
    if (source.enabled != 1 || (!eventSourceDefinition(source.kind).resources.managed && !eventSourceDefinition(source.kind).ready(source, this.#clock())))
      throw new PermanentIntegrationError('Verify and enable the event source before publishing.')
    const allowed = source.eventTypes
    if (!(context.config.eventTypes as string[]).every((type) => allowed.includes(type)))
      throw new PermanentIntegrationError('Configure the requested events on the event source first.')
    const connector = this.#connector()
    if (connector == null) throw new TransientIntegrationError('Connector is unavailable.')
    const sourceDefinition = eventSourceDefinition(source.kind)
    try {
      const connections = await connector.listConnections(source.provider, context.signal, access)
      if (
        !connections.some(
          (connection) =>
            connection.connectionId == connectionId &&
            connection.status == 'active' &&
            connection.providerAccountId == (source.config.accountId ?? source.identity),
        )
      )
        throw new IntegrationConnectionError('The source Connection requires reauthorization.')
      if (sourceDefinition.verifyIdentity != null) {
        if (connector.trigger == null) throw new TransientIntegrationError('Trigger operation transport is unavailable.')
        await sourceDefinition.verifyIdentity(source, (config) =>
          connector.trigger!(
            source.provider,
            source.connectionId,
            sourceDefinition.resources.triggerId,
            { operation: 'sourceIdentity', config },
            context.signal ?? AbortSignal.timeout(30_000),
            access,
          ),
        )
      }
    } catch (error) {
      if (sourceDefinition.resources.managed)
        this.#store.eventSources.saveState(source, {
          ...source.state,
          resourceStatus: 'error',
          lastError: 'The source connection or project identity could not be verified. Check authorization and retry publication.',
        })
      throw error
    }
    const subscriptions = eventSourceDefinition(source.kind).resources.requests(
      source,
      source.provider,
      context.config,
      this.#store.eventSources.view(source, this.#options()?.publicOrigin).endpointUrl ?? undefined,
    )
    for (const subscription of subscriptions) {
      if (access.scope == 'catalog') throw new PermanentIntegrationError('Resource subscriptions require a fixed access snapshot.')
      const previous = this.#store.eventSources.subscription(source.sourceId, subscription.key)
      const stored = this.#store.eventSources.demand(
        source.sourceId,
        subscription.key,
        JSON.stringify(subscription),
        bindingId,
        access.providerAccess,
        this.#clock(),
      )
      if (stored.status == 'ready' && !sourceDefinition.resources.managed) continue
      const key = JSON.stringify([source.sourceId, subscription.key])
      const running = this.#operations.get(key)
      if (running != null) {
        await running
        return { outcome: 'pending' }
      }
      if (previous != null && !sourceDefinition.resources.managed)
        throw new PermanentIntegrationError('A previous subscription operation has an uncertain outcome. Verify it before retrying.')
      const operation = this.#change(source, stored, true, context.signal)
      this.#operations.set(key, operation)
      try {
        await operation
      } finally {
        this.#operations.delete(key)
      }
    }
    context.signal?.throwIfAborted()
    await context.state?.saveSubscription({ sourceId: source.sourceId }, new Date(this.#clock() + 60_000))
    return { outcome: 'ready' }
  }

  async cleanup(signal: AbortSignal): Promise<void> {
    for (const subscription of this.#store.eventSources.unusedSubscriptions()) {
      const key = JSON.stringify([subscription.sourceId, subscription.resourceKey])
      if (this.#operations.has(key)) continue
      const source = this.#store.eventSources.get(subscription.sourceId)
      if (source == null || (subscription.status != 'ready' && !eventSourceDefinition(source.kind).resources.managed)) continue
      this.#store.eventSources.subscriptionState(source.sourceId, subscription.resourceKey, 'deleting', this.#clock())
      const operation = this.#change(source, subscription, false, signal)
      this.#operations.set(key, operation)
      try {
        await operation
      } catch {
        signal.throwIfAborted()
      } finally {
        this.#operations.delete(key)
      }
    }
    this.#store.eventSources.prune(this.#clock())
  }

  async #change(source: StoredEventSource, stored: SourceSubscription, active: boolean, signal?: AbortSignal): Promise<void> {
    const subscription = JSON.parse(stored.resourceJson) as ResourceSubscription
    const { triggerId, managed } = eventSourceDefinition(source.kind).resources
    const connector = this.#connector()
    if (connector == null) throw new TransientIntegrationError('Connector is unavailable.')
    try {
      if (connector.trigger == null) throw new TransientIntegrationError('Trigger operation transport is unavailable.')
      if (managed && !this.#store.eventSources.saveState(source, { ...source.state, resourceStatus: 'pending', lastError: '' }))
        throw new TransientIntegrationError('The source changed during subscription setup.')
      const result = await connector.trigger(
        source.provider,
        source.connectionId,
        triggerId,
        { operation: 'resource', config: subscription.config, requestKey: `${source.sourceId}:${stored.resourceKey}`, active },
        signal ?? AbortSignal.timeout(30_000),
        {
          providerAccess: stored.providerAccess,
          providerId: source.provider,
          scope: 'trigger',
          triggerId,
          connectionId: source.connectionId,
          purpose: 'trigger',
          source: 'publication',
          ...(source.teamId == null ? {} : { teamId: source.teamId }),
        },
      )
      if (managed) {
        const confirmed = z.object({ outcome: z.literal('ready'), subscription: z.record(z.string(), z.json()) }).safeParse(result)
        if (!confirmed.success) throw new TransientIntegrationError('Connector did not confirm the source subscription.')
        const next = {
          ...source.state,
          resource: confirmed.data.subscription,
          resourceStatus: active ? 'ready' : 'idle',
          lastError: '',
          verifiedAt: active ? this.#clock() : null,
        }
        if (!this.#store.eventSources.saveState(source, next)) throw new TransientIntegrationError('The source changed during subscription setup.')
      }
      if (active) this.#store.eventSources.subscriptionState(source.sourceId, stored.resourceKey, 'ready', this.#clock())
      else this.#store.eventSources.deleteSubscription(source.sourceId, stored.resourceKey)
    } catch (error) {
      if (managed)
        this.#store.eventSources.saveState(source, {
          ...source.state,
          resourceStatus: 'error',
          lastError: error instanceof ConnectorTaskError ? error.message : 'Source subscription could not be confirmed.',
        })
      this.#store.eventSources.subscriptionState(source.sourceId, stored.resourceKey, 'uncertain', this.#clock())
      throw error
    }
  }

  #operatorContext(providerId: string, teamId: string | undefined): ConnectorAccessContext {
    return {
      providerAccess: this.#connectorAccess.current(''),
      providerId,
      scope: 'catalog',
      purpose: 'catalog',
      source: 'operator',
      ...(teamId == null ? {} : { teamId }),
    }
  }
}
