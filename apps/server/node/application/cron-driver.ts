import type * as Semaphore from 'effect/Semaphore'
import type { Store } from '../storage/store.ts'
import type { StoredCronTarget } from '../storage/trigger-store.ts'
import type { RevisionValidator } from './flow-validation.ts'

import { nextTriggerScheduledAt, scheduledTriggerOccurrenceId } from '@oomol-lab/open-flow/cron-trigger'
import { canonicalJsonBytes, decodeRevision, digestBytes } from '@oomol-lab/open-flow/flow-encoding'
import * as Effect from 'effect/Effect'
import { isDeepStrictEqual } from 'node:util'

const admissionRetryMs = 1_000
const cronBatchSize = 100

export class CronDriver {
  readonly #cronLock: Semaphore.Semaphore
  readonly #runCreated: (flowId: string, runId: string) => void
  readonly #signal: () => void
  readonly #store: Store
  readonly #validate: RevisionValidator
  #retryAt?: number

  constructor(
    store: Store,
    validate: RevisionValidator,
    cronLock: Semaphore.Semaphore,
    signal: () => void,
    runCreated: (flowId: string, runId: string) => void,
  ) {
    this.#cronLock = cronLock
    this.#runCreated = runCreated
    this.#signal = signal
    this.#store = store
    this.#validate = validate
  }

  nextAt(): number | undefined {
    const nextAt = this.#store.triggers.nextCronAt()
    if (nextAt == null) return
    return Math.max(nextAt, this.#retryAt ?? nextAt)
  }

  tick(at: string): Effect.Effect<void, unknown> {
    return this.#cronLock.withPermit(
      Effect.gen({ self: this }, function* () {
        const now = Date.parse(at)
        if (!Number.isFinite(now)) return yield* Effect.fail(new TypeError('Cron tick time must be an ISO timestamp.'))
        while (true) {
          const targets = this.#store.triggers.dueCron(now, cronBatchSize)
          if (targets.length == 0) break
          let overloaded = false
          for (const target of targets) {
            const result = yield* this.#admit(target, now)
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

  #admit(target: StoredCronTarget, now: number): Effect.Effect<'admitted' | 'overloaded', unknown> {
    return Effect.gen({ self: this }, function* () {
      const fixed = yield* Effect.tryPromise({
        try: () => this.#validate(decodeRevision(new TextEncoder().encode(target.content))),
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
        this.#retryAt = now + admissionRetryMs
        return 'overloaded'
      }
      this.#retryAt = undefined
      if (accepted?.kind == 'accepted' && accepted.created) this.#runCreated(target.flowId, accepted.runId)
      if (accepted != null) this.#signal()
      return 'admitted'
    })
  }
}
