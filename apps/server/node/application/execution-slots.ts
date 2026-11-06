import * as Effect from 'effect/Effect'
import * as Semaphore from 'effect/Semaphore'

interface Lease {
  readonly runId: string
  readonly abort: AbortController
  held: boolean
  /** Outstanding child waits; the lease holds no permit while any remain. */
  suspended: number
  taking: Promise<void> | undefined
  ended: boolean
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
      lease = { runId, abort: new AbortController(), held: false, suspended: 0, taking: undefined, ended: false }
      this.#leases.set(key, lease)
    }
    return this.#hold(lease, signal)
  }

  /** Lends the permit to child work until every overlapping child wait has resumed. */
  suspend(runId: string, jobId: string): void {
    const lease = this.#leases.get(JSON.stringify([runId, jobId]))
    if (lease == null) return
    lease.suspended++
    if (lease.suspended == 1) this.#drop(lease)
  }

  /** Ends one child wait; the last one reacquires the permit before the invocation continues. */
  resume(runId: string, jobId: string, signal: AbortSignal): Promise<void> {
    const key = JSON.stringify([runId, jobId])
    const lease = this.#leases.get(key)
    if (lease == null || lease.suspended == 0) return Promise.resolve()
    lease.suspended--
    return lease.suspended > 0 ? Promise.resolve() : this.#hold(lease, signal)
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
    if (lease.held || lease.suspended > 0) return Promise.resolve()
    if (lease.taking != null) return lease.taking
    const taking = Effect.runPromise(
      Effect.uninterruptibleMask((restore) =>
        restore(this.#semaphore.take(1)).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              // A permit that arrives after the lease ended or lent itself out is returned immediately.
              if (lease.ended || lease.suspended > 0) return Effect.asVoid(this.#semaphore.release(1))
              lease.held = true
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
        throw error
      },
    )
    lease.taking = taking
    return taking
  }

  #drop(lease: Lease): void {
    if (!lease.held) return
    lease.held = false
    Effect.runSync(this.#semaphore.release(1))
  }

  #end(key: string, lease: Lease, reason: string): void {
    this.#leases.delete(key)
    lease.ended = true
    lease.abort.abort(new Error(reason))
    this.#drop(lease)
  }
}
