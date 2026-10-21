import type { WebhookResponseSnapshot } from '@oomol-lab/open-flow/webhook-trigger'
import type { RunRecord } from '../storage/run-view-store.ts'

export type WebhookRunOutcome =
  | { readonly kind: 'completed'; readonly result: unknown }
  | { readonly kind: 'responded'; readonly response: WebhookResponseSnapshot }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed'; readonly code?: string }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' }

/** Observe committed state, including completion before subscription and idempotent replays. */
export function waitForWebhookRun(
  read: () => RunRecord | undefined,
  subscribe: (changed: () => void) => () => void,
  timeoutMs: number,
  signal: AbortSignal,
  readResponse?: () => WebhookResponseSnapshot | undefined,
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
      const response = readResponse?.()
      if (response != null) return finish({ kind: 'responded', response })
      if (run.status === 'completed' && readResponse != null) return finish({ kind: 'unavailable' })
      if (run.status == 'completed') return finish({ kind: 'completed', result: run.result })
      if (run.status == 'failed' || run.status == 'canceled' || run.status == 'indeterminate') {
        const error = run.result as { error?: { code?: string } } | undefined
        finish(error?.error?.code === 'run.timeout' ? { kind: 'timeout' } : { kind: 'failed', code: error?.error?.code })
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
