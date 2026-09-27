import type { WorkbenchActor, WorkbenchHost } from '../contract.ts'

/** Session-local LRU of complete identity responses, including missing actors. */
export class ActorStore {
  readonly #cache = new Map<string, { readonly value: WorkbenchActor | null; readonly expiresAt: number }>()
  readonly #pending = new Map<string, Promise<WorkbenchActor | null>>()
  readonly #controller = new AbortController()

  constructor(
    private readonly resolve?: WorkbenchHost['resolveActor'],
    private readonly capacity = 128,
    private readonly ttlMs = 24 * 60 * 60_000,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('Invalid actor cache limits.')
  }

  get(actorId: string): Promise<WorkbenchActor | null> {
    if (this.#controller.signal.aborted || this.resolve == null) return Promise.resolve(null)
    const cached = this.#cache.get(actorId)
    if (cached != null) {
      this.#cache.delete(actorId)
      if (cached.expiresAt > this.now()) {
        this.#cache.set(actorId, cached)
        return Promise.resolve(cached.value)
      }
    }
    const pending = this.#pending.get(actorId)
    if (pending != null) return pending
    const request = Promise.resolve()
      .then(() => this.resolve!(actorId, this.#controller.signal))
      .then((value) => {
        if (!this.#controller.signal.aborted) {
          this.#cache.set(actorId, { value, expiresAt: this.now() + this.ttlMs })
          while (this.#cache.size > this.capacity) this.#cache.delete(this.#cache.keys().next().value!)
        }
        return value
      })
      .finally(() => this.#pending.delete(actorId))
    this.#pending.set(actorId, request)
    return request
  }

  dispose(): void {
    this.#controller.abort()
    this.#cache.clear()
    this.#pending.clear()
  }
}
