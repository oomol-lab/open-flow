import { useEffect, useState } from 'react'

/** Yield the selection/menu event before doing bounded, per-field graph work. */
export function deferInputSourceQuery<T>(calculate: () => T, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let cancel: (() => void) | undefined
    const abort = () => {
      cancel?.()
      signal.removeEventListener('abort', abort)
      reject(signal.reason)
    }
    if (signal.aborted) return abort()
    const run = () => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) return reject(signal.reason)
      try {
        resolve(calculate())
      } catch (error) {
        reject(error)
      }
    }
    if (typeof globalThis.requestIdleCallback === 'function') {
      const id = globalThis.requestIdleCallback(run, { timeout: 200 })
      cancel = () => globalThis.cancelIdleCallback(id)
    } else {
      const id = globalThis.setTimeout(run, 0)
      cancel = () => globalThis.clearTimeout(id)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

export function useInputSourceQuery<T>(calculate: (() => T) | undefined, enabled: boolean) {
  const [result, setResult] = useState<{ calculate: () => T; value?: T; failed?: boolean }>()
  useEffect(() => {
    if (!enabled || calculate == null) return
    const controller = new AbortController()
    void deferInputSourceQuery(calculate, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setResult({ calculate, value })
      },
      () => {
        if (!controller.signal.aborted) setResult({ calculate, failed: true })
      },
    )
    return () => controller.abort()
  }, [calculate, enabled])
  const current = result?.calculate === calculate ? result : undefined
  return { value: current?.value, failed: current?.failed === true, pending: enabled && calculate != null && current == null }
}
