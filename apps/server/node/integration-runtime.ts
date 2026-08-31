import type { ConnectorProxy } from '@oomol-lab/open-flow/connector-proxy'
import type { JsonValue, RevisionContent, TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type {
  IntegrationDefinition,
  IntegrationReceiveContext,
  IntegrationReconcileContext,
  IntegrationReconcileResult,
  IntegrationStateContext,
} from '@oomol-lab/open-flow/integration-trigger'
import type { Logger } from 'pino'
import type { ConnectorHost } from './connector.ts'
import type { IntegrationHealth, StoredIntegrationBinding, StoredIntegrationState, StoredIntegrationTarget } from './trigger-store.ts'

import { canonicalJsonBytes, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import {
  integrationCallbackSecret,
  integrationOccurrenceId,
  IntegrationConnectionError,
  maximumIntegrationDeliveryPages,
  PermanentIntegrationError,
  TransientIntegrationError,
} from '@oomol-lab/open-flow/integration-trigger'
import * as Effect from 'effect/Effect'
import * as Semaphore from 'effect/Semaphore'
import { ConnectorTaskError } from './connector.ts'
import { AcceptanceError } from './error.ts'
import { errorKind } from './logger.ts'
import { Store } from './store.ts'

export interface IntegrationOptions {
  readonly callbackKey: string
  readonly publicOrigin: string
}

export interface IntegrationResponse {
  readonly body?: string
  readonly contentType?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly status: number
}

export interface IntegrationTarget {
  readonly connectionId: string
  readonly current: boolean
  readonly definition: IntegrationDefinition
  readonly state: IntegrationStateContext
  readonly stored: StoredIntegrationTarget
  readonly trigger: Extract<TriggerNode, { readonly kind: 'integration' }>
}

export interface IntegrationRuntimeState {
  readonly bindingId: string
  readonly checkpoint: JsonValue | null
  readonly endpointId: string
  readonly health: IntegrationHealth
  readonly runtimeVersion: number
  readonly subscription: Readonly<Record<string, JsonValue>> | null
}

type ValidateFlow = (revision: RevisionContent) => Promise<{ readonly content: string; readonly prepared: PreparedFlow; readonly revisionDigest: string }>

const batchSize = 100
const reconcileTimeoutMs = 30_000
const retryMs = 1_000

export class IntegrationRuntime {
  readonly #clock: () => number
  readonly #definitions: ReadonlyMap<string, IntegrationDefinition>
  readonly #logger: Logger
  readonly #lock = Semaphore.makeUnsafe(1)
  readonly #resolveConnector: () => ConnectorHost | undefined
  readonly #resolveOptions: () => IntegrationOptions | undefined
  readonly #retrying = new Set<string>()
  readonly #store: Store
  readonly #validateFlow: ValidateFlow
  readonly #wake: () => void
  readonly #runCreated: (flowId: string, runId: string) => void

  constructor(
    store: Store,
    resolveConnector: () => ConnectorHost | undefined,
    clock: () => number,
    resolveOptions: () => IntegrationOptions | undefined,
    definitions: readonly IntegrationDefinition[],
    validateFlow: ValidateFlow,
    wake: () => void,
    runCreated: (flowId: string, runId: string) => void,
    logger: Logger,
  ) {
    this.#clock = clock
    this.#definitions = new Map(definitions.map((definition) => [definition.snapshot.key, definition]))
    this.#logger = logger.child({ component: 'integration' })
    this.#resolveConnector = resolveConnector
    this.#resolveOptions = resolveOptions
    this.#store = store
    this.#validateFlow = validateFlow
    this.#wake = wake
    this.#runCreated = runCreated
  }

  bindings(revision: RevisionContent, prepared: PreparedFlow, publishedAt: number) {
    const nodes = Object.entries(prepared.graph.nodes)
      .filter((entry): entry is [string, Extract<TriggerNode, { readonly kind: 'integration' }>] => entry[1].kind == 'integration')
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    if (nodes.length > 0 && this.#resolveOptions() == null) {
      throw new AcceptanceError('trigger-invalid', 'Integration runtime is not configured.')
    }
    return nodes.map(([triggerNodeId, trigger]) => {
      const definition = this.#definitions.get(trigger.definition.key)
      if (definition?.snapshot.definitionVersion != trigger.definition.definitionVersion) {
        throw new AcceptanceError('trigger-invalid', 'Integration Trigger definition is not available.')
      }
      const binding = revision.document.bindings[trigger.bindingId]
      if (binding?.kind != 'connection' || binding.target.length == 0) {
        throw new AcceptanceError('trigger-invalid', 'Integration Trigger Connection is unresolved.')
      }
      return {
        connectionId: binding.target,
        reconcileAt: publishedAt,
        triggerJson: JSON.stringify(trigger),
        triggerNodeId,
      }
    })
  }

  endpoint(flowId: string, triggerNodeId: string): string | undefined {
    return this.#store.triggers.integrationBinding(flowId, triggerNodeId)?.endpointId
  }

  state(flowId: string, triggerNodeId: string): IntegrationRuntimeState | undefined {
    const binding = this.#store.triggers.integrationBinding(flowId, triggerNodeId)
    if (binding == null) return
    const state = this.#store.triggers.integrationState(binding.bindingId)
    return {
      bindingId: binding.bindingId,
      checkpoint: state == null ? null : (JSON.parse(state.checkpointJson) as JsonValue),
      endpointId: binding.endpointId,
      health: binding.health,
      runtimeVersion: binding.runtimeVersion,
      subscription: state == null ? null : (JSON.parse(state.subscriptionJson) as Readonly<Record<string, JsonValue>>),
    }
  }

  target(endpointId: string): IntegrationTarget | undefined {
    let stored = this.#store.triggers.integrationTarget(endpointId)
    if (stored == null) return
    let state = stored.state
    let current = state == null || state.runtimeVersion == stored.runtimeVersion
    let resolved = this.#trigger(state == null || current ? stored.triggerJson : state.triggerJson)
    if (state == null) {
      const initial = resolved.definition.initialState ?? { checkpoint: null, subscription: {} }
      this.#store.triggers.createIntegrationState(stored, initial.checkpoint, initial.subscription, this.#clock())
      stored = this.#store.triggers.integrationTarget(endpointId)
      state = stored?.state
      if (stored == null || state == null) throw new TransientIntegrationError('Integration runtime state changed.')
      current = state.runtimeVersion == stored.runtimeVersion
      resolved = this.#trigger(current ? stored.triggerJson : state.triggerJson)
    }
    return {
      connectionId: current ? stored.connectionId : state.connectionId,
      current,
      definition: resolved.definition,
      state: this.#stateContext(state, this.#clock()),
      stored,
      trigger: resolved.trigger,
    }
  }

  tick(at = new Date(this.#clock()).toISOString()): Effect.Effect<void, unknown> {
    return this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const now = Date.parse(at)
        if (!Number.isFinite(now)) return yield* Effect.fail(new TypeError('Integration tick time must be an ISO timestamp.'))
        yield* this.#tick(now)
        this.#wake()
      }),
    )
  }

  async receive(
    target: IntegrationTarget,
    input: {
      readonly headers: Headers
      readonly method: IntegrationReceiveContext['method']
      readonly payload: JsonValue
      readonly query: URLSearchParams
      readonly rawBody: Uint8Array
    },
  ): Promise<IntegrationResponse> {
    const fixed = await this.#validateFlow(JSON.parse(target.stored.content) as RevisionContent)
    const currentTrigger = fixed.prepared.graph.nodes[target.stored.triggerNodeId]
    if (
      fixed.revisionDigest != target.stored.revisionDigest ||
      fixed.prepared.closureDigest != target.stored.closureDigest ||
      currentTrigger?.kind != 'integration' ||
      JSON.stringify(currentTrigger) != target.stored.triggerJson
    ) {
      return { status: 404 }
    }
    const options = this.#resolveOptions()
    if (options == null) return { status: 404 }
    const callbackSecret = await integrationCallbackSecret(options.callbackKey, target.stored.endpointId)
    const now = new Date(this.#clock())
    const admit = target.current && target.stored.health == 'healthy'
    const connector = this.#connectorProxy(target.definition, target.stored.bindingId, target.connectionId, target.stored.flowId)
    for (let page = 0; page < maximumIntegrationDeliveryPages; page += 1) {
      const received = await target.definition.receive({
        admit,
        allow: () => Promise.resolve(true),
        bindingId: target.stored.bindingId,
        callbackSecret,
        config: target.trigger.config,
        connector,
        current: target.current,
        header: (name) => input.headers.get(name) ?? undefined,
        method: input.method,
        now,
        payload: input.payload,
        query: (name) => input.query.get(name) ?? undefined,
        rawBody: input.rawBody,
        state: target.state,
      })
      if (received.outcome == 'respond') {
        return {
          body: received.body,
          contentType: received.contentType,
          ...(received.headers == null ? {} : { headers: received.headers }),
          status: received.status,
        }
      }
      if (!admit && target.definition.initialState == null) return { status: 404 }
      if (received.outcome == 'event') {
        if (!admit) return { status: target.trigger.definition.endpoint.successStatus }
        const occurrenceId = await integrationOccurrenceId(
          target.stored.bindingId,
          target.stored.runtimeVersion,
          target.definition.snapshot.key,
          received.dedupeKey ?? null,
        )
        const requestDigest = await digestBytes(
          canonicalJsonBytes({
            bindingId: target.stored.bindingId,
            occurrenceId,
            payload: received.payload,
            publicationId: target.stored.currentPublicationId,
            revisionDigest: target.stored.revisionDigest,
            runtimeVersion: target.stored.runtimeVersion,
          }),
        )
        const accepted = this.#store.triggers.acceptIntegrationTarget({
          ...target.stored,
          occurrenceId,
          payload: received.payload,
          requestDigest,
        })
        if (accepted == null) return { status: 404 }
        if (accepted.kind == 'conflict') return { status: 409 }
        if (accepted.kind == 'overloaded') return { status: 429 }
        if (accepted.created) {
          this.#runCreated(target.stored.flowId, accepted.runId)
          this.#wake()
        }
      }
      if (admit && received.checkpoint != null) await target.state.saveCheckpoint(received.checkpoint)
      if (received.continue != true || !admit) return { status: target.trigger.definition.endpoint.successStatus }
    }
    return { status: target.trigger.definition.endpoint.successStatus }
  }

  #invokeReconcile(
    definition: IntegrationDefinition,
    bindingId: string,
    connectionId: string,
    flowId: string,
    context: Omit<IntegrationReconcileContext, 'connector' | 'signal'>,
  ): Effect.Effect<IntegrationReconcileResult, unknown> {
    return Effect.tryPromise({
      try: (signal) =>
        definition.reconcile({
          ...context,
          connector: this.#connectorProxy(definition, bindingId, connectionId, flowId, signal),
          signal,
        }),
      catch: (error) => error,
    }).pipe(
      Effect.timeoutOrElse({
        duration: reconcileTimeoutMs,
        orElse: () => Effect.fail(new TransientIntegrationError('Integration reconciliation exceeded its execution deadline.')),
      }),
    )
  }

  #reconcile(binding: StoredIntegrationBinding, now: number): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const options = this.#resolveOptions()
      if (options == null) return yield* Effect.fail(new TransientIntegrationError('Integration runtime is not configured.'))
      const callbackSecret = yield* Effect.tryPromise({
        try: () => integrationCallbackSecret(options.callbackKey, binding.endpointId),
        catch: (error) => error,
      })
      const endpointUrl = `${options.publicOrigin}/v1/integrations/${binding.endpointId}`
      let state = this.#store.triggers.integrationState(binding.bindingId)
      let retiredPrevious = false
      if (state != null && state.runtimeVersion != binding.runtimeVersion) {
        const previousState = state
        const previous = this.#trigger(previousState.triggerJson)
        const outcome = yield* this.#invokeReconcile(previous.definition, binding.bindingId, previousState.connectionId, binding.flowId, {
          active: false,
          callbackSecret,
          config: previous.trigger.config,
          endpointUrl,
          now: new Date(now),
          state: this.#stateContext(previousState, now),
        })
        if (outcome.outcome == 'pending') {
          return yield* Effect.fail(new TransientIntegrationError('Previous Integration subscription is still retiring.'))
        }
        this.#store.triggers.deleteIntegrationState(binding.bindingId, previousState.runtimeVersion)
        state = this.#store.triggers.integrationState(binding.bindingId)
        if (state != null) return yield* Effect.fail(new TransientIntegrationError('Previous Integration subscription is still retiring.'))
        retiredPrevious = true
      }

      const active = binding.currentPublicationId != null
      const resolved = this.#trigger(binding.triggerJson)
      if (!active) {
        if (!retiredPrevious && (state != null || resolved.definition.initialState == null)) {
          const outcome = yield* this.#invokeReconcile(resolved.definition, binding.bindingId, binding.connectionId, binding.flowId, {
            active: false,
            callbackSecret,
            config: resolved.trigger.config,
            endpointUrl,
            now: new Date(now),
            ...(state == null ? {} : { state: this.#stateContext(state, now) }),
          })
          if (outcome.outcome == 'pending') {
            return yield* Effect.fail(new TransientIntegrationError('Integration subscription is still retiring.'))
          }
          if (state != null) this.#store.triggers.deleteIntegrationState(binding.bindingId, state.runtimeVersion)
        }
        this.#store.triggers.markIntegrationSynced(binding.bindingId, binding.runtimeVersion, false, now)
        this.#retrying.delete(binding.bindingId)
        return
      }

      if (state == null) {
        const initial = resolved.definition.initialState ?? { checkpoint: null, subscription: {} }
        this.#store.triggers.createIntegrationState(binding, initial.checkpoint, initial.subscription, now)
        state = this.#store.triggers.integrationState(binding.bindingId)
        if (state == null || state.runtimeVersion != binding.runtimeVersion) {
          return yield* Effect.fail(new TransientIntegrationError('Integration runtime state changed.'))
        }
      }
      const outcome = yield* this.#invokeReconcile(resolved.definition, binding.bindingId, binding.connectionId, binding.flowId, {
        active: true,
        callbackSecret,
        config: resolved.trigger.config,
        endpointUrl,
        now: new Date(now),
        state: this.#stateContext(state, now),
      })
      if (outcome.outcome == 'pending') {
        return yield* Effect.fail(new TransientIntegrationError('Integration subscription is still converging.'))
      }
      const synced = this.#store.triggers.markIntegrationSynced(binding.bindingId, binding.runtimeVersion, true, now)
      const retried = this.#retrying.delete(binding.bindingId)
      if (synced && (binding.health != 'healthy' || retried)) {
        this.#logger.info(
          {
            bindingId: binding.bindingId,
            category: binding.health == 'initializing' && !retried ? 'trigger.integration.ready' : 'trigger.integration.recovered',
            flowId: binding.flowId,
            runtimeVersion: binding.runtimeVersion,
            triggerNodeId: binding.triggerNodeId,
          },
          'Integration Trigger is healthy.',
        )
      }
    }).pipe(
      Effect.matchEffect({
        onFailure: (error) =>
          Effect.sync(() => {
            const health = failure(error)
            this.#store.triggers.failIntegration(
              binding.bindingId,
              binding.runtimeVersion,
              health == null
                ? { retryAt: now + retryMs }
                : { errorCode: health == 'needs_reauth' ? 'connector.connection-required' : 'trigger-key.invalid', health, now },
            )
            const fields = {
              bindingId: binding.bindingId,
              flowId: binding.flowId,
              runtimeVersion: binding.runtimeVersion,
              triggerNodeId: binding.triggerNodeId,
              ...errorKind(error),
            }
            if (health == null) {
              if (!this.#retrying.has(binding.bindingId)) {
                this.#logger.warn({ category: 'trigger.integration.retrying', retryAt: now + retryMs, ...fields }, 'Integration Trigger will be retried.')
              }
              this.#retrying.add(binding.bindingId)
            } else {
              this.#retrying.delete(binding.bindingId)
              this.#logger.warn({ category: 'trigger.integration.health_changed', health, ...fields }, 'Integration Trigger health changed.')
            }
          }),
        onSuccess: () => Effect.void,
      }),
    )
  }

  #connectorProxy(definition: IntegrationDefinition, bindingId: string, connectionId: string, flowId: string, parentSignal?: AbortSignal): ConnectorProxy {
    return {
      execute: async (request, signal) => {
        try {
          const connector = this.#resolveConnector()
          if (connector == null) throw new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.')
          let connectorSignal = signal ?? parentSignal
          if (signal != null && parentSignal != null) connectorSignal = AbortSignal.any([parentSignal, signal])
          connectorSignal ??= AbortSignal.timeout(30_000)
          return await connector.proxy(definition.snapshot.provider, connectionId, bindingId, request, connectorSignal, this.#store.connectorTeam(flowId))
        } catch (cause) {
          if (cause instanceof ConnectorTaskError && cause.code == 'connector.connection-required') {
            throw new IntegrationConnectionError('Integration Connection requires reauthorization.', { cause })
          }
          throw cause
        }
      },
    }
  }

  #stateContext(record: StoredIntegrationState, now: number): IntegrationStateContext {
    let checkpointJson = record.checkpointJson
    let subscriptionJson = record.subscriptionJson
    return {
      get checkpoint() {
        return JSON.parse(checkpointJson) as JsonValue
      },
      get subscription() {
        return JSON.parse(subscriptionJson) as Readonly<Record<string, JsonValue>>
      },
      saveCheckpoint: async (checkpoint) => {
        const next = JSON.stringify(checkpoint)
        if (!this.#store.triggers.updateIntegrationCheckpoint(record.bindingId, record.runtimeVersion, checkpointJson, next, now)) {
          throw new TransientIntegrationError('Integration checkpoint changed concurrently.')
        }
        checkpointJson = next
      },
      saveSubscription: async (subscription, reconcileAt) => {
        const next = JSON.stringify(subscription)
        if (!this.#store.triggers.updateIntegrationSubscription(record.bindingId, record.runtimeVersion, subscriptionJson, next, reconcileAt.getTime(), now)) {
          throw new TransientIntegrationError('Integration subscription changed concurrently.')
        }
        subscriptionJson = next
      },
    }
  }

  #tick(now: number): Effect.Effect<void, unknown> {
    return Effect.gen({ self: this }, function* () {
      while (true) {
        const bindings = this.#store.triggers.dueIntegrations(now, batchSize)
        if (bindings.length == 0) return
        for (const binding of bindings) {
          yield* this.#reconcile(binding, now)
        }
      }
    })
  }

  #trigger(triggerJson: string): {
    readonly definition: IntegrationDefinition
    readonly trigger: Extract<TriggerNode, { readonly kind: 'integration' }>
  } {
    const trigger = JSON.parse(triggerJson) as TriggerNode
    if (trigger.kind != 'integration') throw new PermanentIntegrationError('Fixed Integration Trigger is invalid.')
    const definition = this.#definitions.get(trigger.definition.key)
    if (definition?.snapshot.definitionVersion != trigger.definition.definitionVersion) {
      throw new PermanentIntegrationError('Fixed Integration Trigger definition is not available.')
    }
    return { definition, trigger }
  }
}

function failure(error: unknown): Extract<IntegrationHealth, 'failed' | 'needs_reauth'> | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current instanceof IntegrationConnectionError) return 'needs_reauth'
    if (current instanceof PermanentIntegrationError) return 'failed'
    if (current instanceof ConnectorTaskError && current.code == 'connector.connection-required') return 'needs_reauth'
  }
}
