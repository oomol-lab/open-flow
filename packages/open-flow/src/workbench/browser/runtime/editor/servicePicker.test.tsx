import type { ReactElement, ReactNode } from 'react'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { BlockLibraryProps } from './blockLibrary.tsx'

import { Children, isValidElement } from 'react'
import { expect, it, vi } from 'vitest'
import { ServicePicker } from './servicePicker.tsx'

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => [typeof initial == 'boolean' ? true : initial, vi.fn()],
}))
vi.mock('val-i18n-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('val-i18n-react')>()),
  useTranslate: () => (key: string) => key,
}))

function library(element: ReactElement): BlockLibraryProps | undefined {
  if ('browseOptions' in element.props) return element.props as BlockLibraryProps
  for (const child of Children.toArray((element.props as { children?: ReactNode }).children)) {
    if (!isValidElement(child)) continue
    const found = library(child)
    if (found != null) return found
  }
}

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
  const picker = library(
    ServicePicker({
      connectors: { browseAddNodeOptions: browse, provideAddNodeOptionChoices: choices, provideAddNodeOptions: searchActions } as unknown as ConnectorStore,
      exclude: ['github'],
      onSelect,
    }),
  )!
  const signal = new AbortController().signal
  expect(await picker.browseOptions(signal)).toEqual([providers[0], providers[2]])
  expect(await picker.searchOptions('GOOGLE SHEETS', signal)).toEqual([providers[2]])
  expect(await picker.searchOptions('google_sheets', signal)).toEqual([providers[2]])
  expect(await picker.searchOptions('missing', signal)).toEqual([])
  await picker.onAdd(providers[2]!)
  expect(onSelect).toHaveBeenCalledWith('google_sheets')
  expect(choices).not.toHaveBeenCalled()
  expect(searchActions).not.toHaveBeenCalled()
})
