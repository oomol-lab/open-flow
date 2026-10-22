import type { FlowRunOutcome, WaitHost } from '../src/execution/common/scheduler.ts'
import type { WaitAction } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import { TestClock } from 'effect/testing'
import { setImmediate } from 'node:timers/promises'
import { vi } from 'vitest'
import { waitRetentionMs } from '../src/execution/common/scheduler.ts'

export function waitHost(decisions: Readonly<Record<string, WaitAction>> = {}): WaitHost {
  return {
    create: () => Effect.succeed(undefined),
    resolutions: (ids, block) => {
      const values = Object.fromEntries(
        ids.filter((id) => decisions[id] != null).map((id) => [id, { action: decisions[id]!, resolvedAt: '2026-09-18T08:30:00.000Z', comment: null }]),
      )
      return block && Object.keys(values).length == 0 ? Effect.never : Effect.succeed(values)
    },
  }
}

export function advanceWaiting(effect: Effect.Effect<FlowRunOutcome, Error>): Promise<FlowRunOutcome> {
  return Effect.runPromise(
    TestClock.testClockWith((clock) => {
      const now = vi.spyOn(performance, 'now').mockImplementation(() => Number(clock.monotonicTimeNanosUnsafe()) / 1_000_000)
      return Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(effect)
        yield* clock.withLive(
          Effect.gen(function* () {
            while (fiber.pollUnsafe() == null) {
              yield* clock.adjust(waitRetentionMs)
              // Hashing and host I/O use real promises, independently of Effect time.
              yield* Effect.promise(() => setImmediate())
            }
          }).pipe(Effect.timeoutOrElse({ duration: '1 second', orElse: () => Effect.fail(new Error('Scheduler did not settle with the controlled clock.')) })),
        )
        return yield* Fiber.join(fiber)
      }).pipe(Effect.ensuring(Effect.sync(() => now.mockRestore())))
    }).pipe(Effect.provide(TestClock.layer())),
  )
}
