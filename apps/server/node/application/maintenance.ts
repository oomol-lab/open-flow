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
  readonly #publisher: Publisher
  readonly #resolveConnector: () => ConnectorHost | undefined
  readonly #runChanged: (flowId: string, runId: string) => void
  readonly #signal: () => void
  readonly #store: Store
  #maintenanceAt = 0

  constructor(
    store: Store,
    publisher: Publisher,
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
    return this.#maintenanceAt
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

  #maintain(now: number): number {
    const publication = this.#publisher.advance(now)
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
    if (this.#isFlowRunning(flowId)) return maintenanceRetryMs
    if (this.#store.flowHasIntegrationState(flowId)) return nextDelay
    if (this.#store.deleteFlowRuns(flowId, maintenanceBatchSize) > 0) return 0
    if (!this.#store.deleteFlow(flowId)) return nextDelay

    this.#logger.info({ category: 'flow.deleted', flowId }, 'Retired Flow was physically deleted.')
    this.#notifyFlowCatalog()
    if (this.#store.collectOrphanRevisions(maintenanceBatchSize) > 0) return 0
    return nextDelay
  }
}
