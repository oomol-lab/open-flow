import type { FlowCatalogEvent, FlowChangeEvent } from '@oomol-lab/open-flow/control-api'
import type { ConnectorCapability, JsonValue, RevisionContent, TriggerNode } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { IntegrationDefinition } from '@oomol-lab/open-flow/integration-trigger'
import type { PollDefinition } from '@oomol-lab/open-flow/poll-trigger'
import type { ProviderTriggerDefinition } from '@oomol-lab/open-flow/provider-triggers'
import type { ProjectedRunEvent } from '@oomol-lab/open-flow/run-events'
import type { InvokeLlmTask, RuntimeCapabilityCall, RuntimeCapabilityResponse } from '@oomol-lab/open-flow/runtime-contract'
import type { FlowRunResult, TaskInvocation } from '@oomol-lab/open-flow/scheduler'
import type { Logger } from 'pino'
import type { ConnectorHost } from './connector.ts'
import type { IntegrationOptions, IntegrationResponse, IntegrationRuntimeState, IntegrationTarget } from './integration-runtime.ts'
import type { PublicationAcceptance, RunEvent, RunRecord, StoredRun } from './store.ts'
import type { PollState, RunAdmission, StoredCronTarget, StoredPollTarget } from './trigger-store.ts'

import { normalizeConnectorRuntimeInputs } from '@oomol-lab/open-flow/connector-action'
import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { nextTriggerScheduledAt, scheduledTriggerOccurrenceId, validateTriggerSchedule } from '@oomol-lab/open-flow/cron-trigger'
import { canonicalJsonBytes, digestBytes, encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { matchesSchema, prepareFlow, triggerPayloadSchema, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import {
  maximumPollCheckpointBytes,
  maximumPollEventsPerPage,
  PermanentPollError,
  pollPageClaimId,
  providerEventId,
  PollConnectionError,
  TransientPollError,
} from '@oomol-lab/open-flow/poll-trigger'
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
import { ConnectorClient, ConnectorTaskError } from './connector.ts'
import { ControlService } from './control-service.ts'
import { AcceptanceError, ControlError, serverErrorCode } from './error.ts'
import { IntegrationRuntime } from './integration-runtime.ts'
import { isolatedVmEngineDigest, IsolatedVmHost } from './isolated-vm.ts'
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
const pollTimeoutMs = 30_000
const maxTimerDelayMs = 2_147_483_647
const maintenanceBatchSize = 100
const maintenanceIntervalMs = 60_000
const maintenanceRetryMs = 1_000
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
  if (runtime.integration != null) parseOrigin(runtime.integration.publicOrigin, 'Integration public origin')
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
  readonly #connector?: ConnectorHost
  readonly #cronLock: Semaphore.Semaphore
  readonly #integration: IntegrationRuntime
  readonly #isolatedVm: IsolatedVmHost
  readonly #logger: Logger
  readonly #llm?: InvokeLlmTask
  readonly #maxConcurrentRuns: number
  readonly #maintenanceLock: Semaphore.Semaphore
  readonly #pollDefinitions: ReadonlyMap<string, PollDefinition>
  readonly #pollLock: Semaphore.Semaphore
  readonly #resolveConnectorTeam?: (teamId?: string) => Promise<string>
  readonly #flowCatalogSubscribers = new Set<(event: FlowCatalogEvent) => void>()
  readonly #flowSubscribers = new Map<string, Set<(event: FlowChangeEvent) => void>>()
  readonly #runningFlows = new Set<string>()
  readonly #runTimeoutMs: number
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
    connector: ConnectorHost | undefined,
    clock: Clock.Clock | (() => number),
    runtime: ServerRuntime,
    connectorConsoleOrigin: URL | undefined,
    logger: Logger,
    triggerDefinitions: readonly ProviderTriggerDefinition[],
  ) {
    const { clockService, cronLock, isolatedVm, maintenanceLock, pollLock, signals, store, tasks, workers } = resources
    this.#clock = typeof clock == 'function' ? clock : () => clock.currentTimeMillisUnsafe()
    this.#clockService = clockService
    this.#connector = connector
    this.#cronLock = cronLock
    this.#isolatedVm = isolatedVm
    this.#logger = logger.child({ component: 'runtime' })
    this.#llm = runtime.llm
    this.#maintenanceLock = maintenanceLock
    this.#maxConcurrentRuns = runtime.maxConcurrentRuns ?? defaultMaxConcurrentRuns
    this.#pollLock = pollLock
    this.#resolveConnectorTeam =
      connector instanceof ConnectorClient && connector.teamSupported()
        ? async (teamId) => {
            const teams = await loadTeams(connector)
            const selected = teamId == null ? teams.find((team) => team.systemCreated) : teams.find((team) => team.id == teamId)
            if (selected == null) throw new ControlError(controlErrorCode.flowInvalid, 'The selected OOMOL Team is not available.')
            return selected.id
          }
        : undefined
    this.#runTimeoutMs = runtime.runTimeoutMs ?? defaultRunTimeoutMs
    this.#signals = signals
    this.#store = store
    this.#tasks = tasks
    this.#workers = workers
    const pollDefinitions = triggerDefinitions.filter((definition): definition is PollDefinition => definition.snapshot.type == 'poll')
    const integrationDefinitions = triggerDefinitions.filter((definition): definition is IntegrationDefinition => definition.snapshot.type == 'integration')
    this.#pollDefinitions = new Map(pollDefinitions.map((definition) => [definition.snapshot.key, definition]))
    const snapshots = triggerDefinitions.map((definition) => definition.snapshot).toSorted((left, right) => left.key.localeCompare(right.key))
    this.control = new ControlService(
      store,
      this.#clock,
      (runId) => this.#interrupt(runId),
      () => this.#signal(),
      (input) => this.publishFlow(input),
      () => {
        this.#maintenanceAt = this.#clock()
        this.#signal()
      },
      snapshots,
      (flowId, triggerNodeId) => this.#testPollTrigger(flowId, triggerNodeId),
      () => this.#notifyFlowCatalog(),
      (event) => this.#notifyFlow(event),
      this.#llm != null,
      connector,
      connectorConsoleOrigin,
      this.#resolveConnectorTeam,
    )
    this.#integration = new IntegrationRuntime(
      store,
      connector,
      this.#clock,
      runtime.integration,
      integrationDefinitions,
      validatedFlow,
      () => this.#signal(),
      (flowId, runId) => this.#runCreated(flowId, runId),
      logger,
    )
  }

  static open(
    databaseFile: string,
    connector?: ConnectorHost,
    clock?: Clock.Clock | (() => number),
    runtime: ServerRuntime = {},
    connectorConsoleOrigin?: string,
    logger: Logger = silentLogger,
    triggerDefinitions: readonly ProviderTriggerDefinition[] = providerTriggerDefinitions,
  ): Effect.Effect<ServerService, Error, Scope.Scope> {
    return Effect.gen(function* () {
      const clockService = typeof clock == 'object' ? clock : yield* Clock.Clock
      const serviceClock = clock ?? clockService
      const now = typeof serviceClock == 'function' ? serviceClock : () => serviceClock.currentTimeMillisUnsafe()
      const consoleOrigin = yield* Effect.try({
        try: () => {
          validateRuntime(runtime)
          return connectorConsoleOrigin == null ? undefined : parseOrigin(connectorConsoleOrigin, 'Connector Console origin')
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
        connector,
        serviceClock,
        runtime,
        consoleOrigin,
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
    const connector = this.#connector
    if (!(connector instanceof ConnectorClient) || !connector.teamSupported()) return { bindings: [], enabled: false, teams: [], version: 1 }
    const teams = await loadTeams(connector, signal)
    const defaultTeam = teams.find((team) => team.systemCreated)
    if (defaultTeam != null) this.#store.bindUnassignedConnectorTeams(defaultTeam.id)
    return { bindings: this.#store.connectorTeamBindings(), enabled: true, teams, version: 1 }
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
      const result = await Effect.runPromise(
        Effect.tryPromise({
          try: (signal) =>
            definition.poll({
              checkpoint: target.checkpoint,
              config: trigger.config,
              connector: {
                execute: (request, requestSignal) =>
                  connector.proxy(
                    definition.snapshot.provider,
                    target.connectionId,
                    target.bindingId,
                    request,
                    requestSignal == null ? signal : AbortSignal.any([signal, requestSignal]),
                    this.#store.connectorTeam(flowId),
                  ),
              },
              now: new Date(this.#clock()),
              signal,
            }),
          catch: (error) => error,
        }).pipe(
          Effect.timeoutOrElse({
            duration: pollTimeoutMs,
            orElse: () => Effect.fail(new TransientPollError('Poll Provider exceeded its execution deadline.')),
          }),
          Effect.provideService(Clock.Clock, this.#clockService),
        ),
      )
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
    if (accepted != null) this.#signal()
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
      variableNames: Object.values(fixed.variableBindings),
      webhooks,
    })
    this.#signal()
    return accepted
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
    return this.#started && this.#failure == null && (this.#connector == null || (await this.#connector.ready()))
  }

  run(runId: string): RunRecord | undefined {
    return this.#store.run(runId)
  }

  start(): Effect.Effect<void, never, Scope.Scope> {
    return Effect.gen({ self: this }, function* () {
      if (this.#resolveConnectorTeam != null) {
        const resolveConnectorTeam = this.#resolveConnectorTeam
        yield* Effect.promise(async () => {
          try {
            this.#store.bindUnassignedConnectorTeams(await resolveConnectorTeam())
          } catch (error) {
            this.#logger.warn({ category: 'connector.team.resolve-failed', err: error }, 'Default OOMOL Team could not be resolved.')
          }
        })
      }
      this.#started = true
      yield* Effect.addFinalizer(() => Effect.sync(() => (this.#started = false)))
      this.#maintenanceAt = this.#clock()
      yield* this.#supervise().pipe(Effect.provideService(Clock.Clock, this.#clockService), Effect.forkScoped)
      this.#signal()
    })
  }

  tickCron(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return Effect.runPromise(this.#cron(at).pipe(Effect.provideService(Clock.Clock, this.#clockService)))
  }

  tickPoll(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return Effect.runPromise(this.#pollDue(at).pipe(Effect.provideService(Clock.Clock, this.#clockService)))
  }

  tickIntegration(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return Effect.runPromise(this.#integration.tick(at).pipe(Effect.provideService(Clock.Clock, this.#clockService)))
  }

  tickMaintenance(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return Effect.runPromise(this.#maintenance(at).pipe(Effect.provideService(Clock.Clock, this.#clockService)))
  }

  pollState(flowId: string, triggerNodeId: string): PollState | undefined {
    return this.#store.triggers.pollState(flowId, triggerNodeId)
  }

  processPollOccurrence(input: PollOccurrenceInput): Promise<void> {
    return Effect.runPromise(
      this.#pollLock
        .withPermit(
          Effect.gen({ self: this }, function* () {
            const now = Date.parse(input.occurredAt)
            if (!Number.isFinite(now)) return yield* Effect.fail(new TypeError('Poll occurrence time must be an ISO timestamp.'))
            const target = this.#store.triggers.pollTarget(input.bindingId, input.runtimeVersion)
            if (target != null) yield* this.#poll(target, input.occurrenceId, now)
            this.#signal()
          }),
        )
        .pipe(Effect.provideService(Clock.Clock, this.#clockService)),
    )
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
      const bindingValues = this.#store.resolveVariables(variableBindings(revision, prepared.validation.closure.dependencies.inputBindings))
      if (bindingValues == null) return { kind: 'binding-unresolved' as const }
      const projectEvent = createEventProjector(run.runId, nodeFailureCodes)
      const started = yield* Effect.tryPromise({
        try: () => projectEvent({ flowId: run.flowId, runId: run.runId, type: 'run.started' }),
        catch: (error) => error,
      })
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
      const start = yield* this.#loadRun(run).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.sync(() => {
              if (
                this.#store.failStarting(run.runId, {
                  error: { code: 'execution.unavailable', message: 'The fixed Run could not be started by this deployment.' },
                })
              ) {
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
      if (start == null || start.started == null || !this.#store.start(run.runId, start.started)) return
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
      this.#logger.info({ category: 'run.started', flowId: run.flowId, runId: run.runId }, 'Run started.')

      const timeoutReason = new Error('Run exceeded its execution deadline.')
      let timedOut = false
      yield* this.#isolatedVm
        .run(flow, {
          bindingValues,
          capability: (capabilities, call) => this.#invokeCapability(capabilities, call, run.connectorTeamId),
          emit: async (event) => {
            if (event.type == 'run.started' && event.runId == run.runId) return
            const projected = await projectEvent(event)
            if (projected != null) this.#store.append(run.runId, projected)
          },
          flowId: run.flowId,
          inputs: run.inputs,
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
          ...(run.trigger == null ? {} : { trigger: run.trigger }),
        })
        .pipe(
          Effect.timeoutOrElse({
            duration: this.#runTimeoutMs,
            orElse: () =>
              Effect.sync(() => {
                timedOut = true
              }).pipe(Effect.andThen(Effect.fail(timeoutReason))),
          }),
          Effect.matchEffect({
            onFailure: (error) => Effect.sync(() => this.#failRun(run, startedAt, timedOut, error)),
            onSuccess: (output) => Effect.sync(() => this.#completeRun(run, startedAt, output)),
          }),
        )
    })
  }

  #failRun(run: StoredRun, startedAt: number, timedOut: boolean, error: unknown): void {
    const result = timedOut
      ? { error: { code: 'run.timeout', message: 'The Run exceeded its execution deadline.' } }
      : { error: { code: 'run.failed', message: 'The Flow could not be completed.' } }
    if (!this.#store.commit(run.runId, 'failed', result)) return
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

  #poll(target: StoredPollTarget, occurrenceId: string, now: number): Effect.Effect<void, unknown> {
    return Effect.gen({ self: this }, function* () {
      const rootOccurrenceId = target.continuationRootId ?? occurrenceId
      const page = target.continuationRootId == null ? 0 : target.continuationPage
      const claimId =
        page == 0
          ? rootOccurrenceId
          : yield* Effect.tryPromise({
              try: () => pollPageClaimId(target.bindingId, target.runtimeVersion, rootOccurrenceId, page),
              catch: (error) => error,
            })
      const claim = this.#store.triggers.claimPoll(target, claimId, now, now + pollLeaseMs)
      if (claim.kind != 'acquired') {
        if (claim.kind == 'completed') this.#signal()
        return
      }

      yield* Effect.gen({ self: this }, function* () {
        const revision = JSON.parse(target.content) as RevisionContent
        const fixed = yield* Effect.tryPromise({ try: () => validatedFlow(revision), catch: (error) => error })
        const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
        if (
          fixed.revisionDigest != target.revisionDigest ||
          fixed.prepared.closureDigest != target.closureDigest ||
          trigger?.kind != 'poll' ||
          JSON.stringify(trigger) != target.triggerJson ||
          JSON.stringify(trigger.pollTimes) != target.scheduleJson
        ) {
          return yield* Effect.fail(new PermanentPollError('Fixed Poll Trigger target does not match its Publication.'))
        }
        const definition = this.#pollDefinitions.get(trigger.definition.key)
        if (definition?.snapshot.definitionVersion != trigger.definition.definitionVersion) {
          return yield* Effect.fail(new PermanentPollError('Fixed Poll Trigger definition is not available.'))
        }
        const connection = revision.document.bindings[trigger.bindingId]
        if (connection?.kind != 'connection' || connection.target != target.connectionId) {
          return yield* Effect.fail(new PermanentPollError('Fixed Poll Trigger Connection does not match its Publication.'))
        }
        const connector = this.#connector
        if (connector == null) {
          return yield* Effect.fail(new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.'))
        }
        const result = yield* Effect.tryPromise({
          try: (signal) =>
            definition.poll({
              checkpoint: target.checkpoint,
              config: trigger.config,
              connector: {
                execute: (request, requestSignal) => {
                  const connectorSignal = requestSignal == null ? signal : AbortSignal.any([signal, requestSignal])
                  return connector.proxy(
                    definition.snapshot.provider,
                    target.connectionId,
                    target.bindingId,
                    request,
                    connectorSignal,
                    this.#store.connectorTeam(target.flowId),
                  )
                },
              },
              now: new Date(now),
              signal,
            }),
          catch: (error) => error,
        }).pipe(
          Effect.timeoutOrElse({
            duration: pollTimeoutMs,
            orElse: () => Effect.fail(new TransientPollError('Poll Provider exceeded its execution deadline.')),
          }),
        )
        if (result.events.length > maximumPollEventsPerPage) {
          return yield* Effect.fail(new PermanentPollError(`Poll page exceeds ${maximumPollEventsPerPage} events.`))
        }
        const checkpointJson = JSON.stringify(result.checkpoint)
        if (checkpointJson == null || encoder.encode(checkpointJson).byteLength > maximumPollCheckpointBytes) {
          return yield* Effect.fail(new RangeError('Poll checkpoint exceeds 64 KiB.'))
        }
        const baseline = target.health == 'initializing'
        const identified = yield* Effect.forEach(
          result.events,
          (event) =>
            Effect.tryPromise({
              try: () => providerEventId(target.bindingId, definition.snapshot.key, event.dedupeKey),
              catch: (error) => error,
            }).pipe(Effect.map((id) => ({ event, id }))),
          { concurrency: 'unbounded' },
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
            : yield* Effect.tryPromise({
                try: () =>
                  digestBytes(
                    canonicalJsonBytes({
                      bindingId: target.bindingId,
                      claimId,
                      payload,
                      revisionDigest: target.revisionDigest,
                      runtimeVersion: target.runtimeVersion,
                    }),
                  ),
                catch: (error) => error,
              })
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
          this.#signal()
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
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.sync(() => {
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
            }),
          onSuccess: () => Effect.void,
        }),
      )
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

  #pollDue(at: string): Effect.Effect<void, unknown> {
    return this.#pollLock.withPermit(
      Effect.gen({ self: this }, function* () {
        const now = Date.parse(at)
        if (!Number.isFinite(now)) return yield* Effect.fail(new TypeError('Poll tick time must be an ISO timestamp.'))
        while (true) {
          const targets = this.#store.triggers.duePoll(now, pollBatchSize)
          if (targets.length == 0) break
          for (const target of targets) {
            const scheduledAt = new Date(target.nextAt).toISOString()
            const occurrenceId = yield* Effect.tryPromise({
              try: () => scheduledTriggerOccurrenceId(target.bindingId, target.runtimeVersion, scheduledAt),
              catch: (error) => error,
            })
            yield* this.#poll(target, occurrenceId, now)
          }
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
        this.#maintenanceAt = this.#clock() + this.#maintain(now)
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
        if (this.#connector == null) throw new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.')
        return await this.#connector.execute(
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

  async #invokeCapability(capabilities: readonly ConnectorCapability[], call: RuntimeCapabilityCall, teamId?: string): Promise<RuntimeCapabilityResponse> {
    if (call.kind != 'connector') throw new TaskHostError('capability.denied', 'The Runtime Capability is not declared for this Task.')
    const payload = connectorCapabilityPayload(call.payload)
    if (!capabilities.some((capability) => capability.action == payload.action && capability.connectionId == payload.connectionId)) {
      throw new TaskHostError('capability.denied', 'The Runtime Capability is not declared for this Task.')
    }
    if (this.#connector == null) throw new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.')
    return {
      body: await this.#connector.execute(payload.action, payload.connectionId, payload.input, call.invocationId, call.signal, teamId),
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
      const integrationAt = this.#store.triggers.nextIntegrationAt()
      if (!FiberMap.hasUnsafe(this.#tasks, 'integration') && integrationAt != null && integrationAt <= now) {
        yield* this.#startTask('integration', 'trigger.integration.loop.failed', this.#integration.tick(new Date(now).toISOString()))
      }
      const pollAt = this.#store.triggers.nextPollAt()
      if (!FiberMap.hasUnsafe(this.#tasks, 'poll') && pollAt != null && pollAt <= now) {
        yield* this.#startTask('poll', 'trigger.poll.loop.failed', this.#pollDue(new Date(now).toISOString()))
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
    if (!FiberMap.hasUnsafe(this.#tasks, 'cron')) {
      const nextAt = this.#store.triggers.nextCronAt()
      if (nextAt != null) deadlines.push(Math.max(nextAt, this.#cronRetryAt ?? nextAt))
    }
    if (!FiberMap.hasUnsafe(this.#tasks, 'integration')) {
      const nextAt = this.#store.triggers.nextIntegrationAt()
      if (nextAt != null) deadlines.push(nextAt)
    }
    if (!FiberMap.hasUnsafe(this.#tasks, 'poll')) {
      const nextAt = this.#store.triggers.nextPollAt()
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
