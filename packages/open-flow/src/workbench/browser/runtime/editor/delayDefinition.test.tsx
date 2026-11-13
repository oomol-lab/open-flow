// @vitest-environment happy-dom
import type { RevisionContent } from '../../../../flow/common/change.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createInspectorSession } from '../../../../../dev/designer/inspectorSession.ts'
import { applyFlowChanges, currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { createDelay } from '../../../../flow/common/nodeChanges.ts'
import { designerGraph } from '../workspace.ts'
import { DelayDefinition } from './delayDefinition.tsx'

async function fixture() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const content: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        nodes: {},
        edges: [],
      },
    },
  }
  const session = createInspectorSession('en', vi.fn(), applyFlowChanges(content, createDelay('pause', 'Pause')))
  await session.start()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  function Editor({ disabled = false }: { disabled?: boolean }) {
    const revision = useVal(session.store.$.revision)!
    const selection = revision.node('pause')!
    if (selection.kind !== 'delay') throw new Error('Expected Delay')
    return (
      <I18nProvider i18n={session.i18n}>
        <DelayDefinition disabled={disabled} selection={selection} store={session.store} />
      </I18nProvider>
    )
  }
  const render = (disabled = false) => act(async () => root.render(<Editor disabled={disabled} />))
  await render()
  onTestFinished(async () => {
    await act(async () => root.unmount())
    container.remove()
    session.dispose()
    vi.unstubAllGlobals()
  })
  const node = () => session.store.$.revision.value!.graph().nodes.pause!
  const input = () => container.querySelector<HTMLInputElement>('input')!
  const edit = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
      input().dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  }
  return { session, container, render, node, input, edit }
}

it('saves duration and units through production history, copies Delay, and restores empty drafts', async () => {
  const f = await fixture()
  expect(f.input().value).toBe('5')
  expect(f.input().getAttribute('aria-invalid')).toBe('false')
  await f.edit('2')
  expect(f.node()).toMatchObject({ durationMs: 2000 })
  await act(async () => f.session.store.undo())
  expect(f.input().value).toBe('5')
  await act(async () => f.session.store.redo())
  expect(f.input().value).toBe('2')
  await act(async () => {
    const select = f.container.querySelector('select')!
    select.value = 'minute'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(f.node()).toMatchObject({ durationMs: 120_000 })
  await act(async () => {
    f.session.store.selectNodes(['pause'])
    await f.session.store.duplicateSelectedNodes()
  })
  const copy = f.session.store.$.selectedNodeIds.value[0]!
  expect(copy).not.toBe('pause')
  expect(f.session.store.$.revision.value!.graph().nodes[copy]).toMatchObject({ kind: 'delay', durationMs: 120_000 })
  expect(designerGraph(f.session.store.$.revision.value!.revision).nodes.find((node) => node.id === copy)).toMatchObject({ inputs: [], outputs: [] })
  await f.edit('')
  expect(f.node()).toMatchObject({ durationMs: null })
  await act(async () => f.session.start())
  expect(f.input().value).toBe('')
  expect(f.input().getAttribute('aria-invalid')).toBe('true')
  await f.render(true)
  expect(f.input().disabled).toBe(true)
  expect(f.container.querySelector('select')!.disabled).toBe(true)
})
