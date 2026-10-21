import type { RunRecord } from '../storage/run-view-store.ts'

export type WebhookRunOutcome =
  | { readonly kind: 'completed'; readonly result: unknown }
  | { readonly kind: 'failed' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' }

/** Observe committed state, including completion before subscription and idempotent replays. */
export function waitForWebhookRun(
  read: () => RunRecord | undefined,
  subscribe: (changed: () => void) => () => void,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<WebhookRunOutcome> {
  return new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (outcome: WebhookRunOutcome) => {
      if (settled) return
      settled = true
      unsubscribe?.()
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      resolve(outcome)
    }
    const abort = () => finish({ kind: 'aborted' })
    const inspect = () => {
      const run = read()
      if (run == null) return finish({ kind: 'failed' })
      if (run.status == 'completed') return finish({ kind: 'completed', result: run.result })
      if (run.status == 'failed' || run.status == 'canceled' || run.status == 'indeterminate') {
        const error = run.result as { error?: { code?: string } } | undefined
        finish({ kind: error?.error?.code == 'run.timeout' ? 'timeout' : 'failed' })
      }
    }
    unsubscribe = subscribe(inspect)
    if (settled) unsubscribe()
    else {
      timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      else inspect()
    }
  })
}
