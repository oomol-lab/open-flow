import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserDesignerConfirmation } from '../../src/designer/browser/confirmation.ts'
import { BrowserDesignerNotification } from '../../src/designer/browser/notification.ts'

describe('browser Designer capabilities', () => {
  afterEach(() => vi.restoreAllMocks())

  it('uses injected confirmation and notification actions', async () => {
    const calls: string[] = []
    const confirmation = new BrowserDesignerConfirmation({
      onConfirm: async (message) => {
        calls.push(`confirm:${message}`)
        return true
      },
    })
    const notification = new BrowserDesignerNotification((level, message) => calls.push(`${level}:${message}`))
    notification.onDidNotify(({ level, message }) => calls.push(`event:${level}:${message}`))

    expect(await confirmation.confirm('Continue?')).toBe(true)
    notification.success('Saved')
    notification.error('Failed')

    expect(calls).toEqual(['confirm:Continue?', 'event:success:Saved', 'success:Saved', 'event:error:Failed', 'error:Failed'])
    notification.dispose()
  })
})
