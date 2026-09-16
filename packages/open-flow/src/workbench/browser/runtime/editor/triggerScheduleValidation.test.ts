import { expect, it, vi } from 'vitest'
import { deferScheduleCheck } from './triggerScheduleValidation.ts'

it('defers schedule validation beyond the current call stack', async () => {
  const check = vi.fn(() => 'valid')
  const result = deferScheduleCheck(check, new AbortController().signal)
  expect(check).not.toHaveBeenCalled()
  await expect(result).resolves.toBe('valid')
  expect(check).toHaveBeenCalledOnce()
})

it('cancels stale schedule validation before it runs', async () => {
  const controller = new AbortController()
  const check = vi.fn(() => 'stale')
  const result = deferScheduleCheck(check, controller.signal)
  controller.abort()
  await expect(result).rejects.toBeInstanceOf(DOMException)
  expect(check).not.toHaveBeenCalled()
})
