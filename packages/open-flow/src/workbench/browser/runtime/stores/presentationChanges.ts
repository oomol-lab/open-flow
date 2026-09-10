import type { I18n } from 'val-i18n'
import type { WorkbenchClient, JsonValue, Presentation } from '../api.ts'
import type { Current } from './latest.ts'
import type { SetNotice } from './workbenchNotice.ts'

import { dequal } from 'dequal/lite'
import { ApiError } from '../api.ts'
import { errorNotice } from './workbenchNotice.ts'

export type PresentationUpdate = (value: Readonly<Record<string, JsonValue>>) => Readonly<Record<string, JsonValue>>

interface PendingChange {
  readonly current: Current
  readonly flowId: string
  readonly update: PresentationUpdate
}

export class PresentationChanges {
  readonly #client: WorkbenchClient
  readonly #i18n: I18n
  readonly #setNotice: SetNotice
  readonly #setPresentation: (presentation: Presentation) => void
  #changes: Promise<void> = Promise.resolve()
  #committed?: Presentation
  #disposed = false
  #pending: PendingChange[] = []

  public constructor(client: WorkbenchClient, setNotice: SetNotice, setPresentation: (presentation: Presentation) => void, i18n: I18n) {
    this.#client = client
    this.#setNotice = setNotice
    this.#setPresentation = setPresentation
    this.#i18n = i18n
  }

  public reset(presentation?: Presentation): void {
    this.#committed = presentation
    this.#pending = []
  }

  public dispose(): void {
    this.#disposed = true
    this.#pending = []
  }

  public async settled(): Promise<void> {
    await this.#changes
  }

  public async change(flowId: string, presentation: Presentation, current: Current, update: PresentationUpdate): Promise<boolean> {
    if (this.#disposed || this.#committed == null) return false
    const value = update(presentation.value)
    if (dequal(value, presentation.value)) return true
    const pending = { current, flowId, update }
    this.#pending.push(pending)
    this.#setPresentation({ ...presentation, value })
    let success = false
    this.#changes = this.#changes.then(async () => {
      if (this.#disposed || !current()) return
      const committed = this.#committed!
      const nextValue = update(committed.value)
      if (dequal(nextValue, committed.value)) {
        this.#finish(pending, committed)
        success = true
        return
      }
      try {
        const saved = await this.#client.updatePresentation(flowId, committed.revision, nextValue)
        if (this.#disposed || !current()) return
        this.#finish(pending, saved)
        success = true
      } catch (error) {
        if (this.#disposed || !current()) return
        if (error instanceof ApiError && error.code == 'flow.presentation-conflict') {
          try {
            const latest = await this.#client.getPresentation(flowId)
            if (this.#disposed || !current()) return
            this.#finish(pending, latest)
            this.#setNotice({
              kind: 'error',
              message: this.#i18n.t('notice.layoutConflict'),
            })
          } catch (reloadError) {
            if (!this.#disposed && current()) this.#finish(pending, committed)
            if (!this.#disposed && current()) this.#setNotice(errorNotice(reloadError, this.#i18n.t))
          }
        } else {
          this.#finish(pending, committed)
          this.#setNotice(errorNotice(error, this.#i18n.t))
        }
      }
    })
    await this.#changes
    return success
  }

  #finish(pending: PendingChange, committed: Presentation): void {
    this.#pending = this.#pending.filter((change) => change !== pending)
    this.#committed = committed
    const value = this.#pending.reduce((current, change) => change.update(current), committed.value)
    this.#setPresentation(value === committed.value ? committed : { ...committed, value })
  }
}
