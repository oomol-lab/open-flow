import { describe, expect, it, vi } from 'vitest'
import { deferInputSourceQuery } from './useInputSourceQuery.ts'

describe('Deferred input source work', () => {
  it('yields before computing and resolves the result', async () => {
    vi.useFakeTimers()
    try {
      const calculate = vi.fn(() => ['source'])
      const result = deferInputSourceQuery(calculate, new AbortController().signal)
      expect(calculate).not.toHaveBeenCalled()
      await vi.runAllTimersAsync()
      expect(await result).toEqual(['source'])
    } finally {
      vi.useRealTimers()
    }
  })
  it('cancels obsolete selection work before it runs', async () => {
    vi.useFakeTimers()
    try {
      const old = new AbortController()
      const calculate = vi.fn()
      const result = deferInputSourceQuery(calculate, old.signal)
      const rejected = expect(result).rejects.toBe('selection changed')
      old.abort('selection changed')
      await vi.runAllTimersAsync()
      await rejected
      expect(calculate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
