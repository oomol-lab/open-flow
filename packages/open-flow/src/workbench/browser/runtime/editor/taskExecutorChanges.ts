import type { ManagedTaskExecutor } from '../../../../flow/common/change.ts'

import { dequal } from 'dequal/lite'

export class TaskExecutorChanges<Metadata = undefined> {
  public value: ManagedTaskExecutor
  #saved: ManagedTaskExecutor
  readonly #pending: { value: ManagedTaskExecutor; metadata?: Metadata }[] = []
  #running?: Promise<boolean>
  readonly #write: (before: ManagedTaskExecutor, value: ManagedTaskExecutor, metadata?: Metadata) => Promise<boolean>

  public constructor(value: ManagedTaskExecutor, write: (before: ManagedTaskExecutor, value: ManagedTaskExecutor, metadata?: Metadata) => Promise<boolean>) {
    this.value = value
    this.#saved = value
    this.#write = write
  }

  public sync(value: ManagedTaskExecutor): void {
    if (this.#running != null || this.#pending.length > 0 || !dequal(this.value, this.#saved)) return
    this.value = value
    this.#saved = value
  }

  public save(metadata?: Metadata): Promise<boolean> {
    // Intermediate edits carry meaning: merging a deletion and an addition can look like a rename.
    if (!dequal(this.value, this.#pending.at(-1)?.value ?? this.#saved)) this.#pending.push({ value: this.value, metadata })
    if (this.#pending.length === 0) return Promise.resolve(true)
    if (this.#running != null) return this.#running
    this.#running = this.#flush().finally(() => {
      this.#running = undefined
    })
    return this.#running
  }

  async #flush(): Promise<boolean> {
    while (this.#pending.length > 0) {
      const { value, metadata } = this.#pending[0]!
      // Keep the failed entry and its successors for an explicit retry.
      if (!(await this.#write(this.#saved, value, metadata))) return false
      this.#saved = value
      this.#pending.shift()
    }
    return true
  }
}
