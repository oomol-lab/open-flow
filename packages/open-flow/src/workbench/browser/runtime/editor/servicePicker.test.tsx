import type { ReactNode } from 'react'
// @vitest-environment happy-dom
import type { ConnectorStore } from '../stores/connectorStore.ts'

import { act, useEffect, useRef } from 'react'
import { expect, it, vi } from 'vitest'
import { click, input, render } from '../../../../../test/support/render.tsx'
import { ServicePicker } from './servicePicker.tsx'

vi.mock('../../../../ui/browser/scroll-area.tsx', () => ({
  ScrollArea: ({ children, events }: { children: ReactNode; events?: { initialized: (instance: unknown) => void } }) => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
      events?.initialized({ elements: () => ({ viewport: ref.current }) })
    }, [])
    return <div ref={ref}>{children}</div>
  },
}))
vi.mock('virtua', () => ({ Virtualizer: ({ data, children }: { data: unknown[]; children: (item: unknown) => ReactNode }) => <>{data.map(children)}</> }))

it('searches provider names and IDs, excludes existing and no-auth services, and configures the selected service', async () => {
  const providers = [
    { serviceId: 'gmail', label: 'Gmail' },
    { serviceId: 'github', label: 'GitHub' },
    { serviceId: 'google_sheets', label: 'Google Sheets' },
    { serviceId: 'public', label: 'Public', noSetup: true },
  ].map((provider) => ({
    serviceId: provider.serviceId,
    label: provider.label,
    noSetup: provider.noSetup === true,
    id: provider.serviceId,
    kind: 'connector-group' as const,
    choices: [],
    description: '',
    inputs: [],
    outputs: [],
  }))
  const browse = vi.fn(async () => providers)
  const choices = vi.fn()
  const searchActions = vi.fn()
  const onSelect = vi.fn(async () => true)
  const { container } = render(
    <ServicePicker
      connectors={{ browseAddNodeOptions: browse, provideAddNodeOptionChoices: choices, provideAddNodeOptions: searchActions } as unknown as ConnectorStore}
      exclude={['github']}
      onSelect={onSelect}
    />,
  )
  await click(container.querySelector('button')!)
  expect(container.textContent).toContain('Gmail')
  expect(container.textContent).toContain('Google Sheets')
  expect(container.textContent).not.toContain('GitHub')
  expect(container.textContent).not.toContain('Public')
  const search = container.querySelector<HTMLInputElement>('input')!
  for (const query of ['GOOGLE SHEETS', 'google_sheets', 'missing']) {
    await input(search, query)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350))
    })
    expect(container.textContent?.includes('Google Sheets')).toBe(query !== 'missing')
    expect(container.textContent).not.toContain('Gmail')
  }
  await input(search, '')
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 350))
  })
  await click([...container.querySelectorAll<HTMLElement>('button')].find((item) => item.textContent?.includes('Google Sheets'))!)
  expect(onSelect).toHaveBeenCalledWith('google_sheets')
  expect(container.querySelector('[role="dialog"]')).toBeNull()
  expect(choices).not.toHaveBeenCalled()
  expect(searchActions).not.toHaveBeenCalled()
})
