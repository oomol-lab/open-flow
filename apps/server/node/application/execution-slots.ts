import * as Effect from 'effect/Effect'
import * as Semaphore from 'effect/Semaphore'

export class ExecutionSlots {
  readonly #semaphore: Semaphore.Semaphore
  readonly #leases = new Map<string, { runId: string; abort: AbortController; held: boolean; ready: Promise<void> }>()

  constructor(limit: number) {
    this.#semaphore = Semaphore.makeUnsafe(limit)
  }

  acquire(runId: string, jobId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const key = JSON.stringify([runId, jobId])
    const existing = this.#leases.get(key)
    if (existing != null) return existing.ready
    const lease = { runId, abort: new AbortController(), held: false, ready: Promise.resolve() }
    this.#leases.set(key, lease)
    lease.ready = Effect.runPromise(
      Effect.uninterruptibleMask((restore) =>
        restore(this.#semaphore.take(1)).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              lease.held = true
            }),
          ),
        ),
      ),
      { signal: AbortSignal.any([signal, lease.abort.signal]) },
    ).then(
      () => undefined,
      (error: unknown) => {
        if (this.#leases.get(key) == lease) this.#leases.delete(key)
        if (lease.held) {
          lease.held = false
          Effect.runSync(this.#semaphore.release(1))
        }
        throw error
      },
    )
    return lease.ready
  }

  release(runId: string, jobId: string): void {
    const key = JSON.stringify([runId, jobId])
    const lease = this.#leases.get(key)
    if (lease == null) return
    this.#leases.delete(key)
    lease.abort.abort(new Error('Node execution ended.'))
    if (lease.held) {
      lease.held = false
      Effect.runSync(this.#semaphore.release(1))
    }
  }

  releaseRun(runId: string): void {
    for (const [key, lease] of this.#leases) {
      if (lease.runId != runId) continue
      this.#leases.delete(key)
      lease.abort.abort(new Error('Run execution ended.'))
      if (lease.held) {
        lease.held = false
        Effect.runSync(this.#semaphore.release(1))
      }
    }
  }
}
