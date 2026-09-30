import type { ReactElement, ReactNode } from 'react'

import { Children, isValidElement } from 'react'
import { expect, it, vi } from 'vitest'
import { EditorComponentSelect } from './editorComponentSelect.tsx'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => [typeof initial == 'function' ? (initial as () => unknown)() : initial, vi.fn()],
}))

vi.mock('val-i18n-react', () => ({
  useTranslate: () => (key: string) => key,
}))

function find(element: ReactElement, predicate: (item: ReactElement) => boolean): ReactElement | undefined {
  if (predicate(element)) return element
  for (const child of Children.toArray((element.props as { readonly children?: ReactNode }).children)) {
    if (!isValidElement(child)) continue
    const match = find(child, predicate)
    if (match != null) return match
  }
}

it('offers Any without a second JSON entry in the complete value-editor menu', () => {
  const onChange = vi.fn()
  const rendered = EditorComponentSelect({ name: 'value', schema: {}, valueOnly: true, addon: true, onChange })
  const select = find(rendered, (item) => typeof item.props.onValueChange == 'function')
  const anyItem = find(rendered, (item) => item.props.value === 'json' && item.props.onValueChange == null)

  expect(select?.props.value).toBe('json')
  expect(anyItem?.props.children).toContain('valueEditor.any')
  expect(select?.props.items).toContainEqual({ value: 'text', label: 'valueEditor.components.text' })
  expect(select?.props.items).toContainEqual({ value: 'select', label: 'valueEditor.components.select' })
  expect(select?.props.items).not.toContainEqual({ value: 'json', label: 'valueEditor.components.json' })
  ;(select!.props.onValueChange as (value: string) => void)('text')
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ 'type': 'string', 'ui:widget': 'text' })
})

it('returns to generic JSON editing without retaining editor constraints', () => {
  const onChange = vi.fn()
  const rendered = EditorComponentSelect({ name: 'value', schema: { type: 'string', format: 'date' }, valueOnly: true, onChange })
  const select = find(rendered, (item) => typeof item.props.onValueChange == 'function')
  ;(select!.props.onValueChange as (value: string) => void)('json')
  expect(onChange).toHaveBeenCalledExactlyOnceWith({})
})
