import type { FlowCatalogEvent, FlowChangeEvent } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, RevisionContent, TriggerNode, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { PreparedFlow } from '@oomol-lab/open-flow/flow-semantics'
import type { IntegrationDefinition } from '@oomol-lab/open-flow/integration-trigger'
import type { PollDefinition } from '@oomol-lab/open-flow/poll-trigger'
import type { ProviderTriggerDefinition } from '@oomol-lab/open-flow/provider-triggers'
import type { Logger } from 'pino'
import type { ConnectorHost } from '../deployment/connector.ts'
import type { LlmHost } from '../deployment/llm.ts'
import type { IntegrationOptions, IntegrationResponse, IntegrationRuntimeState, IntegrationTarget } from '../runtime/integration-runtime.ts'
import type { RunEvent, RunRecord } from '../storage/store.ts'
import type { PollState, RunAdmission, StoredCronTarget } from '../storage/trigger-store.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { nextTriggerScheduledAt, scheduledTriggerOccurrenceId } from '@oomol-lab/open-flow/cron-trigger'
import { canonicalJsonBytes, decodeRevision, digestBytes, encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { matchesSchema, prepareFlow, triggerPayloadSchema, variableBindings } from '@oomol-lab/open-flow/flow-semantics'
import { triggerDefinitions as providerTriggerDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FiberMap from 'effect/FiberMap'
import * as FiberSet from 'effect/FiberSet'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { ConnectorClient, ConnectorTaskError } from '../deployment/connector.ts'
import { AcceptanceError, ControlError } from '../error.ts'
import { errorKind, silentLogger } from '../logger.ts'
import { IntegrationRuntime } from '../runtime/integration-runtime.ts'
import { IsolatedVmHost } from '../runtime/isolated-vm.ts'
import { PollRuntime } from '../runtime/poll-runtime.ts'
import { migrateDatabase } from '../storage/migrate.ts'
import { Store } from '../storage/store.ts'
import { ControlService } from './control-service.ts'
import { Publisher } from './publication.ts'
import { RunExecutor } from './run.ts'

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
  readonly llm?: () => LlmHost | undefined
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

export class ServerService {
  readonly publisher: Publisher
  readonly control: ControlService
  readonly #clock: () => number
  readonly #clockService: Clock.Clock
  readonly #cronLock: Semaphore.Semaphore
  readonly #receive: (effect: Effect.Effect<IntegrationResponse, unknown>, signal?: AbortSignal) => Promise<IntegrationResponse>
  readonly #integration: IntegrationRuntime
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
  readonly #executor: RunExecutor
  readonly #resolveLlm: () => LlmHost | undefined
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
      readonly receive: (effect: Effect.Effect<IntegrationResponse, unknown>, signal?: AbortSignal) => Promise<IntegrationResponse>
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
    this.#receive = resources.receive
    this.#clock = clock
    this.#clockService = clockService
    this.#cronLock = cronLock
    this.#logger = logger.child({ component: 'runtime' })
    this.#maintenanceLock = maintenanceLock
    this.#maxConcurrentRuns = runtime.maxConcurrentRuns ?? defaultMaxConcurrentRuns
    this.#resolveConnector = capabilities.connector ?? (() => undefined)
    this.#resolveConnectorConsoleOrigin = capabilities.connectorConsoleOrigin ?? (() => undefined)
    this.#resolveIntegration = capabilities.integration ?? (() => undefined)
    this.#resolveLlm = capabilities.llm ?? (() => undefined)
    this.#resolveWaitPublicOrigin = capabilities.waitPublicOrigin ?? (() => undefined)
    this.#signals = signals
    this.#store = store
    this.#tasks = tasks
    this.#workers = workers
    this.#executor = new RunExecutor(
      store,
      isolatedVm,
      this.#resolveConnector,
      this.#resolveLlm,
      this.#resolveWaitPublicOrigin,
      runtime.runTimeoutMs ?? defaultRunTimeoutMs,
      this.#logger,
      (flowId, runId) => this.#runChanged(flowId, runId),
      () => this.#wakeMaintenance(),
    )
    const pollDefinitions = triggerDefinitions.filter((definition): definition is PollDefinition => definition.snapshot.type == 'poll')
    const integrationDefinitions = triggerDefinitions.filter((definition): definition is IntegrationDefinition => definition.snapshot.type == 'integration')
    const snapshots = triggerDefinitions.map((definition) => definition.snapshot).toSorted((left, right) => left.key.localeCompare(right.key))
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
    this.publisher = new Publisher(
      store,
      this.#integration,
      this.#poll,
      this.#resolveConnector,
      this.#resolveWaitPublicOrigin,
      this.#clock,
      this.#logger,
      validatedFlow,
      () => this.#signal(),
      () => this.#wakeMaintenance(),
      () => this.#notifyFlowCatalog(),
      () => this.#resolveLlm()?.config != null,
    )
    this.control = new ControlService(
      store,
      this.#clock,
      (runId) => this.#interrupt(runId),
      () => this.#signal(),
      (input) => this.publisher.publish(input),
      (input) => this.publisher.accept(input),
      () => this.#wakeMaintenance(),
      snapshots,
      (flowId, triggerNodeId) => this.#poll.test(flowId, triggerNodeId),
      () => this.#notifyFlowCatalog(),
      (event) => this.#notifyFlow(event),
      (kind) => (kind == 'agent' ? this.#resolveLlm()?.config != null : this.#resolveLlm() != null),
      this.#resolveConnector,
      this.#resolveConnectorConsoleOrigin,
      this.#resolveWaitPublicOrigin,
      (teamId) => this.#connectorTeam(teamId),
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
            return new Store(databaseFile, now, runtime.runEventRetentionMs, runtime.maxPendingRuns, () => capabilities.llm?.()?.config)
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
      const requests = yield* FiberSet.make<IntegrationResponse, unknown>()
      const runRequest = yield* FiberSet.runtimePromise(requests)()
      const service = new ServerService(
        {
          clockService,
          cronLock,
          isolatedVm,
          maintenanceLock,
          pollLock,
          signals,
          store,
          tasks,
          workers,
          receive: (effect, signal) => runRequest(effect.pipe(Effect.provideService(Clock.Clock, clockService)), { signal }),
        },
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
      !isDeepStrictEqual(trigger, target.trigger)
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
      triggerJson: JSON.stringify(target.trigger),
      triggerNodeId: target.triggerNodeId,
    })
    if (accepted?.kind == 'accepted' && accepted.created) this.#runCreated(target.flowId, accepted.runId)
    if (accepted != null) this.#signal()
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

  async receiveIntegrationTarget(
    target: IntegrationTarget,
    input: Parameters<IntegrationRuntime['receive']>[1],
    signal?: AbortSignal,
  ): Promise<IntegrationResponse> {
    return await this.#receive(this.#integration.receive(target, input), signal)
  }

  webhookTarget(endpointId: string): WebhookTarget | undefined {
    const stored = this.#store.triggers.webhookTarget(endpointId)
    if (stored == null) return
    const { content, triggerJson, ...target } = stored
    return {
      ...target,
      revision: decodeRevision(new TextEncoder().encode(content)),
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

  #admitCron(target: StoredCronTarget, now: number): Effect.Effect<'admitted' | 'overloaded', unknown> {
    return Effect.gen({ self: this }, function* () {
      const fixed = yield* Effect.tryPromise({
        try: () => validatedFlow(decodeRevision(new TextEncoder().encode(target.content))),
        catch: (error) => error,
      })
      const trigger = fixed.prepared.graph.nodes[target.triggerNodeId]
      if (
        fixed.revisionDigest != target.revisionDigest ||
        fixed.prepared.closureDigest != target.closureDigest ||
        trigger?.kind != 'cron' ||
        !isDeepStrictEqual(trigger, JSON.parse(target.triggerJson)) ||
        !isDeepStrictEqual(trigger.cronTimes, JSON.parse(target.scheduleJson))
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
    const publication = this.publisher.advance(now)
    if (publication == 'pending') return maintenanceRetryMs
    let nextDelay = publication == 'more' || this.#store.pruneExpiredEvents(now, maintenanceBatchSize) > 0 ? 0 : maintenanceIntervalMs
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

  #wakeMaintenance(): void {
    this.#maintenanceAt = this.#clock()
    this.#signal()
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
          this.#executor.run(run).pipe(
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
    admit: (digest: string) => number | undefined,
  ):
    | { readonly action: WaitAction; readonly expiresAt: string; readonly prompt: string; readonly state: 'resolved' | 'waiting' }
    | { readonly retryAfter: number }
    | undefined {
    const digest = createHash('sha256').update(capability).digest('hex')
    const receipt = this.#store.waitByCapability(digest)
    if (receipt == null) return
    const wait = this.#store.waitReceipt(receipt.runId, receipt.waitId)
    if (wait == null || !wait.actions.some((action) => action == requested) || receipt.expiresAt <= this.#clock()) return
    if (receipt.action == null && (receipt.status != 'waiting' || receipt.expiresAt <= this.#clock())) return
    const retryAfter = admit(digest)
    if (retryAfter != null) return { retryAfter }
    if (receipt.action != null) {
      return { action: receipt.action, expiresAt: new Date(receipt.expiresAt).toISOString(), prompt: wait.prompt, state: 'resolved' }
    }
    return { action: requested, expiresAt: new Date(receipt.expiresAt).toISOString(), prompt: wait.prompt, state: 'waiting' }
  }

  resolveWaitAction(
    capability: string,
    requested: WaitAction,
    admit: (digest: string) => number | undefined,
  ):
    | {
        readonly action: WaitAction | null
        readonly resolutionAccepted: boolean
        readonly resolvedAt: string | null
        readonly state: 'resolved' | 'unavailable' | 'waiting'
      }
    | { readonly retryAfter: number }
    | undefined {
    const digest = createHash('sha256').update(capability).digest('hex')
    const receipt = this.#store.waitByCapability(digest)
    if (receipt == null) return
    const wait = this.#store.waitReceipt(receipt.runId, receipt.waitId)
    if (wait == null || !wait.actions.some((action) => action == requested) || receipt.expiresAt <= this.#clock()) return
    const retryAfter = admit(digest)
    if (retryAfter != null) return { retryAfter }
    const result = this.#store.resolveWait(receipt.runId, receipt.waitId, requested)
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
