// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import type { RetryConfiguration } from '../../../../flow/common/change.ts'

import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { RetrySettings } from './retrySettings.tsx'

let root: Root
let container: HTMLDivElement
const save = vi.fn()
function Settings({ initial, disabled = false }: { initial?: RetryConfiguration; disabled?: boolean }) {
  const [retry, setRetry] = useState(initial)
  return (
    <I18nProvider i18n={createI18n('zh-CN')}>
      <RetrySettings
        nodeId="task"
        retry={retry}
        disabled={disabled}
        onSave={(value) => {
          save(value)
          setRetry(value)
        }}
      />
    </I18nProvider>
  )
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  save.mockClear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})
async function choose(label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>('[role="combobox"]')!.click())
  const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent === label)!
  expect(option).toBeDefined()
  await act(async () => {
    option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    option.click()
  })
}
async function interval(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  return input
}
it('enables by count, preserves the interval when changing count, and deletes the disabled policy', async () => {
  await act(async () => root.render(<Settings />))
  expect(container.textContent).toContain('不重试')
  expect(container.querySelector('input[type="number"]')).toBeNull()
  expect(save).not.toHaveBeenCalled()
  await choose('最多重试 2 次')
  expect(save).toHaveBeenLastCalledWith({ maxRetries: 2, intervalMs: 2000 })
  await interval('7')
  await choose('最多重试 5 次')
  expect(save).toHaveBeenLastCalledWith({ maxRetries: 5, intervalMs: 7000 })
  await choose('不重试')
  expect(save).toHaveBeenLastCalledWith(undefined)
  expect(container.querySelector('input[type="number"]')).toBeNull()
})
it.each(['', '0', '61', '1.5'])('keeps invalid interval %s visible without persisting a count change or stale value', async (value) => {
  await act(async () => root.render(<Settings initial={{ maxRetries: 2, intervalMs: 2000 }} />))
  const input = await interval(value)
  expect(input.value).toBe(value)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(save).not.toHaveBeenCalled()
  await choose('最多重试 4 次')
  expect(save).not.toHaveBeenCalled()
  expect(input.value).toBe(value)
  await interval('60')
  expect(save).toHaveBeenLastCalledWith({ maxRetries: 4, intervalMs: 60000 })
})
it('exposes the saved policy in read-only controls without writing on mount or blur', async () => {
  await act(async () => root.render(<Settings initial={{ maxRetries: 3, intervalMs: 1000 }} disabled />))
  expect(container.querySelector<HTMLButtonElement>('[role="combobox"]')!.disabled).toBe(true)
  const input = container.querySelector<HTMLInputElement>('input[type="number"]')!
  expect(input.readOnly).toBe(true)
  expect(input.value).toBe('1')
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(save).not.toHaveBeenCalled()
})
