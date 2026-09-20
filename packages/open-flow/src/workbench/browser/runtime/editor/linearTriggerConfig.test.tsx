import type { ReactElement, ReactNode } from 'react'

import { Children, isValidElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { StatusSelect, TeamSelect } from './linearTriggerConfig.tsx'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
  useId: () => 'linear-description',
  useLayoutEffect: vi.fn(),
  useRef: (value: unknown) => ({ current: value }),
  useState: vi.fn((initial: unknown) => [typeof initial == 'function' ? initial() : initial, vi.fn()]),
}))

vi.mock('val-i18n-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('val-i18n-react')>()),
  useTranslate: () => (key: string, parameters?: Record<string, unknown>) => (parameters == null ? key : `${key} ${Object.values(parameters).join(' ')}`),
}))

function find(element: ReactElement, predicate: (item: ReactElement) => boolean): ReactElement | undefined {
  if (predicate(element)) return element
  for (const child of Children.toArray((element.props as { readonly children?: ReactNode }).children)) {
    if (!isValidElement(child)) continue
    const match = find(child, predicate)
    if (match != null) return match
  }
}

function text(element: ReactElement): string {
  return Children.toArray((element.props as { readonly children?: ReactNode }).children)
    .map((child) => (typeof child == 'string' ? child : isValidElement(child) ? text(child) : ''))
    .join('')
}

function options(overrides: Partial<Parameters<typeof TeamSelect>[0]['options']> = {}) {
  return {
    failed: false,
    loading: false,
    options: [
      { label: 'Engineering (ENG)', value: 'engineering' },
      { label: 'Design (DES)', value: 'design' },
    ],
    refresh: vi.fn(),
    ...overrides,
  }
}

describe('Linear Team select', () => {
  it('uses the compact field control and refreshes whenever it opens', () => {
    const source = options()
    const onChange = vi.fn()
    const element = TeamSelect({ disabled: false, missing: false, onChange, options: source, value: 'engineering' })
    const select = find(element, (item) => typeof item.props.onOpenChange == 'function' && typeof item.props.onValueChange == 'function')
    const trigger = find(element, (item) => item.props['aria-label'] == 'linearTrigger.team')

    expect(trigger?.props.size).toBe('field')
    ;(select!.props.onOpenChange as (open: boolean) => void)(true)
    ;(select!.props.onValueChange as (value: string) => void)('design')

    expect(source.refresh).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('design')
  })

  it('keeps an unavailable selection visible and marks the trigger invalid', () => {
    const element = TeamSelect({ disabled: false, missing: true, onChange: vi.fn(), options: options(), value: 'missing-team' })
    const trigger = find(element, (item) => item.props['aria-label'] == 'linearTrigger.team')
    const unavailable = find(element, (item) => item.props.value == 'missing-team' && item.props.disabled === true)

    expect(trigger?.props['aria-invalid']).toBe(true)
    expect(unavailable?.props.disabled).toBe(true)
    expect(text(unavailable!)).toContain('linearTrigger.unavailableTeam missing-team')
  })

  it('preserves the saved Team id when the initial option request fails', () => {
    const element = TeamSelect({
      disabled: false,
      missing: false,
      onChange: vi.fn(),
      options: options({ failed: true, options: undefined }),
      value: 'saved-team',
    })
    const select = find(element, (item) => Array.isArray(item.props.items))

    expect(select?.props.items).toContainEqual({ label: 'saved-team', value: 'saved-team' })
  })
})

describe('Linear status select', () => {
  it.each([
    { expected: 'linearTrigger.selectTeamFirst', selected: [], teamSelected: false },
    { expected: 'linearTrigger.allStatuses', selected: [], teamSelected: true },
    { expected: 'Done', selected: ['done'], teamSelected: true },
    { expected: 'linearTrigger.selectedCount 2', selected: ['progress', 'done'], teamSelected: true },
  ])('summarizes the current selection as $expected', ({ expected, selected, teamSelected }) => {
    const element = StatusSelect({
      disabled: !teamSelected,
      missing: [],
      onChange: vi.fn(),
      options: options({
        options: [
          { color: '#f2c94c', label: 'In Progress', value: 'progress' },
          { color: '#5e6ad2', label: 'Done', value: 'done' },
        ],
      }),
      selected,
      teamSelected,
    })
    const trigger = find(element, (item) => isValidElement(item.props.render) && item.props.render.props['aria-label'] == 'linearTrigger.statuses')

    expect(text(trigger!)).toContain(expected)
    expect(trigger!.props.render.props.disabled).toBe(!teamSelected)
  })

  it('refreshes on open and adds or removes status values', () => {
    const source = options({
      options: [
        { color: '#f2c94c', label: 'In Progress', value: 'progress' },
        { color: '#5e6ad2', label: 'Done', value: 'done' },
      ],
    })
    const onChange = vi.fn()
    const element = StatusSelect({
      disabled: false,
      missing: [],
      onChange,
      options: source,
      selected: ['done'],
      teamSelected: true,
    })
    const popover = find(element, (item) => typeof item.props.onOpenChange == 'function')
    const progress = find(element, (item) => item.props.checked === false && text(item).includes('In Progress'))
    const done = find(element, (item) => item.props.checked === true && text(item).includes('Done'))

    ;(popover!.props.onOpenChange as (open: boolean) => void)(true)
    ;(progress!.props.onCheckedChange as (checked: boolean) => void)(true)
    ;(done!.props.onCheckedChange as (checked: boolean) => void)(false)

    expect(source.refresh).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenNthCalledWith(1, ['done', 'progress'])
    expect(onChange).toHaveBeenNthCalledWith(2, [])
  })

  it('keeps an unavailable selected status removable inside the menu', () => {
    const onChange = vi.fn()
    const element = StatusSelect({
      disabled: false,
      missing: ['missing-status'],
      onChange,
      options: options({ options: [] }),
      selected: ['missing-status'],
      teamSelected: true,
    })
    const trigger = find(element, (item) => isValidElement(item.props.render) && item.props.render.props['aria-label'] == 'linearTrigger.statuses')
    const unavailable = find(element, (item) => item.props.checked === true && text(item).includes('missing-status'))

    expect(trigger!.props.render.props['aria-invalid']).toBe(true)
    ;(unavailable!.props.onCheckedChange as (checked: boolean) => void)(false)
    expect(onChange).toHaveBeenCalledWith([])
  })
})
