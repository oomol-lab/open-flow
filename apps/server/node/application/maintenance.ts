import type * as Semaphore from 'effect/Semaphore'
import type { Logger } from 'pino'
import type { ConnectorHost } from '../deployment/connector.ts'
import type { Store } from '../storage/store.ts'
import type { Publisher } from './publication.ts'

import * as Effect from 'effect/Effect'
import { ConnectorTaskError } from '../deployment/connector.ts'
import { errorKind } from '../logger.ts'

const maintenanceBatchSize = 100
const maintenanceIntervalMs = 60_000
const maintenanceRetryMs = 1_000
const waitNotificationLeaseMs = 60_000
const waitNotificationMaxAttempts = 3

export class Maintenance {
  readonly #clock: () => number
  readonly #interrupt: (runId: string) => void
  readonly #isFlowRunning: (flowId: string) => boolean
  readonly #logger: Logger
  readonly #maintenanceLock: Semaphore.Semaphore
  readonly #notifyFlowCatalog: () => void
  readonly #publisher: Pick<Publisher, 'advance'>
  readonly #resolveConnector: () => ConnectorHost | undefined
  readonly #runChanged: (flowId: string, runId: string) => void
  readonly #signal: () => void
  readonly #store: Store
  #maintenanceAt = 0

  constructor(
    store: Store,
    publisher: Pick<Publisher, 'advance'>,
    clock: () => number,
    logger: Logger,
    resolveConnector: () => ConnectorHost | undefined,
    interrupt: (runId: string) => void,
    isFlowRunning: (flowId: string) => boolean,
    notifyFlowCatalog: () => void,
    runChanged: (flowId: string, runId: string) => void,
    signal: () => void,
    maintenanceLock: Semaphore.Semaphore,
  ) {
    this.#clock = clock
    this.#interrupt = interrupt
    this.#isFlowRunning = isFlowRunning
    this.#logger = logger
    this.#maintenanceLock = maintenanceLock
    this.#notifyFlowCatalog = notifyFlowCatalog
    this.#publisher = publisher
    this.#resolveConnector = resolveConnector
    this.#runChanged = runChanged
    this.#signal = signal
    this.#store = store
  }

  nextAt(): number {
    return Math.min(this.#maintenanceAt, this.#store.runs.nextMaintenanceAt() ?? Infinity, this.#store.publications.nextPublishAt() ?? Infinity)
  }

  markDue(): void {
    this.#maintenanceAt = this.#clock()
  }

  wake(): void {
    this.markDue()
    this.#signal()
  }

  run(at: string): Effect.Effect<void, unknown> {
    return this.#maintenanceLock.withPermit(
      Effect.gen({ self: this }, function* () {
        const now = Date.parse(at)
        if (!Number.isFinite(now)) return yield* Effect.fail(new TypeError('Maintenance tick time must be an ISO timestamp.'))
        this.#maintenanceAt = Infinity
        const runs = this.#store.runs.maintain(now, maintenanceBatchSize, waitNotificationLeaseMs)
        for (const { flowId, runId } of runs.expiredWaits) this.#runChanged(flowId, runId)
        const notification = runs.notification
        if (notification != null) {
          const connector = this.#resolveConnector()
          if (connector == null) {
            this.#store.runs.releaseWaitNotification(
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
                      this.#store.runs.finishWaitNotification(notification.runId, notification.waitId, notification.claimId, false)
                    } else {
                      this.#store.runs.releaseWaitNotification(
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
                    this.#store.runs.finishWaitNotification(notification.runId, notification.waitId, notification.claimId, true)
                    this.#logger.info({ category: 'wait.notification.delivered', runId: notification.runId }, 'Wait notification was delivered.')
                  }),
              }),
            )
          }
        }
        const nextDelay = Math.min(runs.more ? 0 : maintenanceIntervalMs, this.#maintain(now))
        // Preserve wakes received while notification delivery was awaiting the Connector.
        this.#maintenanceAt = Math.min(this.#maintenanceAt, this.#clock() + nextDelay)
        this.#signal()
      }),
    )
  }

  #maintain(now: number): number {
    const publication = this.#publisher.advance(now)
    let nextDelay = publication == 'more' ? 0 : maintenanceIntervalMs
    if (this.#store.publications.prunePublishOperations(now, maintenanceBatchSize) > 0) nextDelay = 0
    const flowId = this.#store.flows.claimRetiring(now)
    if (flowId == null) {
      if (this.#store.flows.collectOrphanRevisions(maintenanceBatchSize) > 0) nextDelay = 0
      return nextDelay
    }

    const canceled = this.#store.runs.cancelByFlow(flowId, maintenanceBatchSize)
    for (const runId of canceled) this.#interrupt(runId)
    if (canceled.length > 0) return 0
    if (this.#isFlowRunning(flowId)) return maintenanceRetryMs
    if (this.#store.flows.hasIntegrationState(flowId)) return nextDelay
    if (this.#store.runs.deleteByFlow(flowId, maintenanceBatchSize) > 0) return 0
    if (!this.#store.flows.delete(flowId)) return nextDelay

    this.#logger.info({ category: 'flow.deleted', flowId }, 'Retired Flow was physically deleted.')
    this.#notifyFlowCatalog()
    if (this.#store.flows.collectOrphanRevisions(maintenanceBatchSize) > 0) return 0
    return nextDelay
  }
}
