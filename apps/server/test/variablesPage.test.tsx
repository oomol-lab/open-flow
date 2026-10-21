// @vitest-environment happy-dom
import type { ControlClient, VariableListItem } from '@oomol-lab/open-flow/control-api'

import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { VariablesPage } from '../browser/variables.tsx'
import { button, click, input, render, submit } from './support/render.tsx'

const toast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toast } }))
const variable = (name: string): VariableListItem => ({ name, value: 'original', updatedAt: '2026-08-27T00:00:00.000Z', version: 1, referenceCount: 0 })

it('ignores an older Variable response that finishes last', async () => {
  const older = Promise.withResolvers<{ variables: VariableListItem[] }>()
  const newer = Promise.withResolvers<{ variables: VariableListItem[] }>()
  const listVariables = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
  const view = render(<VariablesPage client={{ listVariables } as unknown as ControlClient} language="en" />)
  act(() => window.dispatchEvent(new Event('focus')))
  await act(async () => newer.resolve({ variables: [variable('FRESH')] }))
  expect(view.container.textContent).toContain('FRESH')
  await act(async () => older.resolve({ variables: [variable('STALE')] }))
  expect(view.container.textContent).toContain('FRESH')
  expect(view.container.textContent).not.toContain('STALE')
})

it.each([
  { editing: false, name: 'TOKEN', refresh: 'ready', accepted: false },
  { editing: true, name: 'TOKEN', refresh: 'ready', accepted: true },
  { editing: false, name: 'token', refresh: 'ready', accepted: true },
  { editing: false, name: 'NEW', refresh: 'loading', accepted: false },
  { editing: false, name: 'NEW', refresh: 'failed', accepted: false },
])('protects Variable writes: %j', async ({ editing, name, refresh, accepted }) => {
  const variables = [variable('TOKEN')]
  const listVariables = vi.fn().mockResolvedValue({ variables })
  const putVariable = vi.fn().mockResolvedValue(undefined)
  const view = render(<VariablesPage client={{ listVariables, putVariable } as unknown as ControlClient} language="en" />)
  await act(async () => {})
  if (editing) {
    await click(button(view.i18n.t('variables.actions')))
    await click(button(view.i18n.t('variables.edit')))
  } else await click(button(view.i18n.t('variables.create')))
  const nameField = document.querySelector<HTMLInputElement>('#variable-name')!
  if (editing) expect(nameField.readOnly).toBe(true)
  else await input(nameField, name)
  await input(document.querySelector<HTMLTextAreaElement>('#variable-value')!, 'replacement')
  if (refresh !== 'ready') {
    listVariables.mockImplementationOnce(() => (refresh === 'failed' ? Promise.reject(new Error('offline')) : new Promise(() => {})))
    await act(async () => window.dispatchEvent(new Event('focus')))
  }
  if (!editing && name === 'TOKEN') {
    expect(nameField.getAttribute('aria-invalid')).toBe('true')
    expect(document.body.textContent).toContain(view.i18n.t('variables.nameExists'))
  }
  expect(button(view.i18n.t('variables.save')).disabled).toBe(!accepted)
  await submit(document.querySelector('form')!)
  if (accepted) expect(putVariable).toHaveBeenCalledWith(name, 'replacement')
  else expect(putVariable).not.toHaveBeenCalled()
})
