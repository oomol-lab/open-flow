import type { FlowCatalogEvent, FlowChangeEvent } from '@oomol-lab/open-flow/control-api'
import type { ConnectorCapability, JsonValue, RevisionContent, TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { IntegrationDefinition } from '@oomol-lab/open-flow/integration-trigger'
import type { PollDefinition } from '@oomol-lab/open-flow/poll-trigger'
import type { ProviderTriggerDefinition } from '@oomol-lab/open-flow/provider-triggers'
import type { ProjectedRunEvent } from '@oomol-lab/open-flow/run-events'
import type { InvokeLlmTask, RuntimeCapabilityCall, RuntimeCapabilityResponse } from '@oomol-lab/open-flow/runtime-contract'
import type { TaskInvocation } from '@oomol-lab/open-flow/scheduler'
import type { Logger } from 'pino'
import type { ConnectorHost } from './connector.ts'
import type { IntegrationOptions, IntegrationResponse, IntegrationRuntimeState, IntegrationTarget } from './integration-runtime.ts'
import type { PublicationAcceptance, RunEvent, RunRecord, StoredRun } from './store.ts'
import type { PollState, RunAdmission, StoredCronTarget, StoredPollTarget } from './trigger-store.ts'

import { normalizeConnectorRuntimeInputs } from '@oomol-lab/open-flow/connector-action'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { nextTriggerScheduledAt, scheduledTriggerOccurrenceId, validateTriggerSchedule } from '@oomol-lab/open-flow/cron-trigger'
import { canonicalJsonBytes, digestBytes, encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { createRuntimeProgram, matchesSchema, prepareFlow, triggerPayloadSchema } from '@oomol-lab/open-flow/flow-semantics'
import {
  maximumPollCheckpointBytes,
  maximumPollEventsPerPage,
  PermanentPollError,
  pollPageClaimId,
  providerEventId,
  PollConnectionError,
} from '@oomol-lab/open-flow/poll-trigger'
import { triggerDefinitions as providerTriggerDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { createEventProjector } from '@oomol-lab/open-flow/run-events'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { runFlow } from '@oomol-lab/open-flow/scheduler'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FiberMap from 'effect/FiberMap'
import * as FiberSet from 'effect/FiberSet'
import * as Scope from 'effect/Scope'
import { randomUUID } from 'node:crypto'
import { ConnectorTaskError } from './connector.ts'
import { ControlService } from './control-service.ts'
import { AcceptanceError, ControlError, serverErrorCode } from './error.ts'
import { IntegrationRuntime } from './integration-runtime.ts'
import { IsolatedVmError, isolatedVmEngineDigest, IsolatedVmHost } from './isolated-vm.ts'
import { errorKind, silentLogger } from './logger.ts'
import { migrateDatabase } from './migrate.ts'
import { Store } from './store.ts'

interface PublishFlowInput {
  readonly control?:
    | { readonly actorId: string; readonly operation: 'publish' }
    | { readonly actorId: string; readonly operation: 'rollback'; readonly sourcePublicationId: string }
  readonly engineContract?: string
  readonly expectedLivePublicationId: string | null
  readonly flowId: string
  readonly idempotencyKey: string
  readonly revision: RevisionContent
  readonly revisionId: string
}

type PublicationMetadata =
  | { readonly actorId: string; readonly modelVersion: number; readonly operation: 'publish' }
  | { readonly actorId: string; readonly modelVersion: number; readonly operation: 'rollback'; readonly sourcePublicationId: string }

interface PollOccurrenceInput {
  readonly bindingId: string
  readonly occurredAt: string
  readonly occurrenceId: string
  readonly runtimeVersion: number
}

export interface ServerRuntime {
  readonly integration?: IntegrationOptions
  readonly llm?: InvokeLlmTask
  readonly maxConcurrentRuns?: number
  readonly maxPendingRuns?: number
  readonly runEventRetentionMs?: number
  readonly runTimeoutMs?: number
}

interface WebhookTarget {
  readonly closureDigest: string
  readonly endpointId: string
  readonly engineContract: string
  readonly flowId: string
  readonly publicationId: string
  readonly revision: RevisionContent
  readonly revisionDigest: string
  readonly revisionId: string
  readonly runtimeVersion: number
  readonly trigger: Extract<TriggerNode, { readonly kind: 'webhook' }>
  readonly triggerNodeId: string
}

const encoder = new TextEncoder()
const nodeFailureCodes: ReadonlySet<string> = new Set([
  'capability.denied',
  'capability.invalid',
  'connector.connection-required',
  'connector.unavailable',
  'llm.output-invalid',
  'llm.unavailable',
  'node.failed',
])
const cronBatchSize = 100
const pollBatchSize = 100
const pollClaimRetentionMs = 30 * 24 * 60 * 60 * 1000
const pollLeaseMs = 60_000
const pollRetryMs = 1_000
const maxTimerDelayMs = 2_147_483_647
const maintenanceBatchSize = 100
const maintenanceIntervalMs = 60_000
const maintenanceRetryMs = 1_000
const admissionRetryMs = 1_000
const defaultMaxConcurrentRuns = 4
const defaultRunTimeoutMs = 30 * 60 * 1_000

type TaskErrorCode = 'capability.denied' | 'capability.invalid' | 'llm.output-invalid' | 'llm.unavailable'

class TaskHostError extends Error {
  readonly code: TaskErrorCode

  constructor(code: TaskErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'TaskHostError'
  }
}

export class ServerService {
  readonly control: ControlService
  readonly #active = new Map<string, AbortController>()
  readonly #clock: () => number
  readonly #connector?: ConnectorHost
  readonly #integration: IntegrationRuntime
  readonly #isolatedVm = new IsolatedVmHost()
  readonly #logger: Logger
  readonly #llm?: InvokeLlmTask
  readonly #maxConcurrentRuns: number
  readonly #pollDefinitions: ReadonlyMap<string, PollDefinition>
  readonly #scope = Scope.makeUnsafe('parallel')
  readonly #flowCatalogSubscribers = new Set<(event: FlowCatalogEvent) => void>()
  readonly #flowSubscribers = new Map<string, Set<(event: FlowChangeEvent) => void>>()
  readonly #runningFlows = new Set<string>()
  readonly #runTimeoutMs: number
  readonly #store: Store
  readonly #timers = Effect.runSync(FiberMap.make<string>().pipe(Scope.provide(this.#scope)))
  readonly #workers = Effect.runSync(FiberSet.make<void>().pipe(Scope.provide(this.#scope)))
  #cronTicking?: Promise<void>
  #cronRetryAt?: number
  #failure?: unknown
  #maintenanceTicking?: Promise<void>
  #pollTicking?: Promise<void>
  #started = false

  private constructor(
    store: Store,
    connector: ConnectorHost | undefined,
    clock: () => number,
    runtime: ServerRuntime,
    connectorConsoleOrigin: URL | undefined,
    logger: Logger,
    triggerDefinitions: readonly ProviderTriggerDefinition[],
  ) {
    this.#clock = clock
    this.#connector = connector
    this.#logger = logger.child({ component: 'runtime' })
    this.#llm = runtime.llm
    this.#maxConcurrentRuns = runtime.maxConcurrentRuns ?? defaultMaxConcurrentRuns
    this.#runTimeoutMs = runtime.runTimeoutMs ?? defaultRunTimeoutMs
    const pollDefinitions = triggerDefinitions.filter((definition): definition is PollDefinition => definition.snapshot.type == 'poll')
    const integrationDefinitions = triggerDefinitions.filter((definition): definition is IntegrationDefinition => definition.snapshot.type == 'integration')
    this.#pollDefinitions = new Map(pollDefinitions.map((definition) => [definition.snapshot.key, definition]))
    this.#store = store
    const snapshots = triggerDefinitions.map((definition) => definition.snapshot).toSorted((left, right) => left.key.localeCompare(right.key))
    this.control = new ControlService(
      store,
      clock,
      (runId) => this.#active.get(runId)?.abort(new Error('Run canceled.')),
      () => this.#wake(),
      (input) => this.publishFlow(input),
      () => {
        this.#armCron()
        this.#integration.arm()
        this.#armPoll()
        this.#armMaintenance(0)
      },
      snapshots,
      (flowId, triggerNodeId) => this.#testPollTrigger(flowId, triggerNodeId),
      () => this.#notifyFlowCatalog(),
      (event) => this.#notifyFlow(event),
      connector,
      connectorConsoleOrigin,
    )
    this.#integration = new IntegrationRuntime(
      store,
      this.#scope,
      connector,
      clock,
      runtime.integration,
      integrationDefinitions,
      validatedFlow,
      () => this.#wake(),
      (flowId, runId) => this.#runCreated(flowId, runId),
      logger,
    )
  }

  static open(
    databaseFile: string,
    connector?: ConnectorHost,
    clock: () => number = Date.now,
    runtime: ServerRuntime = {},
    connectorConsoleOrigin?: string,
    logger: Logger = silentLogger,
    triggerDefinitions: readonly ProviderTriggerDefinition[] = providerTriggerDefinitions,
  ): ServerService {
    if (runtime.runEventRetentionMs != null && (!Number.isSafeInteger(runtime.runEventRetentionMs) || runtime.runEventRetentionMs <= 0)) {
      throw new TypeError('Run event retention must be a positive safe integer number of milliseconds.')
    }
    if (runtime.maxPendingRuns != null && (!Number.isSafeInteger(runtime.maxPendingRuns) || runtime.maxPendingRuns <= 0)) {
      throw new TypeError('Maximum pending Runs must be a positive safe integer.')
    }
    if (runtime.maxConcurrentRuns != null && (!Number.isSafeInteger(runtime.maxConcurrentRuns) || runtime.maxConcurrentRuns <= 0)) {
      throw new TypeError('Maximum concurrent Runs must be a positive safe integer.')
    }
    if (runtime.runTimeoutMs != null && (!Number.isSafeInteger(runtime.runTimeoutMs) || runtime.runTimeoutMs <= 0)) {
      throw new TypeError('Run timeout must be a positive safe integer number of milliseconds.')
    }
    if (runtime.integration != null) {
      const publicOrigin = new URL(runtime.integration.publicOrigin)
      if (
        (publicOrigin.protocol != 'https:' &&
          !(publicOrigin.protocol == 'http:' && ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(publicOrigin.hostname))) ||
        publicOrigin.username != '' ||
        publicOrigin.password != '' ||
        publicOrigin.pathname != '/' ||
        publicOrigin.search != '' ||
        publicOrigin.hash != ''
      ) {
        throw new Error('Integration public origin must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.')
      }
    }
    let consoleOrigin: URL | undefined
    if (connectorConsoleOrigin != null) {
      consoleOrigin = new URL(connectorConsoleOrigin)
      if (
        (consoleOrigin.protocol != 'https:' &&
          !(consoleOrigin.protocol == 'http:' && ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(consoleOrigin.hostname))) ||
        consoleOrigin.username != '' ||
        consoleOrigin.password != '' ||
        consoleOrigin.pathname != '/' ||
        consoleOrigin.search != '' ||
        consoleOrigin.hash != ''
      ) {
        throw new Error('Connector Console origin must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.')
      }
    }
    migrateDatabase(databaseFile)
    return new ServerService(
      new Store(databaseFile, clock, runtime.runEventRetentionMs, runtime.maxPendingRuns),
      connector,
      clock,
      runtime,
      consoleOrigin,
      logger,
      triggerDefinitions,
    )
  }

  async #testPollTrigger(
    flowId: string,
    triggerNodeId: string,
  ): Promise<{
    readonly events: readonly Readonly<Record<string, JsonValue>>[]
    readonly filtered: number
    readonly hasMore: boolean
    readonly version: 1
  }> {
    const target = this.#store.triggers.pollTestTarget(flowId, triggerNodeId)
    if (target == null) throw new ControlError(controlErrorCode.triggerNotFound, 'The Trigger binding was not found.')
    try {
      const revision = JSON.parse(target.content) as RevisionContent
      const fixed = await validatedFlow(revision)
      const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
      if (
        fixed.revisionDigest != target.revisionDigest ||
        fixed.prepared.closureDigest != target.closureDigest ||
        trigger?.kind != 'poll' ||
        JSON.stringify(trigger) != target.triggerJson
      ) {
        throw new PermanentPollError('Fixed Poll Trigger target does not match its Publication.')
      }
      const definition = this.#pollDefinitions.get(trigger.definition.key)
      if (definition?.snapshot.definitionVersion != trigger.definition.definitionVersion) {
        throw new PermanentPollError('Fixed Poll Trigger definition is not available.')
      }
      const connection = revision.document.bindings[trigger.bindingId]
      if (connection?.kind != 'connection' || connection.target != target.connectionId) {
        throw new ControlError(controlErrorCode.bindingUnresolved, 'The fixed Poll Trigger Connection is unresolved.')
      }
      const connector = this.#connector
      if (connector == null) throw new ControlError(controlErrorCode.connectorUnavailable, 'The Connector request could not be completed.')
      const signal = AbortSignal.timeout(30_000)
      const result = await definition.poll({
        checkpoint: target.checkpoint,
        config: trigger.config,
        connector: {
          execute: async (request, requestSignal) =>
            await connector.proxy(definition.snapshot.provider, target.connectionId, target.bindingId, request, requestSignal ?? signal),
        },
        now: new Date(this.#clock()),
        signal,
      })
      if (result.events.length > maximumPollEventsPerPage) {
        throw new PermanentPollError(`Poll page exceeds ${maximumPollEventsPerPage} events.`)
      }
      return {
        events: result.events.map((event) => event.payload),
        filtered: result.filtered ?? 0,
        hasMore: result.hasMore == true,
        version: 1,
      }
    } catch (error) {
      if (error instanceof ControlError) throw error
      if (error instanceof PollConnectionError || (error instanceof ConnectorTaskError && error.code == 'connector.connection-required')) {
        throw new ControlError(serverErrorCode.connectorConnectionRequired, 'The Poll Trigger Connection requires reauthorization.')
      }
      if (error instanceof PermanentPollError) throw new ControlError(controlErrorCode.triggerKeyInvalid, error.message)
      throw new ControlError(controlErrorCode.connectorUnavailable, 'The Connector request could not be completed.')
    }
  }

  async acceptWebhookTarget(target: WebhookTarget, occurrenceId: string, payload: JsonValue): Promise<RunAdmission | undefined> {
    const fixed = await validatedFlow(target.revision)
    const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
    if (
      fixed.revisionDigest != target.revisionDigest ||
      fixed.prepared.closureDigest != target.closureDigest ||
      trigger?.kind != 'webhook' ||
      JSON.stringify(trigger) != JSON.stringify(target.trigger)
    ) {
      return
    }
    if (!matchesSchema(payload, triggerPayloadSchema(trigger))) {
      throw new AcceptanceError('trigger-payload-invalid', 'Webhook payload does not match the fixed Trigger schema.')
    }
    const requestDigest = await digestBytes(
      canonicalJsonBytes({
        endpointId: target.endpointId,
        flowId: target.flowId,
        kind: 'webhook',
        occurrenceId,
        payload,
        publicationId: target.publicationId,
        revisionDigest: fixed.revisionDigest,
        runtimeVersion: target.runtimeVersion,
        triggerNodeId: target.triggerNodeId,
      }),
    )
    const accepted = this.#store.triggers.acceptWebhookTarget({
      closureDigest: target.closureDigest,
      content: fixed.content,
      endpointId: target.endpointId,
      engineContract: target.engineContract,
      flowId: target.flowId,
      modelVersion: target.revision.modelVersion,
      occurrenceId,
      payload,
      publicationId: target.publicationId,
      requestDigest,
      revisionDigest: fixed.revisionDigest,
      revisionId: target.revisionId,
      runtimeVersion: target.runtimeVersion,
      triggerJson: JSON.stringify(trigger),
      triggerNodeId: target.triggerNodeId,
    })
    if (accepted?.kind == 'accepted' && accepted.created) this.#runCreated(target.flowId, accepted.runId)
    if (accepted != null) this.#wake()
    return accepted
  }

  async publishFlow(input: PublishFlowInput): Promise<PublicationAcceptance> {
    const fixed = await validatedFlow(input.revision)
    const engineContract = input.engineContract ?? currentEngineContract
    const requestDigest = await digestBytes(
      canonicalJsonBytes({
        engineContract,
        expectedLivePublicationId: input.expectedLivePublicationId,
        flowId: input.flowId,
        operation: input.control?.operation ?? 'publish',
        revisionDigest: fixed.revisionDigest,
        ...(input.control?.operation == 'rollback' ? { sourcePublicationId: input.control.sourcePublicationId } : {}),
      }),
    )
    const webhooks = Object.entries(fixed.prepared.graph.nodes)
      .filter((entry): entry is [string, Extract<TriggerNode, { readonly kind: 'webhook' }>] => entry[1].kind == 'webhook')
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([triggerNodeId, trigger]) => ({ triggerJson: JSON.stringify(trigger), triggerNodeId }))
    const publishedAt = this.#clock()
    const crons = Object.entries(fixed.prepared.graph.nodes)
      .filter((entry): entry is [string, Extract<TriggerNode, { readonly kind: 'cron' }>] => entry[1].kind == 'cron')
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([triggerNodeId, trigger]) => {
        try {
          validateTriggerSchedule(trigger.cronTimes)
        } catch (error) {
          throw new AcceptanceError('trigger-invalid', error instanceof Error ? error.message : 'Cron Trigger schedule is invalid.')
        }
        return {
          nextAt: nextTriggerScheduledAt(trigger.cronTimes, publishedAt),
          scheduleJson: JSON.stringify(trigger.cronTimes),
          triggerJson: JSON.stringify(trigger),
          triggerNodeId,
        }
      })
    const polls = Object.entries(fixed.prepared.graph.nodes)
      .filter((entry): entry is [string, Extract<TriggerNode, { readonly kind: 'poll' }>] => entry[1].kind == 'poll')
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([triggerNodeId, trigger]) => {
        try {
          validateTriggerSchedule(trigger.pollTimes)
        } catch (error) {
          throw new AcceptanceError('trigger-invalid', error instanceof Error ? error.message : 'Poll Trigger schedule is invalid.')
        }
        const definition = this.#pollDefinitions.get(trigger.definition.key)
        if (definition?.snapshot.definitionVersion != trigger.definition.definitionVersion) {
          throw new AcceptanceError('trigger-invalid', 'Poll Trigger definition is not available.')
        }
        const binding = input.revision.document.bindings[trigger.bindingId]
        if (binding?.kind != 'connection' || binding.target.length == 0) {
          throw new AcceptanceError('trigger-invalid', 'Poll Trigger Connection is unresolved.')
        }
        return {
          connectionId: binding.target,
          nextAt: nextTriggerScheduledAt(trigger.pollTimes, publishedAt),
          scheduleJson: JSON.stringify(trigger.pollTimes),
          triggerJson: JSON.stringify(trigger),
          triggerNodeId,
        }
      })
    const integrations = this.#integration.bindings(input.revision, fixed.prepared, publishedAt)
    let metadata: PublicationMetadata | undefined
    if (input.control?.operation == 'publish') {
      metadata = { actorId: input.control.actorId, modelVersion: input.revision.modelVersion, operation: 'publish' }
    } else if (input.control?.operation == 'rollback') {
      metadata = {
        actorId: input.control.actorId,
        modelVersion: input.revision.modelVersion,
        operation: 'rollback',
        sourcePublicationId: input.control.sourcePublicationId,
      }
    }
    const accepted = this.#store.publish({
      closureDigest: fixed.prepared.closureDigest,
      content: fixed.content,
      crons,
      engineContract,
      expectedLivePublicationId: input.expectedLivePublicationId,
      flowId: input.flowId,
      idempotencyKey: input.idempotencyKey,
      integrations,
      ...(metadata == null ? {} : { metadata }),
      polls,
      publishedAt,
      requestDigest,
      revisionDigest: fixed.revisionDigest,
      revisionId: input.revisionId,
      webhooks,
    })
    this.#armCron()
    this.#integration.arm()
    this.#armPoll()
    return accepted
  }

  cancel(runId: string): boolean {
    const committed = this.#store.cancel(runId)
    if (committed) {
      this.#active.get(runId)?.abort(new Error('Run canceled.'))
      this.#logger.info({ category: 'run.canceled', runId }, 'Run canceled.')
    }
    return committed
  }

  async close(): Promise<void> {
    this.#started = false
    this.#integration.stop()
    try {
      await Effect.runPromise(FiberMap.clear(this.#timers))
      await this.waitForIdle()
    } finally {
      await Effect.runPromise(Scope.close(this.#scope, Exit.void))
      await this.#isolatedVm.close()
      this.#store.close()
    }
  }

  subscribeFlow(flowId: string, listener: (event: FlowChangeEvent) => void): () => void {
    this.control.getFlow(flowId)
    const subscribers = this.#flowSubscribers.get(flowId) ?? new Set<(event: FlowChangeEvent) => void>()
    subscribers.add(listener)
    this.#flowSubscribers.set(flowId, subscribers)
    return () => {
      subscribers.delete(listener)
      if (subscribers.size == 0) this.#flowSubscribers.delete(flowId)
    }
  }

  subscribeFlowCatalog(listener: (event: FlowCatalogEvent) => void): () => void {
    this.#flowCatalogSubscribers.add(listener)
    return () => this.#flowCatalogSubscribers.delete(listener)
  }

  events(runId: string): readonly RunEvent[] {
    if (this.#store.eventsExpired(runId, this.#clock())) {
      throw new ControlError(controlErrorCode.runEventsExpired, 'The Run event history has expired.')
    }
    return this.#store.events(runId)
  }

  async ready(): Promise<boolean> {
    return this.#started && this.#failure == null && this.#integration.ready() && (this.#connector == null || (await this.#connector.ready()))
  }

  run(runId: string): RunRecord | undefined {
    return this.#store.run(runId)
  }

  start(): void {
    this.#started = true
    this.#armCron()
    this.#integration.start()
    this.#armPoll()
    this.#armMaintenance(0)
    this.#wake()
  }

  async tickCron(at = new Date(this.#clock()).toISOString()): Promise<void> {
    const now = Date.parse(at)
    if (!Number.isFinite(now)) throw new TypeError('Cron tick time must be an ISO timestamp.')
    const previous = this.#cronTicking
    const ticking = (previous ?? Promise.resolve()).then(() => this.#tickCron(now))
    this.#cronTicking = ticking
    let succeeded = false
    try {
      await ticking
      succeeded = true
    } finally {
      if (this.#cronTicking == ticking) {
        this.#cronTicking = undefined
        if (succeeded) this.#armCron()
      }
    }
  }

  async tickPoll(at = new Date(this.#clock()).toISOString()): Promise<void> {
    const now = Date.parse(at)
    if (!Number.isFinite(now)) throw new TypeError('Poll tick time must be an ISO timestamp.')
    const previous = this.#pollTicking
    const ticking = (previous ?? Promise.resolve()).then(() => this.#tickPoll(now))
    this.#pollTicking = ticking
    let succeeded = false
    try {
      await ticking
      succeeded = true
    } finally {
      if (this.#pollTicking == ticking) {
        this.#pollTicking = undefined
        if (succeeded) this.#armPoll()
      }
    }
  }

  async tickIntegration(at = new Date(this.#clock()).toISOString()): Promise<void> {
    await this.#integration.tick(at)
  }

  async tickMaintenance(at = new Date(this.#clock()).toISOString()): Promise<void> {
    const now = Date.parse(at)
    if (!Number.isFinite(now)) throw new TypeError('Maintenance tick time must be an ISO timestamp.')
    const previous = this.#maintenanceTicking
    let nextDelay = maintenanceIntervalMs
    const ticking = (previous ?? Promise.resolve()).then(() => {
      nextDelay = this.#maintain(now)
    })
    this.#maintenanceTicking = ticking
    let succeeded = false
    try {
      await ticking
      succeeded = true
    } finally {
      if (this.#maintenanceTicking == ticking) {
        this.#maintenanceTicking = undefined
        if (succeeded) this.#armMaintenance(nextDelay)
      }
    }
  }

  pollState(flowId: string, triggerNodeId: string): PollState | undefined {
    return this.#store.triggers.pollState(flowId, triggerNodeId)
  }

  async processPollOccurrence(input: PollOccurrenceInput): Promise<void> {
    const now = Date.parse(input.occurredAt)
    if (!Number.isFinite(now)) throw new TypeError('Poll occurrence time must be an ISO timestamp.')
    const previous = this.#pollTicking
    const ticking = (previous ?? Promise.resolve()).then(async () => {
      const target = this.#store.triggers.pollTarget(input.bindingId, input.runtimeVersion)
      if (target != null) await this.#poll(target, input.occurrenceId, now)
    })
    this.#pollTicking = ticking
    let succeeded = false
    try {
      await ticking
      succeeded = true
    } finally {
      if (this.#pollTicking == ticking) {
        this.#pollTicking = undefined
        if (succeeded) this.#armPoll()
      }
    }
  }

  integrationEndpoint(flowId: string, triggerNodeId: string): string | undefined {
    return this.#integration.endpoint(flowId, triggerNodeId)
  }

  integrationState(flowId: string, triggerNodeId: string): IntegrationRuntimeState | undefined {
    return this.#integration.state(flowId, triggerNodeId)
  }

  integrationTarget(endpointId: string): IntegrationTarget | undefined {
    return this.#integration.target(endpointId)
  }

  async receiveIntegrationTarget(target: IntegrationTarget, input: Parameters<IntegrationRuntime['receive']>[1]): Promise<IntegrationResponse> {
    return await this.#integration.receive(target, input)
  }

  webhookTarget(endpointId: string): WebhookTarget | undefined {
    const stored = this.#store.triggers.webhookTarget(endpointId)
    if (stored == null) return
    const { content, triggerJson, ...target } = stored
    return {
      ...target,
      revision: JSON.parse(content) as RevisionContent,
      trigger: JSON.parse(triggerJson) as Extract<TriggerNode, { readonly kind: 'webhook' }>,
    }
  }

  webhookEndpoint(flowId: string, triggerNodeId: string): string | undefined {
    return this.#store.triggers.webhookEndpoint(flowId, triggerNodeId)
  }

  async waitForIdle(): Promise<void> {
    while (this.#cronTicking != null) await this.#cronTicking
    await this.#integration.waitForIdle()
    while (this.#pollTicking != null) await this.#pollTicking
    while (this.#maintenanceTicking != null) await this.#maintenanceTicking
    while (Effect.runSync(FiberSet.size(this.#workers)) > 0) await Effect.runPromise(FiberSet.awaitEmpty(this.#workers))
    if (this.#failure != null) throw this.#failure
  }

  async #dispatch(run: StoredRun): Promise<void> {
    let prepared: Awaited<ReturnType<typeof prepareFlow>>
    let projectEvent: ReturnType<typeof createEventProjector>
    let started: ProjectedRunEvent | undefined
    try {
      if (run.engineDigest != isolatedVmEngineDigest) throw new Error('Fixed Run Engine implementation is not available.')
      if ((await digestBytes(encoder.encode(run.content))) != run.revisionDigest) throw new Error('Fixed Flow Revision digest does not match stored content.')
      const revision = JSON.parse(run.content) as RevisionContent
      prepared = await prepareFlow(revision, run.engineContract)
      if (prepared.kind != 'prepared') throw new Error(`Fixed Flow Revision can no longer be prepared: ${prepared.kind}.`)
      projectEvent = createEventProjector(run.runId, nodeFailureCodes)
      started = await projectEvent({ flowId: run.flowId, runId: run.runId, type: 'run.started' })
    } catch (error) {
      if (
        this.#store.failStarting(run.runId, {
          error: { code: 'execution.unavailable', message: 'The fixed Run could not be started by this deployment.' },
        })
      ) {
        this.#logger.error({ category: 'run.start_failed', flowId: run.flowId, runId: run.runId, ...errorKind(error) }, 'Run could not be started.')
      }
      return
    }
    if (started == null || !this.#store.start(run.runId, started)) return
    const startedAt = performance.now()
    this.#logger.info({ category: 'run.started', flowId: run.flowId, runId: run.runId }, 'Run started.')

    const cancellation = new AbortController()
    const timeoutReason = new Error('Run exceeded its execution deadline.')
    const timeout = setTimeout(() => cancellation.abort(timeoutReason), this.#runTimeoutMs)
    this.#active.set(run.runId, cancellation)
    try {
      const output = await runFlow(prepared.flow, {
        createId: randomUUID,
        emit: async (event) => {
          if (event.type == 'run.started' && event.runId == run.runId) return
          const projected = await projectEvent(event)
          if (projected != null) this.#store.append(run.runId, projected)
        },
        flowId: run.flowId,
        inputs: run.inputs,
        invokeTask: (invocation) => this.#invokeTask(prepared.flow, invocation),
        projectFailure: (error) => {
          if (error instanceof ConnectorTaskError) return { code: error.code, message: error.message }
          if (error instanceof TaskHostError) return { code: error.code, message: error.message }
          return { code: 'node.failed', message: error instanceof Error ? error.message : String(error) }
        },
        runId: run.runId,
        signal: cancellation.signal,
        ...(run.trigger == null ? {} : { trigger: run.trigger }),
      })
      if (this.#store.commit(run.runId, 'completed', output)) {
        this.#logger.info(
          { category: 'run.completed', durationMs: Math.round(performance.now() - startedAt), flowId: run.flowId, runId: run.runId },
          'Run completed.',
        )
      }
    } catch (error) {
      const timedOut = cancellation.signal.reason === timeoutReason
      const result = timedOut
        ? { error: { code: 'run.timeout', message: 'The Run exceeded its execution deadline.' } }
        : { error: { code: 'run.failed', message: 'The Flow could not be completed.' } }
      if (this.#store.commit(run.runId, 'failed', result)) {
        this.#logger.error(
          {
            category: timedOut ? 'run.timed_out' : 'run.failed',
            durationMs: Math.round(performance.now() - startedAt),
            flowId: run.flowId,
            runId: run.runId,
            ...errorKind(error),
          },
          'Run failed.',
        )
      }
    } finally {
      clearTimeout(timeout)
      this.#active.delete(run.runId)
    }
  }

  async #admitCron(target: StoredCronTarget, now: number): Promise<'admitted' | 'overloaded'> {
    const fixed = await validatedFlow(JSON.parse(target.content) as RevisionContent)
    const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
    if (
      fixed.revisionDigest != target.revisionDigest ||
      fixed.prepared.closureDigest != target.closureDigest ||
      trigger?.kind != 'cron' ||
      JSON.stringify(trigger) != target.triggerJson ||
      JSON.stringify(trigger.cronTimes) != target.scheduleJson
    ) {
      throw new Error('Fixed Cron Trigger target does not match its Publication.')
    }
    const scheduledAt = new Date(target.nextAt).toISOString()
    const occurrenceId = await scheduledTriggerOccurrenceId(target.bindingId, target.runtimeVersion, scheduledAt)
    const requestDigest = await digestBytes(
      canonicalJsonBytes({
        bindingId: target.bindingId,
        flowId: target.flowId,
        kind: 'cron',
        occurrenceId,
        payload: { scheduledAt },
        publicationId: target.publicationId,
        revisionDigest: fixed.revisionDigest,
        runtimeVersion: target.runtimeVersion,
        triggerNodeId: target.triggerNodeId,
      }),
    )
    const accepted = this.#store.triggers.acceptCronTarget({
      ...target,
      nextScheduledAt: nextTriggerScheduledAt(trigger.cronTimes, now),
      occurrenceId,
      requestDigest,
    })
    if (accepted?.kind == 'overloaded') {
      this.#cronRetryAt = now + admissionRetryMs
      return 'overloaded'
    }
    this.#cronRetryAt = undefined
    if (accepted?.kind == 'accepted' && accepted.created) this.#runCreated(target.flowId, accepted.runId)
    if (accepted != null) this.#wake()
    return 'admitted'
  }

  async #poll(target: StoredPollTarget, occurrenceId: string, now: number): Promise<void> {
    const rootOccurrenceId = target.continuationRootId ?? occurrenceId
    const page = target.continuationRootId == null ? 0 : target.continuationPage
    const claimId = page == 0 ? rootOccurrenceId : await pollPageClaimId(target.bindingId, target.runtimeVersion, rootOccurrenceId, page)
    const claim = this.#store.triggers.claimPoll(target, claimId, now, now + pollLeaseMs)
    if (claim.kind != 'acquired') {
      if (claim.kind == 'completed') this.#wake()
      return
    }

    try {
      const revision = JSON.parse(target.content) as RevisionContent
      const fixed = await validatedFlow(revision)
      const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
      if (
        fixed.revisionDigest != target.revisionDigest ||
        fixed.prepared.closureDigest != target.closureDigest ||
        trigger?.kind != 'poll' ||
        JSON.stringify(trigger) != target.triggerJson ||
        JSON.stringify(trigger.pollTimes) != target.scheduleJson
      ) {
        throw new PermanentPollError('Fixed Poll Trigger target does not match its Publication.')
      }
      const definition = this.#pollDefinitions.get(trigger.definition.key)
      if (definition?.snapshot.definitionVersion != trigger.definition.definitionVersion) {
        throw new PermanentPollError('Fixed Poll Trigger definition is not available.')
      }
      const connection = revision.document.bindings[trigger.bindingId]
      if (connection?.kind != 'connection' || connection.target != target.connectionId) {
        throw new PermanentPollError('Fixed Poll Trigger Connection does not match its Publication.')
      }
      const connector = this.#connector
      if (connector == null) throw new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.')
      const signal = AbortSignal.timeout(30_000)
      const result = await definition.poll({
        checkpoint: target.checkpoint,
        config: trigger.config,
        connector: {
          execute: async (request, requestSignal) =>
            await connector.proxy(definition.snapshot.provider, target.connectionId, target.bindingId, request, requestSignal ?? signal),
        },
        now: new Date(now),
        signal,
      })
      if (result.events.length > maximumPollEventsPerPage) {
        throw new PermanentPollError(`Poll page exceeds ${maximumPollEventsPerPage} events.`)
      }
      const checkpointJson = JSON.stringify(result.checkpoint)
      if (checkpointJson == null || encoder.encode(checkpointJson).byteLength > maximumPollCheckpointBytes) {
        throw new RangeError('Poll checkpoint exceeds 64 KiB.')
      }
      const baseline = target.health == 'initializing'
      const identified = await Promise.all(
        result.events.map(async (event) => ({ event, id: await providerEventId(target.bindingId, definition.snapshot.key, event.dedupeKey) })),
      )
      const known = baseline
        ? new Set<string>()
        : this.#store.triggers.knownPollEvents(
            target.bindingId,
            identified.map((item) => item.id),
          )
      const pageIds = new Set<string>()
      const fresh = baseline
        ? []
        : identified.filter((item) => {
            if (known.has(item.id) || pageIds.has(item.id)) return false
            pageIds.add(item.id)
            return true
          })
      const payload = fresh.length == 0 ? null : ({ events: fresh.map((item) => item.event.payload) } satisfies JsonValue)
      const requestDigest =
        payload == null
          ? null
          : await digestBytes(
              canonicalJsonBytes({
                bindingId: target.bindingId,
                claimId,
                payload,
                revisionDigest: target.revisionDigest,
                runtimeVersion: target.runtimeVersion,
              }),
            )
      const hasMore = result.hasMore == true
      const completed = this.#store.triggers.completePollPage({
        activate: baseline && !hasMore,
        checkpointJson,
        claimExpiresAt: now + pollClaimRetentionMs,
        claimId,
        completedAt: now,
        leaseToken: claim.leaseToken,
        nextAt: hasMore ? target.nextAt : nextTriggerScheduledAt(trigger.pollTimes, now),
        nextContinuationPage: hasMore ? page + 1 : 0,
        nextContinuationRootId: hasMore ? rootOccurrenceId : null,
        page,
        payload,
        providerEventIds: fresh.map((item) => item.id),
        requestDigest,
        rootOccurrenceId,
        target,
      })
      if (completed.kind == 'overloaded') {
        this.#store.triggers.failPollClaim(target.bindingId, target.runtimeVersion, claim.leaseToken, { retryAt: now + admissionRetryMs })
        return
      }
      if (completed.kind == 'completed' && completed.accepted?.kind == 'accepted') {
        if (completed.accepted.created) this.#runCreated(target.flowId, completed.accepted.runId)
        this.#wake()
      }
      if (completed.kind == 'completed' && baseline && !hasMore) {
        this.#logger.info(
          {
            bindingId: target.bindingId,
            category: 'trigger.poll.ready',
            flowId: target.flowId,
            runtimeVersion: target.runtimeVersion,
            triggerNodeId: target.triggerNodeId,
          },
          'Poll Trigger is ready.',
        )
      }
      this.#store.triggers.prunePoll(now, pollBatchSize)
    } catch (error) {
      const failure = pollFailure(error)
      const fields = {
        bindingId: target.bindingId,
        flowId: target.flowId,
        runtimeVersion: target.runtimeVersion,
        triggerNodeId: target.triggerNodeId,
        ...errorKind(error),
      }
      this.#store.triggers.failPollClaim(
        target.bindingId,
        target.runtimeVersion,
        claim.leaseToken,
        failure == null
          ? { retryAt: now + pollRetryMs }
          : { errorCode: failure == 'needs_reauth' ? 'connector.connection-required' : 'trigger-key.invalid', health: failure, now },
      )
      if (failure == null) {
        this.#logger.warn({ category: 'trigger.poll.retrying', retryAt: now + pollRetryMs, ...fields }, 'Poll Trigger will be retried.')
      } else {
        this.#logger.warn({ category: 'trigger.poll.health_changed', health: failure, ...fields }, 'Poll Trigger health changed.')
      }
    }
  }

  async #tickCron(now: number): Promise<void> {
    while (true) {
      const targets = this.#store.triggers.dueCron(now, cronBatchSize)
      if (targets.length == 0) return
      for (const target of targets) if ((await this.#admitCron(target, now)) == 'overloaded') return
    }
  }

  async #tickPoll(now: number): Promise<void> {
    while (true) {
      const targets = this.#store.triggers.duePoll(now, pollBatchSize)
      if (targets.length == 0) return
      for (const target of targets) {
        const scheduledAt = new Date(target.nextAt).toISOString()
        await this.#poll(target, await scheduledTriggerOccurrenceId(target.bindingId, target.runtimeVersion, scheduledAt), now)
      }
    }
  }

  async #invokeTask(prepared: PreparedFlow, invocation: TaskInvocation): Promise<JsonValue> {
    if ('moduleId' in invocation) {
      const program = createRuntimeProgram(prepared, invocation.moduleId, isolatedVmEngineDigest)
      if (program == null) throw new Error('Task Module is not part of the fixed Flow closure.')
      let capabilityFailure: unknown
      try {
        return await this.#isolatedVm.invoke({
          capability: async (call) => {
            try {
              return await this.#invokeCapability(invocation.capabilities, call)
            } catch (error) {
              capabilityFailure = error
              throw error
            }
          },
          input: invocation.input,
          invocationId: invocation.invocationId,
          program,
          signal: invocation.signal,
        })
      } catch (error) {
        if (capabilityFailure != null && error instanceof IsolatedVmError && error.code == 'task-failed') throw capabilityFailure
        throw error
      }
    }

    const task = prepared.tasks[invocation.taskId]!
    const executor = task.executor
    switch (executor.kind) {
      case 'connector':
        if (this.#connector == null) throw new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.')
        return await this.#connector.execute(
          executor.action,
          executor.connectionId!,
          normalizeConnectorRuntimeInputs(task.inputs, invocation.input),
          invocation.invocationId,
          invocation.signal,
        )
      case 'llm':
        if (this.#llm == null) throw new TaskHostError('llm.unavailable', 'The LLM request could not be completed.')
        let result
        try {
          result = await this.#llm({
            input: invocation.input,
            invocationId: invocation.invocationId,
            mode: executor.mode,
            signal: invocation.signal,
            version: 1,
          })
        } catch {
          if (invocation.signal.aborted) throw invocation.signal.reason
          throw new TaskHostError('llm.unavailable', 'The LLM request could not be completed.')
        }
        if (result.kind == 'failed') throw new TaskHostError(result.code, result.message)
        return result.value
    }
  }

  async #invokeCapability(capabilities: readonly ConnectorCapability[], call: RuntimeCapabilityCall): Promise<RuntimeCapabilityResponse> {
    if (call.kind != 'connector') throw new TaskHostError('capability.denied', 'The Runtime Capability is not declared for this Task.')
    const payload = connectorCapabilityPayload(call.payload)
    if (!capabilities.some((capability) => capability.action == payload.action && capability.connectionId == payload.connectionId)) {
      throw new TaskHostError('capability.denied', 'The Runtime Capability is not declared for this Task.')
    }
    if (this.#connector == null) throw new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.')
    return {
      body: await this.#connector.execute(payload.action, payload.connectionId, payload.input, call.invocationId, call.signal),
      status: 200,
    }
  }

  #notifyFlow(event: FlowChangeEvent): void {
    for (const listener of this.#flowSubscribers.get(event.flowId) ?? []) listener(event)
  }

  #notifyFlowCatalog(): void {
    const event = { kind: 'flows.changed', version: 1 } as const
    for (const listener of this.#flowCatalogSubscribers) listener(event)
  }

  #runCreated(flowId: string, runId: string): void {
    this.#notifyFlow({ flowId, kind: 'run.created', runId, version: 1 })
  }

  #maintain(now: number): number {
    let nextDelay = this.#store.pruneExpiredEvents(now, maintenanceBatchSize) == 0 ? maintenanceIntervalMs : 0
    const flowId = this.#store.claimRetiringFlow(now)
    if (flowId == null) {
      if (this.#store.collectOrphanRevisions(maintenanceBatchSize) > 0) nextDelay = 0
      return nextDelay
    }

    const canceled = this.#store.cancelFlowRuns(flowId, maintenanceBatchSize)
    for (const runId of canceled) this.#active.get(runId)?.abort(new Error('Flow retired.'))
    if (canceled.length > 0) return 0
    if (this.#runningFlows.has(flowId)) return maintenanceRetryMs
    if (this.#store.flowHasIntegrationState(flowId)) return nextDelay
    if (this.#store.deleteFlowRuns(flowId, maintenanceBatchSize) > 0) return 0
    if (!this.#store.deleteFlow(flowId)) return nextDelay

    this.#logger.info({ category: 'flow.deleted', flowId }, 'Retired Flow was physically deleted.')
    this.#notifyFlowCatalog()
    if (this.#store.collectOrphanRevisions(maintenanceBatchSize) > 0) return 0
    return nextDelay
  }

  #wake(): void {
    while (this.#started && this.#failure == null && Effect.runSync(FiberSet.size(this.#workers)) < this.#maxConcurrentRuns) {
      const run = this.#store.claim([...this.#runningFlows])
      if (run == null) return
      this.#runningFlows.add(run.flowId)
      const worker = Effect.runSync(
        FiberSet.run(
          this.#workers,
          Effect.tryPromise({ try: () => this.#dispatch(run), catch: (error) => error }).pipe(
            Effect.catchCause((cause) => Effect.sync(() => this.#fail('runtime.worker.failed', Cause.squash(cause)))),
          ),
        ),
      )
      worker.addObserver(() => {
        this.#runningFlows.delete(run.flowId)
        this.#wake()
      })
    }
  }

  #armCron(): void {
    Effect.runSync(FiberMap.remove(this.#timers, 'cron'))
    if (!this.#started || this.#failure != null || this.#cronTicking != null) return
    const nextAt = this.#store.triggers.nextCronAt()
    if (nextAt == null) return
    const delay = Math.max(0, Math.min(Math.max(nextAt, this.#cronRetryAt ?? nextAt) - this.#clock(), maxTimerDelayMs))
    this.#armTimer('cron', delay, 'trigger.cron.loop.failed', () => this.tickCron())
  }

  #armPoll(): void {
    Effect.runSync(FiberMap.remove(this.#timers, 'poll'))
    if (!this.#started || this.#failure != null || this.#pollTicking != null) return
    const nextAt = this.#store.triggers.nextPollAt()
    if (nextAt == null) return
    const delay = Math.max(0, Math.min(nextAt - this.#clock(), maxTimerDelayMs))
    this.#armTimer('poll', delay, 'trigger.poll.loop.failed', () => this.tickPoll())
  }

  #armMaintenance(delay: number): void {
    Effect.runSync(FiberMap.remove(this.#timers, 'maintenance'))
    if (!this.#started || this.#failure != null || this.#maintenanceTicking != null) return
    this.#armTimer('maintenance', delay, 'maintenance.loop.failed', () => this.tickMaintenance())
  }

  #armTimer(key: string, delay: number, category: string, tick: () => Promise<void>): void {
    Effect.runSync(
      FiberMap.run(
        this.#timers,
        key,
        Effect.sleep(delay).pipe(
          Effect.andThen(
            Effect.sync(() => {
              void tick().catch((error: unknown) => this.#fail(category, error))
            }),
          ),
        ),
      ),
    )
  }

  #fail(category: string, error: unknown): void {
    if (this.#failure != null) return
    this.#failure = error
    this.#logger.error({ category, err: error }, 'Server background processing stopped.')
  }
}

function connectorCapabilityPayload(value: JsonValue): {
  readonly action: string
  readonly connectionId: string
  readonly input: Readonly<Record<string, JsonValue>>
} {
  if (value == null || typeof value != 'object' || Array.isArray(value)) {
    throw new TaskHostError('capability.invalid', 'The Runtime Capability request is invalid.')
  }
  const source = value as Readonly<Record<string, JsonValue>>
  const keys = Object.keys(source)
  if (
    keys.length != 3 ||
    !keys.includes('action') ||
    !keys.includes('connectionId') ||
    !keys.includes('input') ||
    typeof source.action != 'string' ||
    source.action.length == 0 ||
    typeof source.connectionId != 'string' ||
    source.connectionId.length == 0 ||
    source.input == null ||
    typeof source.input != 'object' ||
    Array.isArray(source.input)
  ) {
    throw new TaskHostError('capability.invalid', 'The Runtime Capability request is invalid.')
  }
  return { action: source.action, connectionId: source.connectionId, input: source.input as Readonly<Record<string, JsonValue>> }
}

function pollFailure(error: unknown): Extract<PollState['health'], 'failed' | 'needs_reauth'> | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if (current instanceof PollConnectionError) return 'needs_reauth'
    if (current instanceof PermanentPollError) return 'failed'
    if (current instanceof ConnectorTaskError && current.code == 'connector.connection-required') return 'needs_reauth'
  }
}

async function validatedFlow(revision: RevisionContent): Promise<{
  readonly content: string
  readonly prepared: PreparedFlow
  readonly revisionDigest: string
}> {
  let prepared: Awaited<ReturnType<typeof prepareFlow>>
  try {
    prepared = await prepareFlow(revision, currentEngineContract)
  } catch {
    throw new AcceptanceError('revision-invalid', 'Flow Revision is not structurally valid.')
  }
  switch (prepared.kind) {
    case 'engine-unsupported':
      throw new AcceptanceError(prepared.kind, 'Flow Revision requires an unsupported Engine Contract.')
    case 'flow-invalid':
      throw new AcceptanceError(prepared.kind, 'Flow validation failed.')
    case 'prepared': {
      const bytes = encodeRevision(revision)
      return {
        content: new TextDecoder().decode(bytes),
        prepared: prepared.flow,
        revisionDigest: await digestBytes(bytes),
      }
    }
  }
}
