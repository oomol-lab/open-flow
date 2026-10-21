// @vitest-environment happy-dom
import type { ControlClient, VariableReferences } from '@oomol-lab/open-flow/control-api'

import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { useVariableReferences, VariableDeletionDialog, VariableReferenceResults, VariableReferencesButton } from '../browser/variable-references.tsx'
import { button, click, render } from './support/render.tsx'

const empty: VariableReferences = { version: 1, references: [] }
const referenced: VariableReferences = { ...empty, references: [{ flowId: 'old', flowName: 'Old', draft: true, live: null }] }

it('requests references only after opening the popover', async () => {
  const getVariableReferences = vi.fn().mockResolvedValue(empty)
  const client = { getVariableReferences } as unknown as ControlClient
  const view = render(<VariableReferencesButton client={client} name="TOKEN" container={document.body} disabled={false} referenceCount={0} />)
  expect(view.container.querySelector('button')).toBeNull()
  view.rerender(<VariableReferencesButton client={client} name="TOKEN" container={document.body} disabled={false} referenceCount={1} />)
  expect(getVariableReferences).not.toHaveBeenCalled()
  await click(view.container.querySelector('button')!)
  expect(getVariableReferences).toHaveBeenCalledWith('TOKEN', expect.any(AbortSignal))
})

it('aborts obsolete reference requests and ignores their late responses', async () => {
  const first = Promise.withResolvers<VariableReferences>()
  const next = Promise.withResolvers<VariableReferences>()
  const getVariableReferences = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise)
  const client = { getVariableReferences } as unknown as ControlClient
  function Query({ name }: { name: string }) {
    return <VariableReferenceResults state={useVariableReferences(client, name)} />
  }
  const view = render(<Query name="TOKEN" />)
  view.rerender(<Query name="OTHER" />)
  expect(getVariableReferences.mock.calls[0]![1].aborted).toBe(true)
  await act(async () => next.resolve(empty))
  await act(async () => first.resolve(referenced))
  expect(view.container.textContent).toContain(view.i18n.t('variables.referencesEmpty'))
  expect(view.container.textContent).not.toContain('Old')
  view.unmount()
  expect(getVariableReferences.mock.calls[1]![1].aborted).toBe(true)
})

it('shows draft and publication links, including disabled publications', () => {
  const view = render(
    <VariableReferenceResults
      state={{
        result: {
          version: 1,
          references: [
            { flowId: 'both', flowName: 'Both', draft: true, live: { hasStart: true, publicationId: 'p', enabled: false } },
            { flowId: 'live', flowName: 'Live only', draft: false, live: { hasStart: true, publicationId: 'q', enabled: true } },
          ],
        },
        loading: false,
        failed: false,
        retry: vi.fn(),
      }}
    />,
  )
  const links = [...view.container.querySelectorAll('a')].map((link) => link.getAttribute('href'))
  expect(links).toEqual(['/flows/both/design', '/flows/both/design', '/flows/both/publications', '/flows/live/publications', '/flows/live/publications'])
  expect(view.container.textContent).toContain(view.i18n.t('variables.referenceDisabled'))
})

it.each(['empty', 'referenced', 'failed'] as const)('checks deletion impact and permits deletion after %s results', async (outcome) => {
  const pending = Promise.withResolvers<VariableReferences>()
  const getVariableReferences = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(empty)
  const onDelete = vi.fn()
  const view = render(
    <VariableDeletionDialog
      client={{ getVariableReferences } as unknown as ControlClient}
      name="TOKEN"
      container={document.body}
      pending={false}
      onClose={vi.fn()}
      onDelete={onDelete}
      finalFocus={() => null}
    />,
  )
  const remove = () => button(view.i18n.t('variables.delete'))
  expect(remove().disabled).toBe(true)
  for (const key of ['variables.deleteUnreferenced', 'variables.deleteReferencesImpact']) expect(document.body.textContent).not.toContain(view.i18n.t(key))
  await act(async () => {
    if (outcome === 'failed') pending.reject(new Error('offline'))
    else pending.resolve(outcome === 'empty' ? empty : referenced)
  })
  expect(remove().disabled).toBe(false)
  if (outcome === 'failed') {
    expect(document.querySelector('[role=alert]')).not.toBeNull()
    await click(button(view.i18n.t('variables.retry')))
    expect(getVariableReferences).toHaveBeenCalledTimes(2)
    expect(document.querySelector('[role=alert]')).toBeNull()
  } else expect(document.body.textContent).toContain(view.i18n.t(outcome === 'empty' ? 'variables.deleteUnreferenced' : 'variables.deleteReferencesImpact'))
  await click(remove())
  expect(onDelete).toHaveBeenCalledOnce()
})
