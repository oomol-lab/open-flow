import { toast } from 'sonner'
import { beforeEach, expect, it, vi } from 'vitest'
import { notify } from '../browser/notifications.ts'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }))

beforeEach(() => {
  notify(undefined)
  vi.clearAllMocks()
})

it('keeps consecutive workbench notices independent so they can stack', () => {
  vi.mocked(toast.success).mockReturnValueOnce(1).mockReturnValueOnce(2)
  notify({ kind: 'success', message: 'Saved' })
  notify({ kind: 'success', message: 'Saved again' })
  expect(toast.success).toHaveBeenNthCalledWith(1, 'Saved', expect.objectContaining({ duration: 4000 }))
  expect(vi.mocked(toast.success).mock.calls[0]?.[1]).not.toHaveProperty('id')
  expect(toast.dismiss).not.toHaveBeenCalled()
  notify(undefined)
  expect(vi.mocked(toast.dismiss).mock.calls).toEqual([[1], [2]])
})

it('clears only active workbench notices and preserves the longer error duration', () => {
  vi.mocked(toast.success).mockReturnValueOnce(3)
  vi.mocked(toast.error).mockReturnValueOnce(4)
  notify({ kind: 'success', message: 'Saved' })
  notify({ kind: 'error', message: 'Unable to save' })
  expect(toast.error).toHaveBeenCalledWith('Unable to save', expect.objectContaining({ duration: 8000 }))
  vi.mocked(toast.success).mock.calls[0]?.[1]?.onAutoClose?.({ id: 3, title: 'Saved' })
  notify(undefined)
  expect(vi.mocked(toast.dismiss).mock.calls).toEqual([[4]])
  vi.mocked(toast.dismiss).mockClear()
  notify(undefined)
  expect(toast.dismiss).not.toHaveBeenCalled()
})

it('forgets manually dismissed notices', () => {
  vi.mocked(toast.success).mockReturnValueOnce(5)
  notify({ kind: 'success', message: 'Saved' })
  vi.mocked(toast.success).mock.calls[0]?.[1]?.onDismiss?.({ id: 5, title: 'Saved' })
  notify(undefined)
  expect(toast.dismiss).not.toHaveBeenCalled()
})

it('forgets a notification when its Undo action dismisses it', () => {
  vi.mocked(toast.success).mockReturnValueOnce(6)
  const run = vi.fn(async () => {})
  notify({ kind: 'success', message: 'Node deleted.', undo: { label: 'Undo', run } })
  const action = vi.mocked(toast.success).mock.calls[0]?.[1]?.action
  if (action == null || typeof action != 'object' || !('onClick' in action)) throw new Error('Expected Undo action')
  action.onClick({} as Parameters<typeof action.onClick>[0])
  expect(run).toHaveBeenCalledOnce()
  notify(undefined)
  expect(toast.dismiss).not.toHaveBeenCalled()
})
