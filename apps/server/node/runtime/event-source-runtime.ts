import type { CreateEventSource, EventSource, UpdateEventSource } from '@oomol-lab/open-flow/control-api'
import type { SourceReferenceOperation } from '@oomol-lab/open-flow/event-source'
import type { IntegrationDefinition, IntegrationReconcileContext, IntegrationReconcileResult } from '@oomol-lab/open-flow/integration-trigger'
import type { ConnectorAccessHost } from '../deployment/connector-access.ts'
import type { ConnectorAccessContext, ConnectorHost } from '../deployment/connector-contract.ts'
import type { StoredEventSource, SourceSubscription } from '../storage/event-source-store.ts'
import type { Store } from '../storage/store.ts'
import type { IntegrationOptions } from './integration-runtime.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import {
  SourceIdentityError,
  eventSourceDefinition,
  sourceReferenceResultSchema,
  sourceReferenceDeleteResultSchema,
  sourceReferenceResourceResultSchema,
  sourceReferenceRouteResultSchema,
  sourceReferenceReceiptSchema,
  preparedSourceReferenceSchema,
} from '@oomol-lab/open-flow/event-source'
import { PermanentIntegrationError, TransientIntegrationError } from '@oomol-lab/open-flow/integration-trigger'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
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
    const pending = this.#store.eventSources.ids(teamId)[Symbol.iterator]()
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
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const source = this.#store.eventSources.reserve(input, fingerprint)
    if (source.pending == null) return this.#store.eventSources.view(await this.#hydrate(source, signal), this.#options()?.publicOrigin)
    const result = sourceReferenceResultSchema.parse(
      await this.#execute(
        source.kind,
        source.connectionId,
        {
          operation: 'sourceReference',
          request: {
            action: 'create',
            deploymentId: source.connector!.deploymentId,
            requestKey: source.connector!.requestKey,
            input: Object.fromEntries(
              Object.entries(input).filter(([key]) => !['kind', 'version', 'name', 'connectionId', 'teamId', 'enabled', 'expectedRevision'].includes(key)),
            ),
          },
        },
        signal,
        access,
      ),
    )
    if (!this.#store.eventSources.saveReference(source, result.source, 'create'))
      throw new ControlError(controlErrorCode.eventSourceConflict, 'Source creation is unfinished. Retry the same request.')
    return this.#store.eventSources.view(this.#store.eventSources.require(source.sourceId), this.#options()?.publicOrigin)
  }

  async update(sourceId: string, input: UpdateEventSource, signal: AbortSignal): Promise<EventSource> {
    const original = this.#store.eventSources.require(sourceId, input.expectedRevision)
    if (original.connector?.reference == null) throw new ControlError(controlErrorCode.eventSourceConflict, 'Complete Source creation before editing.')
    if (
      original.pending == null &&
      input.signingSecret == null &&
      input.encryptKey == null &&
      input.verificationToken == null &&
      isDeepStrictEqual(input.eventTypes, original.eventTypes)
    ) {
      if (this.#store.eventSources.busy(original)) throw new ControlError(controlErrorCode.eventSourceConflict, 'An application operation is unfinished.')
      const updated = this.#store.eventSources.update(sourceId, input)
      this.#wake()
      return this.#store.eventSources.view(updated, this.#options()?.publicOrigin)
    }
    const inspected = original.pending == null ? await this.#hydrate(original, signal) : original
    const source = this.#store.eventSources.beginChange(
      sourceId,
      input.expectedRevision,
      {
        action: 'update',
        fingerprint: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
        remoteRevision: inspected.connector!.revision!,
      },
      input,
    )
    let result
    try {
      result = sourceReferenceResultSchema.parse(
        await this.#execute(
          source.kind,
          source.connectionId,
          {
            operation: 'sourceReference',
            request: {
              action: 'update',
              deploymentId: source.connector!.deploymentId,
              reference: source.connector!.reference!,
              expectedRevision: source.pending!.remoteRevision!,
              input: Object.fromEntries(
                Object.entries(input).filter(([key]) => !['kind', 'version', 'name', 'connectionId', 'teamId', 'enabled', 'expectedRevision'].includes(key)),
              ),
            },
          },
          signal,
          this.#operatorContext(source.provider, source.teamId ?? undefined),
        ),
      )
    } catch (error) {
      if (error instanceof ControlError || (error instanceof ConnectorTaskError && error.code === 'connector.input-invalid'))
        this.#store.eventSources.failChange(source)
      throw error
    }
    if (!this.#store.eventSources.saveReference(source, result.source, input))
      throw new ControlError(controlErrorCode.eventSourceConflict, 'Source update is unfinished. Retry the same request.')
    this.#wake()
    return this.#store.eventSources.view(this.#store.eventSources.require(sourceId), this.#options()?.publicOrigin)
  }

  async delete(sourceId: string, revision: number, signal: AbortSignal): Promise<void> {
    {
      const source = this.#store.eventSources.beginChange(sourceId, revision, { action: 'delete', fingerprint: String(revision) })
      sourceReferenceDeleteResultSchema.parse(
        await this.#execute(
          source.kind,
          source.connectionId,
          {
            operation: 'sourceReference',
            request: {
              action: 'delete',
              deploymentId: source.connector!.deploymentId,
              reference: source.connector!.reference ?? { appId: String(source.config.appId), requestKey: source.connector!.requestKey },
            },
          },
          signal,
          this.#operatorContext(source.provider, source.teamId ?? undefined),
        ),
      )
    }
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
    try {
      return await this.#receive(sources, request, true)
    } catch {
      request.signal.throwIfAborted()
      return new Response(null, { status: 503 })
    }
  }

  async receive(sourceId: string, request: Request): Promise<Response> {
    if (request.method != 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
    const source = this.#store.eventSources.get(sourceId)
    if (source == null || source.enabled != 1) return new Response(null, { status: 404 })
    return this.#receive([source], request)
  }

  async #receive(sources: readonly StoredEventSource[], request: Request, application = false): Promise<Response> {
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
    if (application) {
      const groups = Map.groupBy(sources, (source) =>
        JSON.stringify([source.teamId, source.connector!.deploymentId, source.connector!.reference?.applicationId]),
      )
      const selected: StoredEventSource[] = []
      let response: Response | undefined
      for (const group of groups.values()) {
        const source = group[0]!
        if (this.#store.eventSources.busy(source) || !source.connector?.reference) return new Response(null, { status: 503 })
        const routed = sourceReferenceRouteResultSchema.parse(
          await this.#execute(
            source.kind,
            source.connectionId,
            {
              operation: 'sourceReference',
              request: {
                action: 'route',
                deploymentId: source.connector.deploymentId,
                applicationId: source.connector.reference.applicationId,
                headers: Object.fromEntries(request.headers),
                rawBody: Buffer.from(bytes).toString('base64'),
              },
            },
            request.signal,
            this.#operatorContext(source.provider, source.teamId ?? undefined),
          ),
        )
        request.signal.throwIfAborted()
        if (routed.response) {
          const result = new Response([204, 205, 304].includes(routed.response.status) ? null : routed.response.body, {
            status: routed.response.status,
            headers: routed.response.headers,
          })
          if (!result.ok) return result
          response ??= result
        }
        const ids = new Set(
          routed.references
            .filter((reference) => reference.applicationId === source.connector!.reference!.applicationId)
            .map((reference) => reference.sourceId),
        )
        selected.push(...group.filter((item) => ids.has(item.connector!.reference!.sourceId)))
      }
      if (!selected.length) return response ?? Response.json({})
      sources = selected
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
      if (this.#store.eventSources.busy(source)) return new Response(null, { status: 503 })
      const callback = {
        action: 'receive' as const,
        headers: Object.fromEntries(headers),
        rawBody: Buffer.from(bytes).toString('base64'),
        consumers: this.#store.eventSources.consumersForEvent(source),
      }
      const access = this.#operatorContext(source.provider, source.teamId ?? undefined)
      const result = sourceReferenceReceiptSchema.parse(
        await this.#execute(
          source.kind,
          source.connectionId,
          {
            operation: 'sourceReference',
            request: { ...callback, deploymentId: source.connector!.deploymentId, reference: source.connector!.reference! },
          },
          signal,
          access,
        ),
      )
      if (result.source != null && !this.#store.eventSources.saveReference(source, result.source)) return new Response(null, { status: 409 })
      received = { ...result, source: undefined }
    } catch {
      signal.throwIfAborted()
      return new Response(null, { status: 503 })
    }
    signal.throwIfAborted()
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
    if (this.#store.eventSources.busy(source)) throw new TransientIntegrationError('A Source operation is unfinished.')
    source = await this.#hydrate(source)
    const sourceDefinition = eventSourceDefinition(source.kind)
    if (source.enabled != 1) throw new PermanentIntegrationError('Enable the event source before publishing.')
    const prepared = preparedSourceReferenceSchema.parse(
      await this.#execute(
        source.kind,
        source.connectionId,
        {
          operation: 'sourceReference',
          request: {
            action: 'prepare',
            deploymentId: source.connector!.deploymentId,
            reference: source.connector!.reference!,
            config: context.config,
            endpointUrl: this.#store.eventSources.view(source, this.#options()?.publicOrigin).endpointUrl ?? undefined,
          },
        },
        context.signal ?? AbortSignal.timeout(30_000),
        access,
      ),
    )
    if (!this.#store.eventSources.saveReference(source, prepared.source)) throw new TransientIntegrationError('The Source changed during preparation.')
    const subscriptions = prepared.subscriptions
    for (const subscription of subscriptions) {
      if (access.scope == 'catalog') throw new PermanentIntegrationError('Resource subscriptions require a fixed access snapshot.')
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
      if (source == null) continue
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
    const { triggerId } = eventSourceDefinition(source.kind)
    try {
      const result = sourceReferenceResourceResultSchema.parse(
        await this.#execute(
          source.kind,
          source.connectionId,
          {
            operation: 'sourceReference',
            request: {
              action: 'resource',
              deploymentId: source.connector!.deploymentId,
              reference: source.connector!.reference!,
              key: stored.resourceKey,
              active,
            },
          },
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
        ),
      )
      if (!this.#store.eventSources.saveReference(source, result.source)) throw new TransientIntegrationError('The Source changed during resource preparation.')
      if (result.outcome === 'pending') throw new TransientIntegrationError('The Source resource is still being prepared.')
      if (active) this.#store.eventSources.subscriptionState(source.sourceId, stored.resourceKey, 'ready', this.#clock())
      else this.#store.eventSources.deleteSubscription(source.sourceId, stored.resourceKey)
    } catch (error) {
      this.#store.eventSources.subscriptionState(source.sourceId, stored.resourceKey, 'uncertain', this.#clock())
      throw error
    }
  }

  async #hydrate(source: StoredEventSource, signal = AbortSignal.timeout(30_000)): Promise<StoredEventSource> {
    if (source.connector?.reference == null || this.#store.eventSources.busy(source)) return source
    const result = sourceReferenceResultSchema.parse(
      await this.#execute(
        source.kind,
        source.connectionId,
        {
          operation: 'sourceReference',
          request: { action: 'get', deploymentId: source.connector.deploymentId, reference: source.connector.reference },
        },
        signal,
        this.#operatorContext(source.provider, source.teamId ?? undefined),
      ),
    )
    signal.throwIfAborted()
    if (!this.#store.eventSources.saveReference(source, result.source)) throw new TransientIntegrationError('The Source changed while reading it.')
    return this.#store.eventSources.require(source.sourceId)
  }

  async #execute(
    kind: string,
    connectionId: string,
    operation: { operation: 'sourceReference'; request: SourceReferenceOperation },
    signal: AbortSignal,
    access: ConnectorAccessContext,
  ): Promise<unknown> {
    const connector = this.#connector()
    if (connector?.trigger == null) throw new TransientIntegrationError('Connector source protocol is unavailable.')
    const definition = eventSourceDefinition(kind)
    try {
      return await connector.trigger(definition.provider, connectionId, definition.triggerId, operation, signal, access)
    } catch (error) {
      if (error instanceof ConnectorTaskError && error.code === 'connector.input-invalid' && error.status === 409)
        throw new ControlError(controlErrorCode.eventSourceConflict, error.message)
      if (error instanceof ConnectorTaskError && error.code === 'connector.input-invalid') {
        if (operation.request.action === 'create') throw new ControlError(controlErrorCode.eventSourceIdentityUnavailable, error.message)
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
