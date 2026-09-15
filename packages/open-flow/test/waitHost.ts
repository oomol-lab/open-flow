import type { FlowRunOutcome, WaitHost } from '../src/execution/common/scheduler.ts'
import type { WaitAction } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { vi } from 'vitest'

export function waitHost(decisions: Readonly<Record<string, WaitAction>> = {}): WaitHost {
  return {
    create: () => Effect.succeed(undefined),
    resolutions: (ids, block) => {
      const values = Object.fromEntries(ids.filter((id) => decisions[id] != null).map((id) => [id, decisions[id]!]))
      return block && Object.keys(values).length == 0 ? Effect.never : Effect.succeed(values)
    },
  }
}

export async function advanceWaiting(effect: Effect.Effect<FlowRunOutcome, Error>): Promise<FlowRunOutcome> {
  vi.useFakeTimers()
  try {
    const pending = Effect.runPromise(effect)
    let settled = false
    void pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )
    for (let step = 0; step < 100; step++) {
      if (settled) break
      await vi.runOnlyPendingTimersAsync()
    }
    if (!settled) throw new Error('Scheduler did not settle with the controlled clock.')
    return await pending
  } finally {
    vi.useRealTimers()
  }
}
