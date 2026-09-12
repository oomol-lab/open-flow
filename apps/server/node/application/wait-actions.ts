import type { WaitAction } from '@oomol-lab/open-flow/flow-change'
import type { Store } from '../storage/store.ts'

import { createHash } from 'node:crypto'

export class WaitActions {
  readonly #clock: () => number
  readonly #runChanged: (flowId: string, runId: string) => void
  readonly #signal: () => void
  readonly #store: Store

  constructor(store: Store, clock: () => number, runChanged: (flowId: string, runId: string) => void, signal: () => void) {
    this.#clock = clock
    this.#runChanged = runChanged
    this.#signal = signal
    this.#store = store
  }

  inspect(
    capability: string,
    requested: WaitAction,
    admit: (digest: string) => number | undefined,
  ):
    | { readonly action: WaitAction; readonly expiresAt: string; readonly prompt: string; readonly state: 'resolved' | 'waiting' }
    | { readonly retryAfter: number }
    | undefined {
    const digest = createHash('sha256').update(capability).digest('hex')
    const receipt = this.#store.runViews.waitByCapability(digest)
    if (receipt == null) return
    const wait = this.#store.runViews.waitReceipt(receipt.runId, receipt.waitId)
    if (wait == null || !wait.actions.some((action) => action == requested) || receipt.expiresAt <= this.#clock()) return
    if (receipt.action == null && (receipt.status != 'waiting' || receipt.expiresAt <= this.#clock())) return
    const retryAfter = admit(digest)
    if (retryAfter != null) return { retryAfter }
    if (receipt.action != null) {
      return { action: receipt.action, expiresAt: new Date(receipt.expiresAt).toISOString(), prompt: wait.prompt, state: 'resolved' }
    }
    return { action: requested, expiresAt: new Date(receipt.expiresAt).toISOString(), prompt: wait.prompt, state: 'waiting' }
  }

  resolve(
    capability: string,
    requested: WaitAction,
    admit: (digest: string) => number | undefined,
  ):
    | {
        readonly action: WaitAction | null
        readonly resolutionAccepted: boolean
        readonly resolvedAt: string | null
        readonly state: 'resolved' | 'unavailable' | 'waiting'
      }
    | { readonly retryAfter: number }
    | undefined {
    const digest = createHash('sha256').update(capability).digest('hex')
    const receipt = this.#store.runViews.waitByCapability(digest)
    if (receipt == null) return
    const wait = this.#store.runViews.waitReceipt(receipt.runId, receipt.waitId)
    if (wait == null || !wait.actions.some((action) => action == requested) || receipt.expiresAt <= this.#clock()) return
    const retryAfter = admit(digest)
    if (retryAfter != null) return { retryAfter }
    const result = this.#store.runs.resolveWait(receipt.runId, receipt.waitId, requested)
    if (result.kind != 'resolved') return
    if (result.changed) {
      this.#runChanged(receipt.flowId, receipt.runId)
      if (result.status == 'queued') this.#signal()
    }
    return {
      action: result.action,
      resolutionAccepted: result.resolutionAccepted,
      resolvedAt: result.resolvedAt == null ? null : new Date(result.resolvedAt).toISOString(),
      state: result.action != null ? 'resolved' : result.status == 'waiting' ? 'waiting' : 'unavailable',
    }
  }
}
