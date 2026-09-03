import type { FlowCatalogEvent, FlowChangeEvent, PublishOperation } from '@oomol-lab/open-flow/control-api'
import type { ConnectorCapability, JsonValue, RevisionContent, TriggerNode, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { IntegrationDefinition } from '@oomol-lab/open-flow/integration-trigger'
import type { PollDefinition } from '@oomol-lab/open-flow/poll-trigger'
import type { ProviderTriggerDefinition } from '@oomol-lab/open-flow/provider-triggers'
import type { ProjectedRunEvent } from '@oomol-lab/open-flow/run-events'
import type { InvokeLlmTask, RuntimeCapabilityCall, RuntimeCapabilityResponse } from '@oomol-lab/open-flow/runtime-contract'
import type { FlowRunOutcome, FlowRunResult, TaskInvocation } from '@oomol-lab/open-flow/scheduler'
import type { Logger } from 'pino'
import type { ConnectorHost } from './connector.ts'
import type { IntegrationOptions, IntegrationResponse, IntegrationRuntimeState, IntegrationTarget } from './integration-runtime.ts'
import type { PublicationStore } from './publication-store.ts'
import type { PublicationAcceptance, RunEvent, RunRecord, StoredRun } from './store.ts'
import type { PollState, RunAdmission, StoredCronTarget } from './trigger-store.ts'

import { normalizeConnectorRuntimeInputs } from '@oomol-lab/open-flow/connector-action'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { nextTriggerScheduledAt, scheduledTriggerOccurrenceId, validateTriggerSchedule } from '@oomol-lab/open-flow/cron-trigger'
import { canonicalJsonBytes, digestBytes, encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { matchesSchema, prepareFlow, triggerPayloadSchema, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { triggerDefinitions as providerTriggerDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { createEventProjector } from '@oomol-lab/open-flow/run-events'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FiberMap from 'effect/FiberMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import { createHash } from 'node:crypto'
import { ConnectorClient, ConnectorTaskError } from './connector.ts'
import { ControlService } from './control-service.ts'
import { AcceptanceError, ControlError } from './error.ts'
import { IntegrationRuntime } from './integration-runtime.ts'
import { isolatedVmEngineDigest, IsolatedVmHost } from './isolated-vm.ts'
import { errorKind, silentLogger } from './logger.ts'
import { migrateDatabase } from './migrate.ts'
import { PollRuntime } from './poll-runtime.ts'
import { publishPending } from './publication-store.ts'
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
  readonly revisionDigest?: string
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
  readonly maxConcurrentRuns?: number
  readonly maxPendingRuns?: number
  readonly runEventRetentionMs?: number
  readonly runTimeoutMs?: number
}

export interface ServerCapabilities {
  readonly connector?: () => ConnectorHost | undefined
  readonly connectorConsoleOrigin?: () => URL | undefined
  readonly integration?: () => IntegrationOptions | undefined
  readonly llm?: () => InvokeLlmTask | undefined
  readonly waitPublicOrigin?: () => URL | undefined
}

export interface ServerServiceOptions {
  readonly capabilities?: ServerCapabilities
  readonly clock?: Clock.Clock | (() => number)
  readonly logger?: Logger
  readonly runtime?: ServerRuntime
  readonly triggerDefinitions?: readonly ProviderTriggerDefinition[]
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
  'connector.unconfigured',
  'llm.output-invalid',
  'llm.unavailable',
  'node.failed',
])
const cronBatchSize = 100
const maxTimerDelayMs = 2_147_483_647
const maintenanceBatchSize = 100
const maintenanceIntervalMs = 60_000
const maintenanceRetryMs = 1_000
const waitNotificationLeaseMs = 60_000
const waitNotificationMaxAttempts = 3
const admissionRetryMs = 1_000
const defaultMaxConcurrentRuns = 4
const defaultRunTimeoutMs = 30 * 60 * 1_000

function validatePositiveInteger(value: number | undefined, message: string): void {
  if (value != null && (!Number.isSafeInteger(value) || value <= 0)) throw new TypeError(message)
}

function parseOrigin(value: string, label: string): URL {
  const origin = new URL(value)
  if (
    (origin.protocol != 'https:' && !(origin.protocol == 'http:' && ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(origin.hostname))) ||
    origin.username != '' ||
    origin.password != '' ||
    origin.pathname != '/' ||
    origin.search != '' ||
    origin.hash != ''
  ) {
    throw new Error(`${label} must be an HTTPS origin without credentials, a path, query, or fragment, except on loopback.`)
  }
  return origin
}

function validateRuntime(runtime: ServerRuntime): void {
  validatePositiveInteger(runtime.runEventRetentionMs, 'Run event retention must be a positive safe integer number of milliseconds.')
  validatePositiveInteger(runtime.maxPendingRuns, 'Maximum pending Runs must be a positive safe integer.')
  validatePositiveInteger(runtime.maxConcurrentRuns, 'Maximum concurrent Runs must be a positive safe integer.')
  validatePositiveInteger(runtime.runTimeoutMs, 'Run timeout must be a positive safe integer number of milliseconds.')
}

function validateCapabilities(capabilities: ServerCapabilities): void {
  const consoleOrigin = capabilities.connectorConsoleOrigin?.()
  if (consoleOrigin != null) parseOrigin(consoleOrigin.href, 'Connector Console origin')
  const integration = capabilities.integration?.()
  if (integration != null) parseOrigin(integration.publicOrigin, 'Integration public origin')
  const waitPublicOrigin = capabilities.waitPublicOrigin?.()
  if (waitPublicOrigin != null) parseOrigin(waitPublicOrigin.href, 'Wait public origin')
}

function finishWaiters(waiters: readonly Deferred.Deferred<void>[]): Effect.Effect<void> {
  return Effect.forEach(waiters, (deferred) => Deferred.succeed(deferred, undefined), { discard: true })
}

async function loadTeams(
  connector: ConnectorClient,
  signal?: AbortSignal,
): Promise<readonly { readonly id: string; readonly name: string; readonly systemCreated: boolean }[]> {
  try {
    return await connector.listTeams(signal)
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    if (error instanceof ConnectorTaskError) {
      throw new ControlError(controlErrorCode.connectorUnavailable, 'The OOMOL Team list could not be loaded.')
    }
    throw error
  }
}

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
  readonly #clock: () => number
  readonly #clockService: Clock.Clock
  readonly #cronLock: Semaphore.Semaphore
  readonly #integration: IntegrationRuntime
  readonly #isolatedVm: IsolatedVmHost
  readonly #logger: Logger
  readonly #maxConcurrentRuns: number
  readonly #maintenanceLock: Semaphore.Semaphore
  readonly #poll: PollRuntime
  readonly #resolveConnector: () => ConnectorHost | undefined
  readonly #resolveConnectorConsoleOrigin: () => URL | undefined
  readonly #flowCatalogSubscribers = new Set<(event: FlowCatalogEvent) => void>()
  readonly #flowSubscribers = new Map<string, Set<(event: FlowChangeEvent) => void>>()
  readonly #runningFlows = new Set<string>()
  readonly #resolveIntegration: () => IntegrationOptions | undefined
  readonly #runTimeoutMs: number
  readonly #resolveLlm: () => InvokeLlmTask | undefined
  readonly #resolveWaitPublicOrigin: () => URL | undefined
  readonly #signals: Queue.Queue<Deferred.Deferred<void> | undefined>
  readonly #store: Store
  readonly #tasks: FiberMap.FiberMap<string, void, never>
  readonly #workers: FiberMap.FiberMap<string, void, never>
  #cronRetryAt?: number
  #failure?: unknown
  #maintenanceAt = 0
  #started = false

  private constructor(
    resources: {
      readonly clockService: Clock.Clock
      readonly cronLock: Semaphore.Semaphore
      readonly isolatedVm: IsolatedVmHost
      readonly maintenanceLock: Semaphore.Semaphore
      readonly pollLock: Semaphore.Semaphore
      readonly signals: Queue.Queue<Deferred.Deferred<void> | undefined>
      readonly store: Store
      readonly tasks: FiberMap.FiberMap<string, void, never>
      readonly workers: FiberMap.FiberMap<string, void, never>
    },
    capabilities: ServerCapabilities,
    clock: () => number,
    runtime: ServerRuntime,
    logger: Logger,
    triggerDefinitions: readonly ProviderTriggerDefinition[],
  ) {
    const { clockService, cronLock, isolatedVm, maintenanceLock, pollLock, signals, store, tasks, workers } = resources
    this.#clock = clock
    this.#clockService = clockService
    this.#cronLock = cronLock
    this.#isolatedVm = isolatedVm
    this.#logger = logger.child({ component: 'runtime' })
    this.#maintenanceLock = maintenanceLock
    this.#maxConcurrentRuns = runtime.maxConcurrentRuns ?? defaultMaxConcurrentRuns
    this.#resolveConnector = capabilities.connector ?? (() => undefined)
    this.#resolveConnectorConsoleOrigin = capabilities.connectorConsoleOrigin ?? (() => undefined)
    this.#resolveIntegration = capabilities.integration ?? (() => undefined)
    this.#runTimeoutMs = runtime.runTimeoutMs ?? defaultRunTimeoutMs
    this.#resolveLlm = capabilities.llm ?? (() => undefined)
    this.#resolveWaitPublicOrigin = capabilities.waitPublicOrigin ?? (() => undefined)
    this.#signals = signals
    this.#store = store
    this.#tasks = tasks
    this.#workers = workers
    const pollDefinitions = triggerDefinitions.filter((definition): definition is PollDefinition => definition.snapshot.type == 'poll')
    const integrationDefinitions = triggerDefinitions.filter((definition): definition is IntegrationDefinition => definition.snapshot.type == 'integration')
    const snapshots = triggerDefinitions.map((definition) => definition.snapshot).toSorted((left, right) => left.key.localeCompare(right.key))
    this.control = new ControlService(
      store,
      this.#clock,
      (runId) => this.#interrupt(runId),
      () => this.#signal(),
      (input) => this.publishFlow(input),
      (input) => this.acceptPublishOperation(input),
      () => {
        this.#maintenanceAt = this.#clock()
        this.#signal()
      },
      snapshots,
      (flowId, triggerNodeId) => this.#poll.test(flowId, triggerNodeId),
      () => this.#notifyFlowCatalog(),
      (event) => this.#notifyFlow(event),
      () => this.#resolveLlm() != null,
      this.#resolveConnector,
      this.#resolveConnectorConsoleOrigin,
      this.#resolveWaitPublicOrigin,
      (teamId) => this.#connectorTeam(teamId),
    )
    this.#integration = new IntegrationRuntime(
      store,
      this.#resolveConnector,
      this.#clock,
      this.#resolveIntegration,
      integrationDefinitions,
      validatedFlow,
      () => this.#signal(),
      (flowId, runId) => this.#runCreated(flowId, runId),
      logger,
    )
    this.#poll = new PollRuntime(
      store,
      this.#resolveConnector,
      this.#clock,
      this.#clockService,
      pollLock,
      pollDefinitions,
      validatedFlow,
      () => this.#signal(),
      (flowId, runId) => this.#runCreated(flowId, runId),
      logger,
    )
  }

  static open(databaseFile: string, options: ServerServiceOptions = {}): Effect.Effect<ServerService, Error, Scope.Scope> {
    const { capabilities = {}, clock, logger = silentLogger, runtime = {}, triggerDefinitions = providerTriggerDefinitions } = options
    return Effect.gen(function* () {
      const clockService = typeof clock == 'object' ? clock : yield* Clock.Clock
      const now = typeof clock == 'function' ? clock : () => clockService.currentTimeMillisUnsafe()
      yield* Effect.try({
        try: () => {
          validateRuntime(runtime)
          validateCapabilities(capabilities)
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      const store = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            migrateDatabase(databaseFile)
            return new Store(databaseFile, now, runtime.runEventRetentionMs, runtime.maxPendingRuns)
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        (opened) => Effect.sync(() => opened.close()),
      )
      const isolatedVm = yield* Effect.acquireRelease(
        Effect.sync(() => new IsolatedVmHost()),
        (opened) => Effect.promise(() => opened.close()),
      )
      const cronLock = yield* Semaphore.make(1)
      const maintenanceLock = yield* Semaphore.make(1)
      const pollLock = yield* Semaphore.make(1)
      const signals = yield* Queue.unbounded<Deferred.Deferred<void> | undefined>()
      const tasks = yield* FiberMap.make<string, void, never>()
      const workers = yield* FiberMap.make<string, void, never>()
      const service = new ServerService(
        { clockService, cronLock, isolatedVm, maintenanceLock, pollLock, signals, store, tasks, workers },
        capabilities,
        now,
        runtime,
        logger,
        triggerDefinitions,
      )
      return service
    })
  }

  async connectorTeams(signal?: AbortSignal): Promise<{
    readonly bindings: readonly { readonly flowId: string; readonly teamId: string }[]
    readonly enabled: boolean
    readonly teams: readonly { readonly id: string; readonly name: string; readonly systemCreated: boolean }[]
    readonly version: 1
  }> {
    const connector = this.#resolveConnector()
    if (!(connector instanceof ConnectorClient) || !connector.teamSupported()) return { bindings: [], enabled: false, teams: [], version: 1 }
    const teams = await loadTeams(connector, signal)
    const defaultTeam = teams.find((team) => team.systemCreated)
    if (defaultTeam != null) this.#store.bindUnassignedConnectorTeams(defaultTeam.id)
    return { bindings: this.#store.connectorTeamBindings(), enabled: true, teams, version: 1 }
  }

  async #connectorTeam(teamId?: string): Promise<string | undefined> {
    const connector = this.#resolveConnector()
    if (!(connector instanceof ConnectorClient) || !connector.teamSupported()) {
      if (teamId != null) throw new ControlError(controlErrorCode.flowInvalid, 'Connector Team is not available for this deployment.')
      return
    }
    const teams = await loadTeams(connector)
    const selected = teamId == null ? teams.find((team) => team.systemCreated) : teams.find((team) => team.id == teamId)
    if (selected == null) throw new ControlError(controlErrorCode.flowInvalid, 'The selected OOMOL Team is not available.')
    return selected.id
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
    if (accepted != null) this.#signal()
    return accepted
  }

  async publishFlow(input: PublishFlowInput): Promise<PublicationAcceptance> {
    const planned = await this.#publication(input)
    const accepted = this.#store.publications.publish(planned)
    this.#signal()
    return accepted
  }

  async acceptPublishOperation(input: PublishFlowInput): Promise<PublishOperation> {
    if (input.revisionDigest != null) {
      const replay = this.#store.publications.replayPublishOperation(
        input.flowId,
        input.idempotencyKey,
        await this.#publicationRequestDigest(input, input.revisionDigest),
      )
      if (replay?.kind == 'accepted') return replay.operation
      if (replay?.kind == 'conflict') {
        throw new ControlError(controlErrorCode.publicationConflict, 'The idempotency key refers to another Publish request.')
      }
    }
    const accepted = this.#store.publications.acceptPublishOperation(await this.#publication(input))
    switch (accepted.kind) {
      case 'accepted':
        this.#maintenanceAt = this.#clock()
        this.#signal()
        return accepted.operation
      case 'binding-unresolved':
        throw new ControlError(controlErrorCode.bindingUnresolved, 'A required Variable is unresolved.')
      case 'busy':
        throw new ControlError(controlErrorCode.flowBusy, 'Another Publish operation is already pending for this Flow.')
      case 'conflict':
        throw new ControlError(controlErrorCode.publicationConflict, 'The idempotency key refers to another Publish request.')
      case 'live-conflict':
        throw new ControlError(controlErrorCode.liveConflict, 'The Flow Live pointer no longer matches the expected Publication.')
      case 'not-found':
        throw new ControlError(controlErrorCode.flowNotFound, 'The Flow was not found.')
      case 'revision-conflict':
        throw new ControlError(controlErrorCode.flowRevisionConflict, 'The Draft changed.')
      case 'unsupported':
        throw new ControlError(controlErrorCode.publicationUnsupported, 'The existing Integration subscription cannot be changed safely during Publish.')
    }
  }

  async #publication(input: PublishFlowInput): Promise<Parameters<PublicationStore['publish']>[0]> {
    const fixed = await validatedFlow(input.revision)
    const engineContract = input.engineContract ?? currentEngineContract
    if (input.revisionDigest != null && input.revisionDigest != fixed.revisionDigest) {
      throw new AcceptanceError('revision-conflict', 'The fixed Revision digest does not match its content.')
    }
    if (Object.values(fixed.prepared.graph.nodes).some((node) => node.kind == 'wait' && node.notification != null) && this.#resolveWaitPublicOrigin() == null) {
      throw new ControlError(controlErrorCode.flowInvalid, 'Wait notification requires OPEN_FLOW_PUBLIC_ORIGIN.')
    }
    const requestDigest = await this.#publicationRequestDigest(input, fixed.revisionDigest)
    const publishedAt = this.#clock()
    const integrations = this.#integration.bindings(input.revision, fixed.prepared, publishedAt)
    const connectorTasks = Object.values(fixed.prepared.tasks).flatMap((task) =>
      'executor' in task && task.executor.kind == 'connector' ? [task.executor] : [],
    )
    const providerTriggers = Object.values(fixed.prepared.graph.nodes).filter(
      (trigger): trigger is Extract<TriggerNode, { readonly kind: 'integration' | 'poll' }> => trigger.kind == 'integration' || trigger.kind == 'poll',
    )
    if (connectorTasks.length > 0 || providerTriggers.length > 0) {
      const connector = this.#resolveConnector()
      if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
      const teamId = this.#store.connectorTeam(input.flowId)
      const actionRequests = new Map<string, ReturnType<ConnectorHost['getAction']>>()
      const connectionRequests = new Map<string, ReturnType<ConnectorHost['listConnections']>>()
      const action = (actionId: string): ReturnType<ConnectorHost['getAction']> => {
        const existing = actionRequests.get(actionId)
        if (existing != null) return existing
        const request = connector.getAction(actionId, undefined, teamId)
        actionRequests.set(actionId, request)
        return request
      }
      const connections = (serviceId: string): ReturnType<ConnectorHost['listConnections']> => {
        const existing = connectionRequests.get(serviceId)
        if (existing != null) return existing
        const request = connector.listConnections(serviceId, undefined, teamId)
        connectionRequests.set(serviceId, request)
        return request
      }
      await Promise.all([
        ...connectorTasks.map(async (executor) => {
          const definition = await action(executor.action)
          if (!definition.authenticated && executor.connectionId == null) return
          if (executor.connectionId == null) {
            throw new ConnectorTaskError('connector.connection-required', 'The Connector Task requires a Connection before it can be published.')
          }
          const available = await connections(definition.serviceId)
          if (!available.some((candidate) => candidate.connectionId == executor.connectionId && candidate.status == 'active')) {
            throw new ConnectorTaskError('connector.connection-required', 'The selected Connector Connection must be reconnected or replaced.')
          }
        }),
        ...providerTriggers.map(async (trigger) => {
          const binding = input.revision.document.bindings[trigger.bindingId]
          if (binding?.kind != 'connection') {
            throw new ConnectorTaskError('connector.connection-required', 'The Trigger requires a Connection before it can be published.')
          }
          const available = await connections(trigger.definition.provider)
          if (!available.some((candidate) => candidate.connectionId == binding.target && candidate.status == 'active')) {
            throw new ConnectorTaskError('connector.connection-required', 'The selected Connector Connection must be reconnected or replaced.')
          }
        }),
      ])
    }
    const webhooks = Object.entries(fixed.prepared.graph.nodes)
      .filter((entry): entry is [string, Extract<TriggerNode, { readonly kind: 'webhook' }>] => entry[1].kind == 'webhook')
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([triggerNodeId, trigger]) => ({ triggerJson: JSON.stringify(trigger), triggerNodeId }))
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
        if (!this.#poll.supports(trigger.definition.key, trigger.definition.definitionVersion)) {
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
    return {
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
      variableNames: Object.values(fixed.variableBindings),
      webhooks,
    }
  }

  async #publicationRequestDigest(input: PublishFlowInput, revisionDigest: string): Promise<string> {
    return await digestBytes(
      canonicalJsonBytes({
        engineContract: input.engineContract ?? currentEngineContract,
        expectedLivePublicationId: input.expectedLivePublicationId,
        flowId: input.flowId,
        operation: input.control?.operation ?? 'publish',
        revisionDigest,
        ...(input.control?.operation == 'rollback' ? { sourcePublicationId: input.control.sourcePublicationId } : {}),
      }),
    )
  }

  cancel(runId: string): boolean {
    const committed = this.#store.cancel(runId)
    if (committed) {
      this.#interrupt(runId)
      this.#logger.info({ category: 'run.canceled', runId }, 'Run canceled.')
    }
    return committed
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
    const connector = this.#resolveConnector()
    return this.#started && this.#failure == null && (connector == null || (await connector.ready()))
  }

  configurationChanged(): void {
    this.#maintenanceAt = this.#clock()
    this.#signal()
  }

  run(runId: string): RunRecord | undefined {
    return this.#store.run(runId)
  }

  start(): Effect.Effect<void, never, Scope.Scope> {
    return Effect.gen({ self: this }, function* () {
      yield* Effect.promise(async () => {
        try {
          const teamId = await this.#connectorTeam()
          if (teamId != null) this.#store.bindUnassignedConnectorTeams(teamId)
        } catch (error) {
          this.#logger.warn({ category: 'connector.team.resolve-failed', err: error }, 'Default OOMOL Team could not be resolved.')
        }
      })
      this.#started = true
      yield* Effect.addFinalizer(() => Effect.sync(() => (this.#started = false)))
      this.#maintenanceAt = this.#clock()
      yield* this.#supervise().pipe(Effect.forkScoped)
      this.#signal()
    }).pipe(Effect.provideService(Clock.Clock, this.#clockService))
  }

  #run(effect: Effect.Effect<void, unknown>): Promise<void> {
    return Effect.runPromise(effect.pipe(Effect.provideService(Clock.Clock, this.#clockService)))
  }

  tickCron(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return this.#run(this.#cron(at))
  }

  tickPoll(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return this.#run(this.#poll.tick(at))
  }

  tickIntegration(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return this.#run(this.#integration.tick(at))
  }

  tickMaintenance(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return this.#run(this.#maintenance(at))
  }

  pollState(flowId: string, triggerNodeId: string): PollState | undefined {
    return this.#poll.state(flowId, triggerNodeId)
  }

  processPollOccurrence(input: PollOccurrenceInput): Promise<void> {
    return this.#poll.process(input)
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
    if (this.#failure != null) throw this.#failure
    if (this.#started) {
      await Effect.runPromise(
        Effect.gen({ self: this }, function* () {
          const settled = yield* Deferred.make<void>()
          yield* Queue.offer(this.#signals, settled)
          yield* Deferred.await(settled)
        }),
      )
    } else {
      await Effect.runPromise(FiberMap.awaitEmpty(this.#tasks))
      await Effect.runPromise(FiberMap.awaitEmpty(this.#workers))
    }
    if (this.#failure != null) throw this.#failure
  }

  #dispatch(run: StoredRun): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const prepared = yield* this.#prepareRun(run)
      if (prepared == null) return
      yield* this.#executeRun(run, prepared.flow, prepared.bindingValues, prepared.projectEvent)
    })
  }

  #loadRun(run: StoredRun): Effect.Effect<
    | { readonly kind: 'binding-unresolved' }
    | {
        readonly bindingValues: Readonly<Record<string, string>>
        readonly flow: PreparedFlow
        readonly kind: 'prepared'
        readonly projectEvent: ReturnType<typeof createEventProjector>
        readonly started: ProjectedRunEvent | undefined
      },
    unknown
  > {
    return Effect.gen({ self: this }, function* () {
      if (run.engineDigest != isolatedVmEngineDigest) {
        return yield* Effect.fail(new Error('Fixed Run Engine implementation is not available.'))
      }
      const revisionDigest = yield* Effect.tryPromise({
        try: () => digestBytes(encoder.encode(run.content)),
        catch: (error) => error,
      })
      if (revisionDigest != run.revisionDigest) {
        return yield* Effect.fail(new Error('Fixed Flow Revision digest does not match stored content.'))
      }
      const revision = JSON.parse(run.content) as RevisionContent
      const prepared = yield* Effect.tryPromise({
        try: () => prepareFlow(revision, run.engineContract),
        catch: (error) => error,
      })
      if (prepared.kind != 'prepared') {
        return yield* Effect.fail(new Error(`Fixed Flow Revision can no longer be prepared: ${prepared.kind}.`))
      }
      const projectEvent = createEventProjector(run.runId, nodeFailureCodes)
      const started = yield* Effect.tryPromise({
        try: () => projectEvent({ flowId: run.flowId, runId: run.runId, type: 'run.started' }),
        catch: (error) => error,
      })
      if (run.resume != null) {
        const resume = run.resume
        const saved = resume.checkpoint.wait
        const wait = prepared.flow.graph.nodes[saved.nodeId]
        if (wait?.kind != 'wait' || !wait.actions.some((action) => action == resume.action)) {
          return yield* Effect.fail(new Error('Stored Wait resolution does not match the fixed Flow Revision.'))
        }
        return {
          bindingValues: run.resume.checkpoint.bindingValues,
          flow: prepared.flow,
          kind: 'prepared' as const,
          projectEvent,
          started,
        }
      }
      const bindingValues = this.#store.resolveVariables(variableBindings(revision, prepared.validation.closure.dependencies.inputBindings))
      if (bindingValues == null) return { kind: 'binding-unresolved' as const }
      return { bindingValues, flow: prepared.flow, kind: 'prepared' as const, projectEvent, started }
    })
  }

  #prepareRun(run: StoredRun): Effect.Effect<
    | {
        readonly bindingValues: Readonly<Record<string, string>>
        readonly flow: PreparedFlow
        readonly projectEvent: ReturnType<typeof createEventProjector>
      }
    | undefined
  > {
    return Effect.gen({ self: this }, function* () {
      if (run.resumeUnavailable) {
        if (
          this.#store.failResume(run.runId, {
            error: { code: 'execution.resume-unavailable', message: 'The stored Wait checkpoint is unavailable.' },
          })
        ) {
          this.#runChanged(run.flowId, run.runId)
        }
        return
      }
      const start = yield* this.#loadRun(run).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.sync(() => {
              const committed =
                run.resume == null
                  ? this.#store.failStarting(run.runId, {
                      error: { code: 'execution.unavailable', message: 'The fixed Run could not be started by this deployment.' },
                    })
                  : this.#store.failResume(run.runId, {
                      error: { code: 'execution.resume-unavailable', message: 'The stored Wait checkpoint cannot resume against the fixed Flow.' },
                    })
              if (committed) {
                this.#runChanged(run.flowId, run.runId)
                this.#logger.error({ category: 'run.start_failed', flowId: run.flowId, runId: run.runId, ...errorKind(error) }, 'Run could not be started.')
              }
            }).pipe(Effect.as(undefined)),
          onSuccess: Effect.succeed,
        }),
      )
      if (start?.kind == 'binding-unresolved') {
        this.#store.failStarting(run.runId, {
          error: { code: controlErrorCode.bindingUnresolved, message: 'A required Variable is unresolved.' },
        })
        return
      }
      if (start == null || start.started == null) return
      const started = run.resume == null ? this.#store.start(run.runId, start.started) : this.#store.resume(run.runId, run.resume.checkpoint.wait.waitId)
      if (!started) return
      return { bindingValues: start.bindingValues, flow: start.flow, projectEvent: start.projectEvent }
    })
  }

  #executeRun(
    run: StoredRun,
    flow: PreparedFlow,
    bindingValues: Readonly<Record<string, string>>,
    projectEvent: ReturnType<typeof createEventProjector>,
  ): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const startedAt = performance.now()
      const budgetMs = run.remainingMs ?? this.#runTimeoutMs
      this.#logger.info({ category: 'run.started', flowId: run.flowId, runId: run.runId }, 'Run started.')

      const timeoutReason = new Error('Run exceeded its execution deadline.')
      let timedOut = false
      yield* this.#isolatedVm
        .run(flow, {
          capability: (capabilities, call) => this.#invokeCapability(capabilities, call, run.connectorTeamId),
          emit: async (event) => {
            if (event.type == 'run.started' && event.runId == run.runId) return
            const projected = await projectEvent(event)
            if (projected != null) this.#store.append(run.runId, projected)
          },
          flowId: run.flowId,
          ...(run.resume == null ? { bindingValues, inputs: run.inputs } : { resume: run.resume }),
          invokeTask: (invocation) => {
            if (!('taskId' in invocation)) throw new Error('Runtime Executor returned a Code Task to the Host.')
            return this.#invokeTask(flow, invocation, run.connectorTeamId)
          },
          projectFailure: (error) => {
            if (error instanceof ConnectorTaskError) return { code: error.code, message: error.message }
            if (error instanceof TaskHostError) return { code: error.code, message: error.message }
            return { code: 'node.failed', message: error instanceof Error ? error.message : String(error) }
          },
          runId: run.runId,
          ...(run.resume != null || run.trigger == null ? {} : { trigger: run.trigger }),
        })
        .pipe(
          Effect.timeoutOrElse({
            duration: budgetMs,
            orElse: () =>
              Effect.sync(() => {
                timedOut = true
              }).pipe(Effect.andThen(Effect.fail(timeoutReason))),
          }),
          Effect.matchEffect({
            onFailure: (error) => Effect.sync(() => this.#failRun(run, startedAt, timedOut, error)),
            onSuccess: (output) => Effect.sync(() => this.#commitOutcome(run, flow, startedAt, budgetMs, output)),
          }),
        )
    })
  }

  #commitOutcome(run: StoredRun, flow: PreparedFlow, startedAt: number, budgetMs: number, output: FlowRunOutcome): void {
    if (output.kind == 'waiting') {
      const remainingMs = Math.max(0, budgetMs - Math.round(performance.now() - startedAt))
      let notification:
        | {
            readonly action: string
            readonly connectionId?: string
            readonly input: Readonly<Record<string, JsonValue>>
            readonly messageHandle: string
            readonly prompt: string
            readonly publicOrigin: string
            readonly taskId: string
          }
        | undefined
      if (output.notification != null) {
        const wait = flow.graph.nodes[output.wait.nodeId]
        const task = flow.tasks[output.notification.taskId]
        const publicOrigin = this.#resolveWaitPublicOrigin()
        if (wait?.kind != 'wait' || task == null || task.executor.kind != 'connector' || publicOrigin == null) {
          this.#failRun(run, startedAt, false, new Error('Wait notification is unavailable.'))
          return
        }
        notification = {
          action: task.executor.action,
          connectionId: task.executor.connectionId,
          input: normalizeConnectorRuntimeInputs(
            task.inputs.filter((input) => 'handle' in input),
            output.notification.input,
          ),
          messageHandle: output.notification.messageHandle,
          prompt: wait.prompt,
          publicOrigin: publicOrigin.href,
          taskId: output.notification.taskId,
        }
      }
      if (this.#store.wait(run.runId, output, remainingMs, notification) == null) return
      this.#runChanged(run.flowId, run.runId)
      this.#maintenanceAt = this.#clock()
      this.#signal()
      this.#logger.info(
        { category: 'run.waiting', durationMs: Math.round(performance.now() - startedAt), flowId: run.flowId, runId: run.runId, waitId: output.wait.waitId },
        'Run is waiting.',
      )
      return
    }
    this.#completeRun(run, startedAt, output)
  }

  #failRun(run: StoredRun, startedAt: number, timedOut: boolean, error: unknown): void {
    const result = timedOut
      ? { error: { code: 'run.timeout', message: 'The Run exceeded its execution deadline.' } }
      : { error: { code: 'run.failed', message: 'The Flow could not be completed.' } }
    if (!this.#store.commit(run.runId, 'failed', result)) return
    this.#runChanged(run.flowId, run.runId)
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

  #completeRun(run: StoredRun, startedAt: number, output: FlowRunResult): void {
    if (!this.#store.commit(run.runId, 'completed', output)) return
    this.#runChanged(run.flowId, run.runId)
    this.#logger.info(
      { category: 'run.completed', durationMs: Math.round(performance.now() - startedAt), flowId: run.flowId, runId: run.runId },
      'Run completed.',
    )
  }

  #admitCron(target: StoredCronTarget, now: number): Effect.Effect<'admitted' | 'overloaded', unknown> {
    return Effect.gen({ self: this }, function* () {
      const fixed = yield* Effect.tryPromise({
        try: () => validatedFlow(JSON.parse(target.content) as RevisionContent),
        catch: (error) => error,
      })
      const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
      if (
        fixed.revisionDigest != target.revisionDigest ||
        fixed.prepared.closureDigest != target.closureDigest ||
        trigger?.kind != 'cron' ||
        JSON.stringify(trigger) != target.triggerJson ||
        JSON.stringify(trigger.cronTimes) != target.scheduleJson
      ) {
        return yield* Effect.fail(new Error('Fixed Cron Trigger target does not match its Publication.'))
      }
      const scheduledAt = new Date(target.nextAt).toISOString()
      const occurrenceId = yield* Effect.tryPromise({
        try: () => scheduledTriggerOccurrenceId(target.bindingId, target.runtimeVersion, scheduledAt),
        catch: (error) => error,
      })
      const requestDigest = yield* Effect.tryPromise({
        try: () =>
          digestBytes(
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
          ),
        catch: (error) => error,
      })
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
      if (accepted != null) this.#signal()
      return 'admitted'
    })
  }

  #cron(at: string): Effect.Effect<void, unknown> {
    return this.#cronLock.withPermit(
      Effect.gen({ self: this }, function* () {
        const now = Date.parse(at)
        if (!Number.isFinite(now)) return yield* Effect.fail(new TypeError('Cron tick time must be an ISO timestamp.'))
        while (true) {
          const targets = this.#store.triggers.dueCron(now, cronBatchSize)
          if (targets.length == 0) break
          let overloaded = false
          for (const target of targets) {
            const result = yield* this.#admitCron(target, now)
            if (result == 'overloaded') {
              overloaded = true
              break
            }
          }
          if (overloaded) break
        }
        this.#signal()
      }),
    )
  }

  #maintenance(at: string): Effect.Effect<void, unknown> {
    return this.#maintenanceLock.withPermit(
      Effect.gen({ self: this }, function* () {
        const now = Date.parse(at)
        if (!Number.isFinite(now)) return yield* Effect.fail(new TypeError('Maintenance tick time must be an ISO timestamp.'))
        const notification = this.#store.claimWaitNotification(now, waitNotificationLeaseMs)
        if (notification != null) {
          const connector = this.#resolveConnector()
          if (connector == null) {
            this.#store.releaseWaitNotification(
              notification.runId,
              notification.waitId,
              notification.claimId,
              now + maintenanceRetryMs,
              waitNotificationMaxAttempts,
            )
          } else {
            yield* Effect.tryPromise({
              try: (signal) =>
                connector.execute(notification.action, notification.connectionId, notification.input, notification.invocationId, signal, notification.teamId),
              catch: (error) => error,
            }).pipe(
              Effect.matchEffect({
                onFailure: (error) =>
                  Effect.sync(() => {
                    if (error instanceof ConnectorTaskError && (error.code == 'connector.action-not-found' || error.code == 'connector.connection-required')) {
                      this.#store.finishWaitNotification(notification.runId, notification.waitId, notification.claimId, false)
                    } else {
                      this.#store.releaseWaitNotification(
                        notification.runId,
                        notification.waitId,
                        notification.claimId,
                        now + maintenanceRetryMs,
                        waitNotificationMaxAttempts,
                      )
                    }
                    this.#logger.warn({ category: 'wait.notification.failed', runId: notification.runId, ...errorKind(error) }, 'Wait notification failed.')
                  }),
                onSuccess: () =>
                  Effect.sync(() => {
                    this.#store.finishWaitNotification(notification.runId, notification.waitId, notification.claimId, true)
                    this.#logger.info({ category: 'wait.notification.delivered', runId: notification.runId }, 'Wait notification was delivered.')
                  }),
              }),
            )
          }
        }
        let nextDelay = this.#maintain(now)
        const nextNotificationAt = this.#store.nextWaitNotificationAt()
        if (nextNotificationAt != null) nextDelay = Math.min(nextDelay, Math.max(0, nextNotificationAt - now))
        this.#maintenanceAt = this.#clock() + nextDelay
        this.#signal()
      }),
    )
  }

  async #invokeTask(
    prepared: PreparedFlow,
    invocation: Extract<TaskInvocation, { readonly taskId: string }> & { readonly signal: AbortSignal },
    teamId?: string,
  ): Promise<JsonValue> {
    const task = prepared.tasks[invocation.taskId]!
    const executor = task.executor
    switch (executor.kind) {
      case 'connector':
        const connector = this.#resolveConnector()
        if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
        return await connector.execute(
          executor.action,
          executor.connectionId,
          normalizeConnectorRuntimeInputs(
            task.inputs.filter((input) => 'handle' in input),
            invocation.input,
          ),
          invocation.invocationId,
          invocation.signal,
          teamId,
        )
      case 'llm':
        const llm = this.#resolveLlm()
        if (llm == null) throw new TaskHostError('llm.unavailable', 'The LLM request could not be completed.')
        let result
        try {
          result = await llm({
            input: Object.assign({}, invocation.additionalInputs, invocation.input),
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

  async #invokeCapability(capabilities: readonly ConnectorCapability[], call: RuntimeCapabilityCall, teamId?: string): Promise<RuntimeCapabilityResponse> {
    if (call.kind != 'connector') throw new TaskHostError('capability.denied', 'The Runtime Capability is not declared for this Task.')
    const payload = connectorCapabilityPayload(call.payload)
    if (!capabilities.some((capability) => capability.action == payload.action && capability.connectionId == payload.connectionId)) {
      throw new TaskHostError('capability.denied', 'The Runtime Capability is not declared for this Task.')
    }
    const connector = this.#resolveConnector()
    if (connector == null) throw new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.')
    return {
      body: await connector.execute(payload.action, payload.connectionId, payload.input, call.invocationId, call.signal, teamId),
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

  #runChanged(flowId: string, runId: string): void {
    this.#notifyFlow({ flowId, kind: 'run.changed', runId, version: 1 })
  }

  #maintain(now: number): number {
    let publishCount = 0
    for (; publishCount < maintenanceBatchSize; publishCount += 1) {
      const target = this.#store.publications.nextPublishOperation(now)
      if (target == null) break
      if (target.kind == 'failed') {
        const { operationId, ...issue } = target
        this.#store.publications.failPublishOperation(operationId, issue)
        this.#logger.warn({ category: 'publication.failed', operationId, ...issue }, 'Publish operation failed.')
        continue
      }
      const input = JSON.parse(target.input) as Parameters<PublicationStore['publish']>[0]
      let accepted: PublicationAcceptance
      try {
        accepted = this.#store.publications.publish({ ...input, operationId: target.operationId, publishedAt: now })
      } catch (error) {
        if (error === publishPending) return maintenanceRetryMs
        throw error
      }
      switch (accepted.kind) {
        case 'published':
          this.#logger.info(
            { category: 'publication.succeeded', operationId: target.operationId, publicationId: accepted.publicationId },
            'Publish operation succeeded.',
          )
          break
        case 'binding-unresolved':
          this.#store.publications.failPublishOperation(target.operationId, {
            code: controlErrorCode.bindingUnresolved,
            message: 'A required Variable is unresolved.',
          })
          break
        case 'busy':
          this.#store.publications.failPublishOperation(target.operationId, { code: controlErrorCode.flowBusy, message: 'The Flow is retiring.' })
          break
        case 'conflict':
          this.#store.publications.failPublishOperation(target.operationId, {
            code: controlErrorCode.publicationConflict,
            message: 'The idempotency key refers to another Publication request.',
          })
          break
        case 'live-conflict':
          this.#store.publications.failPublishOperation(target.operationId, {
            code: controlErrorCode.liveConflict,
            message: 'The Flow Live pointer no longer matches the expected Publication.',
          })
          break
        case 'not-found':
          this.#store.publications.failPublishOperation(target.operationId, { code: controlErrorCode.flowNotFound, message: 'The Flow was not found.' })
          break
        case 'revision-conflict':
          this.#store.publications.failPublishOperation(target.operationId, { code: controlErrorCode.flowRevisionConflict, message: 'The Draft changed.' })
          break
        case 'source-not-found':
          this.#store.publications.failPublishOperation(target.operationId, {
            code: controlErrorCode.publicationNotFound,
            message: 'The source Publication was not found.',
          })
          break
        case 'operation-pending':
          return maintenanceRetryMs
      }
    }
    let nextDelay = publishCount == maintenanceBatchSize || this.#store.pruneExpiredEvents(now, maintenanceBatchSize) > 0 ? 0 : maintenanceIntervalMs
    if (this.#store.publications.prunePublishOperations(now, maintenanceBatchSize) > 0) nextDelay = 0
    const expiredWaits = this.#store.expireWaits(now, maintenanceBatchSize)
    for (const { flowId, runId } of expiredWaits) this.#runChanged(flowId, runId)
    if (expiredWaits.length == maintenanceBatchSize) nextDelay = 0
    const flowId = this.#store.claimRetiringFlow(now)
    if (flowId == null) {
      if (this.#store.collectOrphanRevisions(maintenanceBatchSize) > 0) nextDelay = 0
      return nextDelay
    }

    const canceled = this.#store.cancelFlowRuns(flowId, maintenanceBatchSize)
    for (const runId of canceled) this.#interrupt(runId)
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

  #signal(): void {
    Queue.offerUnsafe(this.#signals, undefined)
  }

  #interrupt(runId: string): void {
    const worker = Option.getOrUndefined(FiberMap.getUnsafe(this.#workers, runId))
    if (worker != null) Effect.runFork(Fiber.interrupt(worker))
  }

  #supervise(): Effect.Effect<void> {
    const waiters: Deferred.Deferred<void>[] = []
    const program = Effect.gen({ self: this }, function* () {
      while (this.#failure == null) {
        for (const signal of yield* Queue.clear(this.#signals)) if (signal != null) waiters.push(signal)
        yield* this.#startDue(this.#clock())
        const runQueueEmpty = yield* this.#launchWorkers()
        const tasks = yield* FiberMap.size(this.#tasks)
        const workers = yield* FiberMap.size(this.#workers)
        if (waiters.length > 0 && runQueueEmpty && tasks == 0 && workers == 0) {
          yield* finishWaiters(waiters.splice(0))
        }
        if (this.#failure != null) break
        const signal = yield* Effect.race(Queue.take(this.#signals), Effect.sleep(this.#nextDelay(this.#clock())).pipe(Effect.as(undefined)))
        if (signal != null) waiters.push(signal)
      }
      yield* FiberMap.awaitEmpty(this.#tasks)
      yield* FiberMap.awaitEmpty(this.#workers)
      for (const signal of yield* Queue.clear(this.#signals)) if (signal != null) waiters.push(signal)
      yield* finishWaiters(waiters.splice(0))
    })
    return program.pipe(
      Effect.catchCause((cause) =>
        Effect.gen({ self: this }, function* () {
          if (!Cause.hasInterruptsOnly(cause)) this.#fail('runtime.supervisor.failed', Cause.squash(cause))
          for (const signal of yield* Queue.clear(this.#signals)) if (signal != null) waiters.push(signal)
          yield* finishWaiters(waiters.splice(0))
        }),
      ),
    )
  }

  #startDue(now: number): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const cronAt = this.#store.triggers.nextCronAt()
      if (!FiberMap.hasUnsafe(this.#tasks, 'cron') && cronAt != null && Math.max(cronAt, this.#cronRetryAt ?? cronAt) <= now) {
        yield* this.#startTask('cron', 'trigger.cron.loop.failed', this.#cron(new Date(now).toISOString()))
      }
      const integrationAt = this.#store.integrations.nextIntegrationAt()
      if (!FiberMap.hasUnsafe(this.#tasks, 'integration') && integrationAt != null && integrationAt <= now) {
        yield* this.#startTask('integration', 'trigger.integration.loop.failed', this.#integration.tick(new Date(now).toISOString()))
      }
      const pollAt = this.#store.polls.nextPollAt()
      if (!FiberMap.hasUnsafe(this.#tasks, 'poll') && pollAt != null && pollAt <= now) {
        yield* this.#startTask('poll', 'trigger.poll.loop.failed', this.#poll.tick(new Date(now).toISOString()))
      }
      if (!FiberMap.hasUnsafe(this.#tasks, 'maintenance') && this.#maintenanceAt <= now) {
        yield* this.#startTask('maintenance', 'maintenance.loop.failed', this.#maintenance(new Date(now).toISOString()))
      }
    })
  }

  #startTask(key: string, category: string, task: Effect.Effect<void, unknown>): Effect.Effect<void> {
    return FiberMap.run(
      this.#tasks,
      key,
      task.pipe(Effect.catchCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => this.#fail(category, Cause.squash(cause)))))),
    ).pipe(Effect.asVoid)
  }

  #launchWorkers(): Effect.Effect<boolean> {
    return Effect.gen({ self: this }, function* () {
      while (this.#failure == null && (yield* FiberMap.size(this.#workers)) < this.#maxConcurrentRuns) {
        const run = this.#store.claim([...this.#runningFlows])
        if (run == null) return true
        this.#runningFlows.add(run.flowId)
        yield* FiberMap.run(
          this.#workers,
          run.runId,
          this.#dispatch(run).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.sync(() => this.#fail('runtime.worker.failed', Cause.squash(cause))),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                this.#runningFlows.delete(run.flowId)
                this.#signal()
              }),
            ),
          ),
        )
      }
      return false
    })
  }

  #nextDelay(now: number): number {
    const deadlines: number[] = []
    if (!FiberMap.hasUnsafe(this.#tasks, 'maintenance')) deadlines.push(this.#maintenanceAt)
    const waitExpiry = this.#store.nextWaitExpiry()
    if (waitExpiry != null) deadlines.push(waitExpiry)
    const waitNotificationAt = this.#store.nextWaitNotificationAt()
    if (waitNotificationAt != null) deadlines.push(waitNotificationAt)
    if (!FiberMap.hasUnsafe(this.#tasks, 'cron')) {
      const nextAt = this.#store.triggers.nextCronAt()
      if (nextAt != null) deadlines.push(Math.max(nextAt, this.#cronRetryAt ?? nextAt))
    }
    if (!FiberMap.hasUnsafe(this.#tasks, 'integration')) {
      const nextAt = this.#store.integrations.nextIntegrationAt()
      if (nextAt != null) deadlines.push(nextAt)
    }
    if (!FiberMap.hasUnsafe(this.#tasks, 'poll')) {
      const nextAt = this.#store.polls.nextPollAt()
      if (nextAt != null) deadlines.push(nextAt)
    }
    return deadlines.length == 0 ? maxTimerDelayMs : Math.max(0, Math.min(Math.min(...deadlines) - now, maxTimerDelayMs))
  }

  #fail(category: string, error: unknown): void {
    if (this.#failure != null) return
    this.#failure = error
    this.#logger.error({ category, err: error }, 'Server background processing stopped.')
    this.#signal()
  }

  inspectWaitAction(
    capability: string,
    requested: WaitAction,
  ): { readonly action: WaitAction; readonly expiresAt: string; readonly prompt: string; readonly state: 'resolved' | 'waiting' } | undefined {
    const receipt = this.#store.waitByCapability(createHash('sha256').update(capability).digest('hex'))
    if (receipt == null) return
    const revision = this.#store.revision(receipt.flowId, receipt.revisionId)
    if (revision == null) return
    const node = (JSON.parse(revision.content) as RevisionContent).document.graph.nodes[receipt.nodeId]
    if (node?.kind != 'wait' || !node.actions.some((action) => action == requested)) return
    if (receipt.action != null) {
      return { action: receipt.action, expiresAt: new Date(receipt.expiresAt).toISOString(), prompt: node.prompt, state: 'resolved' }
    }
    if (receipt.status != 'waiting' || receipt.expiresAt <= this.#clock()) return
    return { action: requested, expiresAt: new Date(receipt.expiresAt).toISOString(), prompt: node.prompt, state: 'waiting' }
  }

  resolveWaitAction(
    capability: string,
    requested: WaitAction,
  ):
    | {
        readonly action: WaitAction | null
        readonly resolutionAccepted: boolean
        readonly resolvedAt: string | null
        readonly state: 'resolved' | 'unavailable' | 'waiting'
      }
    | undefined {
    const receipt = this.#store.waitByCapability(createHash('sha256').update(capability).digest('hex'))
    if (receipt == null) return
    const revision = this.#store.revision(receipt.flowId, receipt.revisionId)
    if (revision == null) return
    const node = (JSON.parse(revision.content) as RevisionContent).document.graph.nodes[receipt.nodeId]
    if (node?.kind != 'wait' || !node.actions.some((action) => action == requested)) return
    const result = this.#store.resolveWait(receipt.runId, receipt.waitId, requested, node.actions)
    if (result.kind != 'resolved') return
    if (result.changed) {
      this.#runChanged(receipt.flowId, receipt.runId)
      if (result.status == 'queued') this.#signal()
    }
    return {
      action: result.action,
      resolutionAccepted: result.resolutionAccepted,
      resolvedAt: result.resolvedAt == null ? null : new Date(result.resolvedAt).toISOString(),
      state: result.action != null ? 'resolved' : result.status == 'waiting' ? 'waiting' : 'unavailable',
    }
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

async function validatedFlow(revision: RevisionContent): Promise<{
  readonly content: string
  readonly prepared: PreparedFlow
  readonly revisionDigest: string
  readonly variableBindings: Readonly<Record<string, string>>
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
        variableBindings: variableBindings(revision, prepared.validation.closure.dependencies.inputBindings),
      }
    }
  }
}
