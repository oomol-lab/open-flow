import * as Effect from 'effect/Effect'
import * as Semaphore from 'effect/Semaphore'

type LeasePhase = 'ended' | 'held' | 'idle' | 'suspended' | 'taking'

interface Lease {
  readonly runId: string
  readonly abort: AbortController
  phase: LeasePhase
  /** Outstanding child waits; the lease holds no permit while any remain. */
  suspensions: number
  taking: Promise<void> | undefined
}

/** Deployment-wide Task budget, held per node invocation and lent out while it waits for children. */
export class ExecutionSlots {
  readonly #semaphore: Semaphore.Semaphore
  readonly #leases = new Map<string, Lease>()

  constructor(limit: number) {
    this.#semaphore = Semaphore.makeUnsafe(limit)
  }

  /** Admits one node invocation; repeated admission of a live invocation shares its lease. */
  acquire(runId: string, jobId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const key = JSON.stringify([runId, jobId])
    let lease = this.#leases.get(key)
    if (lease == null) {
      lease = { runId, abort: new AbortController(), phase: 'idle', suspensions: 0, taking: undefined }
      this.#leases.set(key, lease)
    }
    return this.#hold(lease, signal)
  }

  /** Lends the permit to child work until every overlapping child wait has resumed. */
  suspend(runId: string, jobId: string): void {
    const lease = this.#leases.get(JSON.stringify([runId, jobId]))
    if (lease == null) return
    lease.suspensions++
    if (lease.suspensions == 1) this.#drop(lease)
  }

  /** Ends one child wait; the last one reacquires the permit before the invocation continues. */
  resume(runId: string, jobId: string, signal: AbortSignal): Promise<void> {
    const key = JSON.stringify([runId, jobId])
    const lease = this.#leases.get(key)
    if (lease == null || lease.suspensions == 0) return Promise.resolve()
    lease.suspensions--
    return lease.suspensions > 0 ? Promise.resolve() : this.#hold(lease, signal)
  }

  release(runId: string, jobId: string): void {
    const key = JSON.stringify([runId, jobId])
    const lease = this.#leases.get(key)
    if (lease != null) this.#end(key, lease, 'Node execution ended.')
  }

  releaseRun(runId: string): void {
    for (const [key, lease] of this.#leases) if (lease.runId == runId) this.#end(key, lease, 'Run execution ended.')
  }

  #hold(lease: Lease, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    if (lease.phase == 'held' || lease.suspensions > 0) return Promise.resolve()
    if (lease.phase == 'taking') return lease.taking!
    lease.phase = 'taking'
    const taking = Effect.runPromise(
      Effect.uninterruptibleMask((restore) =>
        restore(this.#semaphore.take(1)).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              // A permit that arrives after the lease ended or lent itself out is returned immediately.
              if (lease.phase == 'ended' || lease.suspensions > 0) {
                lease.phase = lease.phase == 'ended' ? 'ended' : 'suspended'
                return Effect.asVoid(this.#semaphore.release(1))
              }
              lease.phase = 'held'
              return Effect.void
            }),
          ),
        ),
      ),
      { signal: AbortSignal.any([signal, lease.abort.signal]) },
    ).then(
      () => {
        if (lease.taking == taking) lease.taking = undefined
      },
      (error: unknown) => {
        // The lease itself ends only through release or releaseRun.
        if (lease.taking == taking) lease.taking = undefined
        if (lease.phase == 'taking') lease.phase = lease.suspensions > 0 ? 'suspended' : 'idle'
        throw error
      },
    )
    lease.taking = taking
    return taking
  }

  #drop(lease: Lease): void {
    if (lease.phase != 'held') {
      if (lease.suspensions > 0 && lease.phase == 'idle') lease.phase = 'suspended'
      return
    }
    lease.phase = lease.suspensions > 0 ? 'suspended' : 'idle'
    Effect.runSync(this.#semaphore.release(1))
  }

  #end(key: string, lease: Lease, reason: string): void {
    this.#leases.delete(key)
    lease.abort.abort(new Error(reason))
    const held = lease.phase == 'held'
    lease.phase = 'ended'
    if (held) Effect.runSync(this.#semaphore.release(1))
  }
}
