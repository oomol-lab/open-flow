// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { CodeHttpHosts } from './codeHttpHosts.tsx'

let container: HTMLDivElement
let root: Root
let i18n: ReturnType<typeof createI18n>
let onSave: ReturnType<typeof vi.fn<(hosts: readonly string[]) => Promise<boolean>>>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  container.className = 'open-flow-theme'
  document.body.append(container)
  root = createRoot(container)
  i18n = createI18n('en')
  onSave = vi.fn(async () => true)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  i18n.dispose()
  vi.unstubAllGlobals()
})
async function render(hosts: readonly string[] = []) {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <CodeHttpHosts disabled={false} hosts={hosts} onSave={onSave} />
      </I18nProvider>,
    ),
  )
}
async function click(name: string) {
  const button = [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() == name)!
  expect(button).toBeDefined()
  await act(async () => button.click())
}
async function edit(value: string) {
  const input = container.querySelector('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('opens on demand and discards cancelled edits', async () => {
  await render(['api.example.com'])
  expect(container.querySelector('textarea')).toBeNull()
  await click('HTTP hosts · 1')
  await edit('other.example.com')
  await click('Cancel')
  expect(onSave).not.toHaveBeenCalled()
  await click('HTTP hosts · 1')
  expect(container.querySelector('textarea')?.value).toBe('api.example.com')
})
it('validates before saving and preserves the draft after a failed save', async () => {
  await render()
  await click('HTTP hosts')
  await edit('https://api.example.com')
  await click('Save')
  expect(onSave).not.toHaveBeenCalled()
  expect(container.querySelector('textarea')?.getAttribute('aria-invalid')).toBe('true')
  await edit('API.example.com\napi.example.com')
  onSave.mockResolvedValueOnce(false)
  await click('Save')
  expect(onSave).toHaveBeenLastCalledWith(['api.example.com'])
  expect(container.querySelector('textarea')?.value).toBe('API.example.com\napi.example.com')
  await click('Save')
  expect(onSave).toHaveBeenCalledTimes(2)
})
it('removes HTTP access by saving an empty list', async () => {
  await render(['api.example.com'])
  await click('HTTP hosts · 1')
  await edit('')
  await click('Save')
  expect(onSave).toHaveBeenCalledWith([])
})
