import { dequal } from 'dequal/lite'

export const runTerminalStatuses = ['canceled', 'completed', 'failed', 'indeterminate'] as const
export const runStatuses = [...runTerminalStatuses, 'queued', 'running', 'starting', 'waiting'] as const

export type RunStatus = (typeof runStatuses)[number]
export type RunTerminalStatus = (typeof runTerminalStatuses)[number]

export type RunOperation =
  | { readonly kind: 'claim' }
  | { readonly kind: 'start' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'resolve' }
  | { readonly kind: 'commit'; readonly status: RunTerminalStatus }

export type RunTransition =
  | { readonly kind: 'ready'; readonly status: 'starting' }
  | { readonly kind: 'running'; readonly status: 'running' }
  | { readonly kind: 'waiting'; readonly status: 'waiting' }
  | { readonly kind: 'terminal'; readonly status: RunTerminalStatus }
  | { readonly kind: 'started'; readonly status: 'running' }
  | { readonly kind: 'already-started'; readonly status: 'running' }
  | { readonly kind: 'committed'; readonly status: RunTerminalStatus }
  | { readonly kind: 'waited'; readonly status: 'waiting' }
  | { readonly kind: 'resolved'; readonly status: 'queued' }
  | { readonly kind: 'stale'; readonly status: RunStatus }

export type RunClaim = Extract<RunTransition, { readonly kind: 'ready' | 'running' | 'terminal' | 'waiting' }>
export type RunStart = Extract<RunTransition, { readonly kind: 'already-started' | 'started' | 'stale' }>

export function isRunTerminal(status: RunStatus): status is RunTerminalStatus {
  return status == 'canceled' || status == 'completed' || status == 'failed' || status == 'indeterminate'
}

export function transitionRun(status: RunStatus, operation: RunOperation): RunTransition {
  switch (operation.kind) {
    case 'claim':
      switch (status) {
        case 'queued':
        case 'starting':
          return { kind: 'ready', status: 'starting' }
        case 'running':
          return { kind: 'running', status }
        case 'waiting':
          return { kind: 'waiting', status }
        case 'canceled':
        case 'completed':
        case 'failed':
        case 'indeterminate':
          return { kind: 'terminal', status }
      }
    case 'start':
      switch (status) {
        case 'starting':
          return { kind: 'started', status: 'running' }
        case 'running':
          return { kind: 'already-started', status }
        case 'queued':
        case 'waiting':
        case 'canceled':
        case 'completed':
        case 'failed':
        case 'indeterminate':
          return { kind: 'stale', status }
      }
    case 'wait':
      return status == 'running' ? { kind: 'waited', status: 'waiting' } : { kind: 'stale', status }
    case 'resolve':
      return status == 'waiting' ? { kind: 'resolved', status: 'queued' } : { kind: 'stale', status }
    case 'commit':
      if (isRunTerminal(status)) return { kind: 'stale', status }
      if (operation.status == 'canceled' || status == 'running' || (operation.status == 'failed' && status == 'waiting')) {
        return { kind: 'committed', status: operation.status }
      }
      return { kind: 'stale', status }
  }
}

export type RunAcceptance =
  | { readonly created: boolean; readonly kind: 'accepted'; readonly runId: string; readonly status: RunStatus }
  | { readonly kind: 'conflict' }

export interface RunObservation {
  readonly status: RunStatus
  readonly terminalEvents: readonly RunTerminalStatus[]
}

export interface RunLifecycleHarness {
  accept(input: { readonly idempotencyKey: string; readonly requestDigest: string }): Promise<RunAcceptance>
  claim(runId: string): Promise<RunClaim>
  commit(runId: string, status: RunTerminalStatus): Promise<boolean>
  observe(runId: string): Promise<RunObservation>
  resolve(runId: string): Promise<boolean>
  start(runId: string): Promise<RunStart>
  wait(runId: string): Promise<boolean>
}

export interface RunLifecycleConformanceCase {
  readonly name: string
  verify(harness: RunLifecycleHarness): Promise<void>
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (!dequal(actual, expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
  }
}

async function accepted(harness: RunLifecycleHarness, idempotencyKey: string = 'request', requestDigest: string = 'request-a'): Promise<string> {
  const result = await harness.accept({ idempotencyKey, requestDigest })
  if (result.kind != 'accepted') throw new Error('Run acceptance unexpectedly conflicted.')
  return result.runId
}

export const runLifecycleConformanceCases: readonly RunLifecycleConformanceCase[] = [
  {
    name: 'pauses and resumes the same Run through the ordinary start barrier',
    async verify(harness) {
      const runId = await accepted(harness)
      const claimed = await harness.claim(runId)
      if (claimed.kind != 'ready') throw new Error('Initial Run claim was not ready.')
      equal(await harness.start(runId), transitionRun(claimed.status, { kind: 'start' }), 'Initial start')
      equal(await harness.wait(runId), true, 'Wait commit')
      equal(await harness.observe(runId), { status: 'waiting', terminalEvents: [] }, 'Waiting Run observation')
      equal(await harness.claim(runId), transitionRun('waiting', { kind: 'claim' }), 'Claim while waiting')
      equal(await harness.resolve(runId), true, 'Wait resolution')
      equal(await harness.resolve(runId), false, 'Repeated Wait resolution')
      const resumeClaim = await harness.claim(runId)
      if (resumeClaim.kind != 'ready') throw new Error('Resolved Run claim was not ready.')
      equal(await harness.start(runId), transitionRun(resumeClaim.status, { kind: 'start' }), 'Resume start')
      equal(await harness.commit(runId, 'completed'), true, 'Completion after resume')
      equal(await harness.observe(runId), { status: 'completed', terminalEvents: ['completed'] }, 'Resumed Run observation')
    },
  },
  {
    name: 'allows cancellation and expiry failure while waiting',
    async verify(harness) {
      const canceledRunId = await accepted(harness, 'cancel-wait')
      const canceledClaim = await harness.claim(canceledRunId)
      if (canceledClaim.kind != 'ready') throw new Error('Canceled Run claim was not ready.')
      await harness.start(canceledRunId)
      equal(await harness.wait(canceledRunId), true, 'Canceled Run Wait commit')
      equal(await harness.commit(canceledRunId, 'canceled'), true, 'Waiting cancellation')
      equal(await harness.resolve(canceledRunId), false, 'Resolution after cancellation')

      const expiredRunId = await accepted(harness, 'expire-wait')
      const expiredClaim = await harness.claim(expiredRunId)
      if (expiredClaim.kind != 'ready') throw new Error('Expired Run claim was not ready.')
      await harness.start(expiredRunId)
      equal(await harness.wait(expiredRunId), true, 'Expired Run Wait commit')
      equal(await harness.commit(expiredRunId, 'failed'), true, 'Waiting expiry failure')
      equal(await harness.observe(expiredRunId), { status: 'failed', terminalEvents: ['failed'] }, 'Expired Run observation')
    },
  },
  {
    name: 'replays idempotent acceptance and rejects a conflicting request',
    async verify(harness) {
      const first = await harness.accept({ idempotencyKey: 'same-key', requestDigest: 'request-a' })
      if (first.kind != 'accepted') throw new Error('Initial Run acceptance unexpectedly conflicted.')
      equal(first.created, true, 'Initial acceptance creation')
      equal(first.status, 'queued', 'Initial acceptance status')
      equal(await harness.accept({ idempotencyKey: 'same-key', requestDigest: 'request-a' }), { ...first, created: false }, 'Idempotent replay')
      equal(await harness.accept({ idempotencyKey: 'same-key', requestDigest: 'request-b' }), { kind: 'conflict' }, 'Conflicting replay')
      equal(await harness.observe(first.runId), { status: 'queued', terminalEvents: [] }, 'Accepted Run observation')
    },
  },
  {
    name: 'cancels before the start barrier and preserves one terminal',
    async verify(harness) {
      const runId = await accepted(harness)
      equal(await harness.commit(runId, 'canceled'), true, 'Cancellation commit')
      equal(await harness.claim(runId), transitionRun('canceled', { kind: 'claim' }), 'Claim after cancellation')
      equal(await harness.commit(runId, 'completed'), false, 'Completion after cancellation')
      equal(await harness.observe(runId), { status: 'canceled', terminalEvents: ['canceled'] }, 'Canceled Run observation')
    },
  },
  {
    name: 'recovers before the start barrier without creating another Run',
    async verify(harness) {
      const runId = await accepted(harness)
      const firstClaim = transitionRun('queued', { kind: 'claim' })
      equal(await harness.claim(runId), firstClaim, 'Initial claim')
      const recoveredClaim = transitionRun(firstClaim.status, { kind: 'claim' })
      equal(await harness.claim(runId), recoveredClaim, 'Recovered claim')
      const started = transitionRun(recoveredClaim.status, { kind: 'start' })
      equal(await harness.start(runId), started, 'Start after recovery')
      equal(await harness.commit(runId, 'completed'), true, 'Completion after recovery')
      equal(await harness.observe(runId), { status: 'completed', terminalEvents: ['completed'] }, 'Recovered Run observation')
    },
  },
  {
    name: 'marks recovery after the start barrier indeterminate',
    async verify(harness) {
      const runId = await accepted(harness)
      const claimed = transitionRun('queued', { kind: 'claim' })
      equal(await harness.claim(runId), claimed, 'Initial claim')
      const started = transitionRun(claimed.status, { kind: 'start' })
      equal(await harness.start(runId), started, 'Start barrier')
      equal(await harness.claim(runId), transitionRun(started.status, { kind: 'claim' }), 'Claim after start barrier')
      equal(await harness.commit(runId, 'indeterminate'), true, 'Indeterminate commit')
      equal(await harness.commit(runId, 'completed'), false, 'Completion after indeterminate')
      equal(await harness.observe(runId), { status: 'indeterminate', terminalEvents: ['indeterminate'] }, 'Indeterminate Run observation')
    },
  },
  {
    name: 'allows exactly one terminal to win cancellation and completion',
    async verify(harness) {
      const runId = await accepted(harness)
      const claimed = transitionRun('queued', { kind: 'claim' })
      equal(await harness.claim(runId), claimed, 'Initial claim')
      equal(await harness.start(runId), transitionRun(claimed.status, { kind: 'start' }), 'Start barrier')
      const commits = await Promise.all([harness.commit(runId, 'canceled'), harness.commit(runId, 'completed')])
      equal(commits.filter(Boolean).length, 1, 'Accepted terminal count')
      const observation = await harness.observe(runId)
      if (observation.status != 'canceled' && observation.status != 'completed') {
        throw new Error(`Terminal race produced ${observation.status}.`)
      }
      equal(observation.terminalEvents, [observation.status], 'Terminal race events')
    },
  },
]
