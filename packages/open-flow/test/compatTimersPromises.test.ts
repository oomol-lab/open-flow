import { expect, test, vi } from 'vitest'
// @ts-expect-error The guest shim is plain JavaScript without type declarations.
import { setInterval } from '../scripts/nodejs-builtins/compat-timers-promises.js'

test('a promise interval drains queued ticks before rejecting on abort', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const reason = new Error('cancel interval')
  const iterator = setInterval(5, 'tick', { signal: controller.signal })

  try {
    const first = iterator.next()
    vi.advanceTimersByTime(10)
    expect(await first).toEqual({ done: false, value: 'tick' })

    controller.abort(reason)
    vi.advanceTimersByTime(10)
    expect(await iterator.next()).toEqual({ done: false, value: 'tick' })
    await expect(iterator.next()).rejects.toMatchObject({ code: 'ABORT_ERR', cause: reason })
  } finally {
    try {
      await iterator.return()
    } finally {
      vi.useRealTimers()
    }
  }
})
