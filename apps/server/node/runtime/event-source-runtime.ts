import type { CreateEventSource, EventSource, UpdateEventSource } from '@oomol-lab/open-flow/control-api'
import type { SourceSubscription as ResourceSubscription, SourceConfiguration, SourceOperation } from '@oomol-lab/open-flow/event-source'
import type { IntegrationDefinition, IntegrationReconcileContext, IntegrationReconcileResult } from '@oomol-lab/open-flow/integration-trigger'
import type { ConnectorAccessHost } from '../deployment/connector-access.ts'
import type { ConnectorAccessContext, ConnectorHost } from '../deployment/connector-contract.ts'
import type { StoredEventSource, SourceSubscription } from '../storage/event-source-store.ts'
import type { Store } from '../storage/store.ts'
import type { IntegrationOptions } from './integration-runtime.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { SourceIdentityError, eventSourceDefinition, sourceResultSchema, preparedSourceSchema, sourceReceiptSchema } from '@oomol-lab/open-flow/event-source'
import { PermanentIntegrationError, TransientIntegrationError } from '@oomol-lab/open-flow/integration-trigger'
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

  async list(teamId?: string | null, signal?: AbortSignal): Promise<{ readonly version: 1; readonly sources: readonly EventSource[] }> {
    signal?.throwIfAborted()
    const pending = this.#store.eventSources.unprojected(teamId)[Symbol.iterator]()
    const budget = AbortSignal.timeout(3_000)
    const inspectionSignal = signal == null ? budget : AbortSignal.any([signal, budget])
    const workers = Array.from({ length: 4 }, async () => {
      while (!inspectionSignal.aborted) {
        const next = pending.next()
        if (next.done) return
        try {
          const source = this.#store.eventSources.get(next.value)
          if (source != null) await this.#hydrate(source, inspectionSignal)
        } catch {
          // Unavailable sources retain their identity and error state in the list view.
        }
      }
    })
    const aborted = Promise.withResolvers<void>()
    const stop = () => aborted.resolve()
    if (inspectionSignal.aborted) stop()
    else inspectionSignal.addEventListener('abort', stop, { once: true })
    try {
      await Promise.race([Promise.all(workers), aborted.promise])
      signal?.throwIfAborted()
      return { version: 1, sources: this.#store.eventSources.list(this.#options()?.publicOrigin, teamId) }
    } finally {
      inspectionSignal.removeEventListener('abort', stop)
    }
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
    const { source: configuration } = sourceResultSchema.parse(
      await this.#execute(definition.kind, input.connectionId, { operation: 'source', request: { action: 'initialize', input: { ...input } } }, signal, access),
    )
    signal.throwIfAborted()
    const source = this.#store.eventSources.create(input, definition.kind, configuration)
    return this.#store.eventSources.view(source, this.#options()?.publicOrigin)
  }

  async update(sourceId: string, input: UpdateEventSource, signal: AbortSignal): Promise<EventSource> {
    const original = this.#store.eventSources.require(sourceId, input.expectedRevision)
    const { source: configuration } = sourceResultSchema.parse(
      await this.#execute(
        original.kind,
        original.connectionId,
        { operation: 'source', request: { action: 'update', source: original, input: { ...input } } },
        signal,
        this.#operatorContext(original.provider, original.teamId ?? undefined),
      ),
    )
    signal.throwIfAborted()
    const source = this.#store.eventSources.update(sourceId, input, configuration)
    this.#wake()
    return this.#store.eventSources.view(source, this.#options()?.publicOrigin)
  }

  delete(sourceId: string, revision: number): void {
    this.#store.eventSources.delete(sourceId, revision)
  }

  async receiveApplication(kind: string, appId: string, request: Request): Promise<Response> {
    try {
      if (!eventSourceDefinition(kind).applicationIngress) return new Response(null, { status: 404 })
    } catch (error) {
      if (error instanceof SourceIdentityError) return new Response(null, { status: 404 })
      throw error
    }
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
    let received
    try {
      received = sourceReceiptSchema.parse(
        await this.#execute(
          source.kind,
          source.connectionId,
          {
            operation: 'source',
            request: {
              action: 'receive',
              source,
              headers: Object.fromEntries(headers),
              rawBody: Buffer.from(bytes).toString('base64'),
              consumers: this.#store.eventSources.consumersForEvent(source),
            },
          },
          signal,
          this.#operatorContext(source.provider, source.teamId ?? undefined),
        ),
      )
    } catch {
      signal.throwIfAborted()
      return new Response(null, { status: 503 })
    }
    signal.throwIfAborted()
    if (received.source != null && !this.#store.eventSources.saveState(source, received.source.state)) return new Response(null, { status: 409 })
    if (received.response != null)
      return new Response([204, 205, 304].includes(received.response.status) ? null : received.response.body, {
        status: received.response.status,
        headers: received.response.headers,
      })
    const event = received.event!
    if (!source.eventTypes.includes(event.type)) return Response.json({})
    const result = this.#store.eventSources.receive(source, event, this.#clock())
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
    let source = this.#store.eventSources.get(String(context.config.sourceId))
    if (
      source == null ||
      source.provider != definition.snapshot.provider ||
      source.connectionId != connectionId ||
      source.teamId != (this.#store.connectorTeams.get(flowId) ?? null)
    ) {
      throw new PermanentIntegrationError('The event source does not authorize this Connection and Flow scope.')
    }
    source = await this.#hydrate(source)
    const sourceDefinition = eventSourceDefinition(source.kind)
    if (source.enabled != 1) throw new PermanentIntegrationError('Enable the event source before publishing.')
    let subscriptions: readonly ResourceSubscription[]
    try {
      const prepared = preparedSourceSchema.parse(
        await this.#execute(
          source.kind,
          source.connectionId,
          {
            operation: 'source',
            request: {
              action: 'prepare',
              source,
              config: context.config,
              endpointUrl: this.#store.eventSources.view(source, this.#options()?.publicOrigin).endpointUrl ?? undefined,
            },
          },
          context.signal ?? AbortSignal.timeout(30_000),
          access,
        ),
      )
      if (!this.#store.eventSources.saveState(source, prepared.source.state)) throw new TransientIntegrationError('The source changed during preparation.')
      subscriptions = prepared.subscriptions
    } catch (error) {
      if (sourceDefinition.managed)
        this.#store.eventSources.saveState(
          source,
          this.#resourceState(source, 'error', 'The source could not be verified. Check authorization and retry publication.'),
        )
      throw error
    }
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
      if (stored.status == 'ready' && !sourceDefinition.managed) continue
      const key = JSON.stringify([source.sourceId, subscription.key])
      const running = this.#operations.get(key)
      if (running != null) {
        await running
        return { outcome: 'pending' }
      }
      if (previous != null && !sourceDefinition.managed)
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
      if (source == null || (subscription.status != 'ready' && !eventSourceDefinition(source.kind).managed)) continue
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
    const { triggerId, managed } = eventSourceDefinition(source.kind)
    const connector = this.#connector()
    if (connector == null) throw new TransientIntegrationError('Connector is unavailable.')
    try {
      if (connector.trigger == null) throw new TransientIntegrationError('Trigger operation transport is unavailable.')
      if (managed && !this.#store.eventSources.saveState(source, this.#resourceState(source, 'pending', '')))
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
          ...source,
          state: {
            ...source.state,
            resource: confirmed.data.subscription,
            resourceStatus: active ? 'ready' : 'idle',
            lastError: '',
            verifiedAt: active ? this.#clock() : null,
          },
        }
        const inspected = sourceResultSchema.parse(
          await this.#execute(
            source.kind,
            source.connectionId,
            { operation: 'source', request: { action: 'inspect', source: next } },
            signal ?? AbortSignal.timeout(30_000),
            this.#operatorContext(source.provider, source.teamId ?? undefined),
          ),
        )
        if (!this.#store.eventSources.saveState(source, inspected.source.state))
          throw new TransientIntegrationError('The source changed during subscription setup.')
      }
      if (active) this.#store.eventSources.subscriptionState(source.sourceId, stored.resourceKey, 'ready', this.#clock())
      else this.#store.eventSources.deleteSubscription(source.sourceId, stored.resourceKey)
    } catch (error) {
      if (managed)
        this.#store.eventSources.saveState(
          source,
          this.#resourceState(source, 'error', error instanceof ConnectorTaskError ? error.message : 'Source subscription could not be confirmed.'),
        )
      this.#store.eventSources.subscriptionState(source.sourceId, stored.resourceKey, 'uncertain', this.#clock())
      throw error
    }
  }

  async #hydrate(source: StoredEventSource, signal = AbortSignal.timeout(30_000)): Promise<StoredEventSource> {
    if (source.state.projection != null) return source
    const inspected = sourceResultSchema.parse(
      await this.#execute(
        source.kind,
        source.connectionId,
        { operation: 'source', request: { action: 'inspect', source } },
        signal,
        this.#operatorContext(source.provider, source.teamId ?? undefined),
      ),
    )
    signal.throwIfAborted()
    this.#store.eventSources.saveState(source, inspected.source.state)
    const current = this.#store.eventSources.get(source.sourceId)
    if (current == null) throw new TransientIntegrationError('The source was deleted during protocol initialization.')
    return current
  }

  #resourceState(source: SourceConfiguration, status: 'pending' | 'error', message: string): SourceConfiguration['state'] {
    const projection = source.state.projection as { view: Record<string, import('@oomol-lab/open-flow/flow-change').JsonValue> }
    return {
      ...source.state,
      resourceStatus: status,
      lastError: message,
      projection: { ...projection, ready: false, view: { ...projection.view, subscriptionStatus: status, lastError: message } },
    }
  }

  async #execute(
    kind: string,
    connectionId: string,
    operation: { operation: 'source'; request: SourceOperation },
    signal: AbortSignal,
    access: ConnectorAccessContext,
  ): Promise<unknown> {
    const connector = this.#connector()
    if (connector?.trigger == null) throw new TransientIntegrationError('Connector source protocol is unavailable.')
    const definition = eventSourceDefinition(kind)
    try {
      return await connector.trigger(definition.provider, connectionId, definition.triggerId, operation, signal, access)
    } catch (error) {
      if (error instanceof ConnectorTaskError && error.code === 'connector.input-invalid') {
        if (operation.request.action === 'initialize') throw new ControlError(controlErrorCode.eventSourceIdentityUnavailable, error.message)
        if (operation.request.action === 'update') throw new ControlError(controlErrorCode.eventSourceInvalid, error.message)
      }
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
