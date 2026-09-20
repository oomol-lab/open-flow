import type { ReactElement, ReactNode } from 'react'

import { Children, isValidElement } from 'react'
import { expect, it, vi } from 'vitest'
import { DataTypeAddon } from './valueTypeAddon.tsx'

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

it('offers Any as the generic JSON editor mode', () => {
  const onChange = vi.fn()
  const rendered = DataTypeAddon({ name: 'value', value: 'text', any: true, onChange })
  const select = find(rendered, (item) => typeof item.props.onValueChange == 'function')
  const anyItem = find(rendered, (item) => item.props.value === 'any' && item.props.onValueChange == null)

  expect(select?.props.value).toBe('any')
  expect(anyItem?.props.disabled).not.toBe(true)
  ;(select!.props.onValueChange as (value: string) => void)('any')
  expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined)
})
