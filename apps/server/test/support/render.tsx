import type { ReactNode } from 'react'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, vi } from 'vitest'
import { createI18n } from '../../browser/i18n.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) cleanup()
  vi.unstubAllGlobals()
})

export function render(element: ReactNode) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  container.className = 'open-flow-theme'
  document.body.append(container)
  const root = createRoot(container)
  const i18n = createI18n('en')
  const rerender = (next: ReactNode) => act(() => root.render(<I18nProvider i18n={i18n}>{next}</I18nProvider>))
  let active = true
  const unmount = () => {
    if (!active) return
    active = false
    act(() => root.unmount())
    container.remove()
    i18n.dispose()
  }
  cleanups.push(unmount)
  rerender(element)
  return { container, rerender, unmount, i18n }
}

export async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export async function click(element: HTMLElement) {
  await act(async () => {
    if (element.getAttribute('role') === 'option') element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    element.click()
  })
}

export function button(label: string, root: ParentNode = document): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"]')].find(
    (element) => element.textContent?.trim() === label || element.getAttribute('aria-label') === label,
  )
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
export async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
}
