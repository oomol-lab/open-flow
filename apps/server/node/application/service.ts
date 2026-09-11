import type { FlowCatalogEvent, FlowChangeEvent } from '@oomol-lab/open-flow/control-api'
import type { JsonValue, WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { IntegrationDefinition } from '@oomol-lab/open-flow/integration-trigger'
import type { PollDefinition } from '@oomol-lab/open-flow/poll-trigger'
import type { ProviderTriggerDefinition } from '@oomol-lab/open-flow/provider-triggers'
import type * as Deferred from 'effect/Deferred'
import type { Logger } from 'pino'
import type { ConnectorHost } from '../deployment/connector.ts'
import type { LlmHost } from '../deployment/llm.ts'
import type { IntegrationOptions, IntegrationResponse, IntegrationRuntimeState, IntegrationTarget } from '../runtime/integration-runtime.ts'
import type { RunEvent, RunRecord } from '../storage/store.ts'
import type { PollState, RunAdmission } from '../storage/trigger-store.ts'
import type { ServerCapabilities, ServerRuntime, ServerServiceOptions } from './service-options.ts'
import type { WebhookTarget } from './webhook-targets.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { triggerDefinitions as providerTriggerDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as FiberMap from 'effect/FiberMap'
import * as FiberSet from 'effect/FiberSet'
import * as Queue from 'effect/Queue'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import { ConnectorClient, ConnectorTaskError } from '../deployment/connector.ts'
import { ControlError } from '../error.ts'
import { silentLogger } from '../logger.ts'
import { IntegrationRuntime } from '../runtime/integration-runtime.ts'
import { IsolatedVmHost } from '../runtime/isolated-vm.ts'
import { PollRuntime } from '../runtime/poll-runtime.ts'
import { migrateDatabase } from '../storage/migrate.ts'
import { Store } from '../storage/store.ts'
import { ControlService } from './control-service.ts'
import { CronDriver } from './cron-driver.ts'
import { validatedFlow } from './flow-validation.ts'
import { Maintenance } from './maintenance.ts'
import { Publisher } from './publication.ts'
import { RunExecutor } from './run.ts'
import { validateCapabilities, validateRuntime } from './service-options.ts'
import { Supervisor } from './supervisor.ts'
import { WaitActions } from './wait-actions.ts'
import { WebhookTargets } from './webhook-targets.ts'

export type { ServerCapabilities, ServerRuntime, ServerServiceOptions } from './service-options.ts'

interface PollOccurrenceInput {
  readonly bindingId: string
  readonly occurredAt: string
  readonly occurrenceId: string
  readonly runtimeVersion: number
}

const defaultMaxConcurrentRuns = 4
const defaultRunTimeoutMs = 30 * 60 * 1_000

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
  readonly #cron: CronDriver
  readonly #executor: RunExecutor
  readonly #flowCatalogSubscribers = new Set<(event: FlowCatalogEvent) => void>()
  readonly #flowSubscribers = new Map<string, Set<(event: FlowChangeEvent) => void>>()
  readonly #integration: IntegrationRuntime
  readonly #logger: Logger
  readonly #maintenance: Maintenance
  readonly #poll: PollRuntime
  readonly #receive: (effect: Effect.Effect<IntegrationResponse, unknown>, signal?: AbortSignal) => Promise<IntegrationResponse>
  readonly #resolveConnector: () => ConnectorHost | undefined
  readonly #resolveConnectorConsoleOrigin: () => URL | undefined
  readonly #resolveIntegration: () => IntegrationOptions | undefined
  readonly #resolveLlm: () => LlmHost | undefined
  readonly #resolveWaitPublicOrigin: () => URL | undefined
  readonly #store: Store
  readonly #supervisor: Supervisor
  readonly #waitActions: WaitActions
  readonly #webhookTargets: WebhookTargets
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
    this.#logger = logger.child({ component: 'runtime' })
    this.#resolveConnector = capabilities.connector ?? (() => undefined)
    this.#resolveConnectorConsoleOrigin = capabilities.connectorConsoleOrigin ?? (() => undefined)
    this.#resolveIntegration = capabilities.integration ?? (() => undefined)
    this.#resolveLlm = capabilities.llm ?? (() => undefined)
    this.#resolveWaitPublicOrigin = capabilities.waitPublicOrigin ?? (() => undefined)
    this.#store = store
    // Background collaborators receive lazy callbacks that read fields assigned below; they never run during construction.
    this.#executor = new RunExecutor(
      store,
      isolatedVm,
      this.#resolveConnector,
      this.#resolveLlm,
      this.#resolveWaitPublicOrigin,
      runtime.runTimeoutMs ?? defaultRunTimeoutMs,
      this.#logger,
      (flowId, runId) => this.#runChanged(flowId, runId),
      () => this.#maintenance.wake(),
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
      () => this.#supervisor.signal(),
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
      () => this.#supervisor.signal(),
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
      () => this.#supervisor.signal(),
      () => this.#maintenance.wake(),
      () => this.#notifyFlowCatalog(),
      () => this.#resolveLlm()?.config != null,
    )
    this.#maintenance = new Maintenance(
      store,
      this.publisher,
      this.#clock,
      this.#logger,
      this.#resolveConnector,
      (runId) => this.#supervisor.interrupt(runId),
      (flowId) => this.#supervisor.isFlowRunning(flowId),
      () => this.#notifyFlowCatalog(),
      (flowId, runId) => this.#runChanged(flowId, runId),
      () => this.#supervisor.signal(),
      maintenanceLock,
    )
    this.#cron = new CronDriver(
      store,
      validatedFlow,
      cronLock,
      () => this.#supervisor.signal(),
      (flowId, runId) => this.#runCreated(flowId, runId),
    )
    this.#supervisor = new Supervisor(
      store,
      this.#executor,
      this.#logger,
      signals,
      tasks,
      workers,
      runtime.maxConcurrentRuns ?? defaultMaxConcurrentRuns,
      this.#cron,
      this.#integration,
      this.#poll,
      this.#maintenance,
      this.#clock,
    )
    this.#webhookTargets = new WebhookTargets(
      store,
      validatedFlow,
      (flowId, runId) => this.#runCreated(flowId, runId),
      () => this.#supervisor.signal(),
    )
    this.#waitActions = new WaitActions(
      store,
      this.#clock,
      (flowId, runId) => this.#runChanged(flowId, runId),
      () => this.#supervisor.signal(),
    )
    this.control = new ControlService(
      store,
      this.#clock,
      (runId) => this.#supervisor.interrupt(runId),
      () => this.#supervisor.signal(),
      (input) => this.publisher.publish(input),
      (input) => this.publisher.accept(input),
      () => this.#maintenance.wake(),
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

  acceptWebhookTarget(target: WebhookTarget, occurrenceId: string, payload: JsonValue): Promise<RunAdmission | undefined> {
    return this.#webhookTargets.accept(target, occurrenceId, payload)
  }

  cancel(runId: string): boolean {
    const committed = this.#store.cancel(runId)
    if (committed) {
      this.#supervisor.interrupt(runId)
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
    return this.#started && this.#supervisor.failure == null && (connector == null || (await connector.ready()))
  }

  configurationChanged(): void {
    this.#maintenance.wake()
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
      this.#maintenance.markDue()
      yield* this.#supervisor.supervise().pipe(Effect.forkScoped)
      this.#supervisor.signal()
    }).pipe(Effect.provideService(Clock.Clock, this.#clockService))
  }

  #run(effect: Effect.Effect<void, unknown>): Promise<void> {
    return Effect.runPromise(effect.pipe(Effect.provideService(Clock.Clock, this.#clockService)))
  }

  tickCron(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return this.#run(this.#cron.tick(at))
  }

  tickPoll(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return this.#run(this.#poll.tick(at))
  }

  tickIntegration(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return this.#run(this.#integration.tick(at))
  }

  tickMaintenance(at = new Date(this.#clock()).toISOString()): Promise<void> {
    return this.#run(this.#maintenance.run(at))
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
    return this.#webhookTargets.target(endpointId)
  }

  webhookEndpoint(flowId: string, triggerNodeId: string): string | undefined {
    return this.#store.triggers.webhookEndpoint(flowId, triggerNodeId)
  }

  async waitForIdle(): Promise<void> {
    if (this.#supervisor.failure != null) throw this.#supervisor.failure
    if (this.#started) await this.#supervisor.waitForSignal()
    else await this.#supervisor.awaitEmpty()
    if (this.#supervisor.failure != null) throw this.#supervisor.failure
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

  inspectWaitAction(
    capability: string,
    requested: WaitAction,
    admit: (digest: string) => number | undefined,
  ):
    | { readonly action: WaitAction; readonly expiresAt: string; readonly prompt: string; readonly state: 'resolved' | 'waiting' }
    | { readonly retryAfter: number }
    | undefined {
    return this.#waitActions.inspect(capability, requested, admit)
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
    return this.#waitActions.resolve(capability, requested, admit)
  }
}
