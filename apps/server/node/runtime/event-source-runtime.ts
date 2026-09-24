import type { CreateEventSource, EventSource, UpdateEventSource } from '@oomol-lab/open-flow/control-api'
import type { IntegrationDefinition, IntegrationReconcileContext, IntegrationReconcileResult } from '@oomol-lab/open-flow/integration-trigger'
import type { ConnectorAccessHost } from '../deployment/connector-access.ts'
import type { ConnectorAccessContext, ConnectorHost } from '../deployment/connector.ts'
import type { StoredEventSource, SourceSubscription } from '../storage/event-source-store.ts'
import type { Store } from '../storage/store.ts'
import type { IntegrationOptions } from './integration-runtime.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { IntegrationConnectionError, PermanentIntegrationError, TransientIntegrationError } from '@oomol-lab/open-flow/integration-trigger'
import { feishuResponse, feishuSubscriptions, receiveFeishuEvent } from '@oomol-lab/open-flow/provider-triggers'
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
    const provider = 'feishu_app_bot'
    const access = this.#operatorContext(provider, input.teamId ?? undefined)
    const connections = await connector.listConnections(provider, signal, access)
    const connection = connections.find((item) => item.connectionId == input.connectionId && item.status == 'active')
    if (connection == null) {
      throw new ControlError(controlErrorCode.eventSourceInvalid, 'Choose an active Connection in this Connector Team.')
    }
    const appId = connection.providerAccountId
    if (appId == null || !/^cli_[a-zA-Z0-9]+$/.test(appId))
      throw new ControlError(controlErrorCode.eventSourceIdentityUnavailable, 'Connector must provide the verified application identity.')
    signal.throwIfAborted()
    const source = this.#store.eventSources.create({ ...input, provider, appId })
    return this.#store.eventSources.view(source, this.#options()?.publicOrigin)
  }

  update(sourceId: string, input: UpdateEventSource): EventSource {
    const source = this.#store.eventSources.update(sourceId, input)
    this.#wake()
    return this.#store.eventSources.view(source, this.#options()?.publicOrigin)
  }

  delete(sourceId: string, revision: number): void {
    this.#store.eventSources.delete(sourceId, revision)
  }

  async receive(sourceId: string, request: Request): Promise<Response> {
    if (request.method != 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
    const source = this.#store.eventSources.get(sourceId)
    if (source == null || source.enabled != 1) return new Response(null, { status: 404 })
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
        if (size > 64 * 1024) {
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
    let received
    try {
      received = await receiveFeishuEvent(bytes, request.headers, source, this.#clock())
    } catch {
      return new Response(null, { status: 401 })
    }
    request.signal.throwIfAborted()
    if ('challenge' in received) {
      if (!this.#store.eventSources.verified(source, this.#clock())) return new Response(null, { status: 409 })
      return Response.json(received)
    }
    if (!(JSON.parse(source.eventTypesJson) as string[]).includes(received.event.type)) return Response.json({})
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
    if (source.enabled != 1 || source.verifiedAt == null) throw new PermanentIntegrationError('Verify and enable the event source before publishing.')
    const allowed = JSON.parse(source.eventTypesJson) as string[]
    if (!(context.config.eventTypes as string[]).every((type) => allowed.includes(type)))
      throw new PermanentIntegrationError('Configure the requested events on the event source first.')
    const connector = this.#connector()
    if (connector == null) throw new TransientIntegrationError('Connector is unavailable.')
    const connections = await connector.listConnections(source.provider, context.signal, access)
    if (
      !connections.some(
        (connection) => connection.connectionId == connectionId && connection.status == 'active' && connection.providerAccountId == source.appId,
      )
    )
      throw new IntegrationConnectionError('The source Connection requires reauthorization.')
    const subscriptions = feishuSubscriptions(context.config, source.provider)
    if (subscriptions.length > 0 && source.manageSubscriptions != 1) throw new PermanentIntegrationError('This source does not manage resource subscriptions.')
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
      if (stored.status == 'ready') continue
      const key = JSON.stringify([source.sourceId, subscription.key])
      const running = this.#operations.get(key)
      if (running != null) {
        await running
        return { outcome: 'pending' }
      }
      if (previous != null) throw new PermanentIntegrationError('A previous subscription operation has an uncertain outcome. Verify it before retrying.')
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
      if (this.#operations.has(key) || subscription.status != 'ready') continue
      const source = this.#store.eventSources.get(subscription.sourceId)
      if (source == null || source.manageSubscriptions != 1) continue
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
    const subscription = JSON.parse(stored.resourceJson) as ReturnType<typeof feishuSubscriptions>[number]
    const connector = this.#connector()
    if (connector == null) throw new TransientIntegrationError('Connector is unavailable.')
    try {
      const request = active ? subscription.subscribe : subscription.unsubscribe
      const result = await connector.proxy(source.provider, source.connectionId, source.sourceId, request, signal ?? AbortSignal.timeout(30_000), {
        providerAccess: stored.providerAccess,
        providerId: source.provider,
        scope: 'proxy',
        connectionId: source.connectionId,
        purpose: 'trigger',
        source: 'publication',
        ...(source.teamId == null ? {} : { teamId: source.teamId }),
      })
      feishuResponse(result)
      if (active) this.#store.eventSources.subscriptionState(source.sourceId, stored.resourceKey, 'ready', this.#clock())
      else this.#store.eventSources.deleteSubscription(source.sourceId, stored.resourceKey)
    } catch (error) {
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
