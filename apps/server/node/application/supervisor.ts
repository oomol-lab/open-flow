import type { Logger } from 'pino'
import type { IntegrationRuntime } from '../runtime/integration-runtime.ts'
import type { PollRuntime } from '../runtime/poll-runtime.ts'
import type { Store } from '../storage/store.ts'
import type { CronDriver } from './cron-driver.ts'
import type { Maintenance } from './maintenance.ts'
import type { RunExecutor } from './run.ts'

import * as Cause from 'effect/Cause'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as FiberMap from 'effect/FiberMap'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'

const maxTimerDelayMs = 2_147_483_647

function finishWaiters(waiters: readonly Deferred.Deferred<void>[]): Effect.Effect<void> {
  return Effect.forEach(waiters, (deferred) => Deferred.succeed(deferred, undefined), { discard: true })
}

export class Supervisor {
  readonly #clock: () => number
  readonly #cron: CronDriver
  readonly #executor: RunExecutor
  readonly #integration: IntegrationRuntime
  readonly #logger: Logger
  readonly #maintenance: Maintenance
  readonly #maxConcurrentRuns: number
  readonly #poll: PollRuntime
  readonly #runningFlows = new Set<string>()
  readonly #signals: Queue.Queue<Deferred.Deferred<void> | undefined>
  readonly #store: Store
  readonly #tasks: FiberMap.FiberMap<string, void, never>
  readonly #workers: FiberMap.FiberMap<string, void, never>
  #failure?: unknown

  constructor(
    store: Store,
    executor: RunExecutor,
    logger: Logger,
    signals: Queue.Queue<Deferred.Deferred<void> | undefined>,
    tasks: FiberMap.FiberMap<string, void, never>,
    workers: FiberMap.FiberMap<string, void, never>,
    maxConcurrentRuns: number,
    cron: CronDriver,
    integration: IntegrationRuntime,
    poll: PollRuntime,
    maintenance: Maintenance,
    clock: () => number,
  ) {
    this.#clock = clock
    this.#cron = cron
    this.#executor = executor
    this.#integration = integration
    this.#logger = logger
    this.#maintenance = maintenance
    this.#maxConcurrentRuns = maxConcurrentRuns
    this.#poll = poll
    this.#signals = signals
    this.#store = store
    this.#tasks = tasks
    this.#workers = workers
  }

  get failure(): unknown {
    return this.#failure
  }

  isFlowRunning(flowId: string): boolean {
    return this.#runningFlows.has(flowId)
  }

  signal(): void {
    Queue.offerUnsafe(this.#signals, undefined)
  }

  interrupt(runId: string): void {
    const worker = Option.getOrUndefined(FiberMap.getUnsafe(this.#workers, runId))
    if (worker != null) Effect.runFork(Fiber.interrupt(worker))
  }

  waitForSignal(): Promise<void> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const settled = yield* Deferred.make<void>()
        yield* Queue.offer(this.#signals, settled)
        yield* Deferred.await(settled)
      }),
    )
  }

  async awaitEmpty(): Promise<void> {
    await Effect.runPromise(FiberMap.awaitEmpty(this.#tasks))
    await Effect.runPromise(FiberMap.awaitEmpty(this.#workers))
  }

  supervise(): Effect.Effect<void> {
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
      const cronAt = this.#cron.nextAt()
      if (!FiberMap.hasUnsafe(this.#tasks, 'cron') && cronAt != null && cronAt <= now) {
        yield* this.#startTask('cron', 'trigger.cron.loop.failed', this.#cron.tick(new Date(now).toISOString()))
      }
      const integrationAt = this.#store.integrations.nextIntegrationAt()
      if (!FiberMap.hasUnsafe(this.#tasks, 'integration') && integrationAt != null && integrationAt <= now) {
        yield* this.#startTask('integration', 'trigger.integration.loop.failed', this.#integration.tick(new Date(now).toISOString()))
      }
      const pollAt = this.#store.polls.nextPollAt()
      if (!FiberMap.hasUnsafe(this.#tasks, 'poll') && pollAt != null && pollAt <= now) {
        yield* this.#startTask('poll', 'trigger.poll.loop.failed', this.#poll.tick(new Date(now).toISOString()))
      }
      if (!FiberMap.hasUnsafe(this.#tasks, 'maintenance') && this.#maintenance.nextAt() <= now) {
        yield* this.#startTask('maintenance', 'maintenance.loop.failed', this.#maintenance.run(new Date(now).toISOString()))
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
                this.signal()
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
    if (!FiberMap.hasUnsafe(this.#tasks, 'maintenance')) deadlines.push(this.#maintenance.nextAt())
    const waitExpiry = this.#store.nextWaitExpiry()
    if (waitExpiry != null) deadlines.push(waitExpiry)
    const waitNotificationAt = this.#store.nextWaitNotificationAt()
    if (waitNotificationAt != null) deadlines.push(waitNotificationAt)
    if (!FiberMap.hasUnsafe(this.#tasks, 'cron')) {
      const nextAt = this.#cron.nextAt()
      if (nextAt != null) deadlines.push(nextAt)
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
    this.signal()
  }
}
