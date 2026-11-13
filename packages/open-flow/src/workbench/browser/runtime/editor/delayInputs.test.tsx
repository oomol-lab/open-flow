// @vitest-environment happy-dom
import type { RevisionContent } from '../../../../flow/common/change.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createInspectorSession } from '../../../../../dev/designer/inspectorSession.ts'
import { click, input as typeInput } from '../../../../../test/support/render.tsx'
import { applyFlowChanges, currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { createDelay } from '../../../../flow/common/nodeChanges.ts'
import { designerGraph } from '../workspace.ts'
import { NodeInspector } from './nodeInspector.tsx'

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
        <NodeInspector
          disabled={disabled}
          revision={revision}
          selection={selection}
          theme="light"
          {...(disabled
            ? { readOnly: true as const }
            : {
                store: session.store,
                connectors: session.connectors,
                triggers: session.triggers,
                variables: { enabled: false, loaded: true, loading: false, names: [], onOpen: undefined },
              })}
        />
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
  const unit = () => container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Duration unit"]')!
  const clear = () => container.querySelector<HTMLButtonElement>('[aria-label="Clear Duration"]')!
  const input = () => container.querySelector<HTMLInputElement>('input[aria-label="Duration"]')!
  const edit = async (value: string) => {
    await typeInput(input(), value)
    await act(async () => input()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  }
  return { session, container, render, node, input, unit, clear, edit }
}

it('saves duration and units through production history, copies Delay, and restores empty drafts', async () => {
  const f = await fixture()
  expect(f.input().value).toBe('5')
  expect(f.input().getAttribute('aria-invalid')).toBe('false')
  await f.edit('2')
  expect(f.node()).toMatchObject({ inputs: { durationMs: { kind: 'value', value: 2000 } } })
  await act(async () => f.session.store.undo())
  expect(f.input().value).toBe('5')
  await act(async () => f.session.store.redo())
  expect(f.input().value).toBe('2')
  await click(f.unit())
  await click([...f.container.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === 'min')!)
  expect(f.node()).toMatchObject({ inputs: { durationMs: { kind: 'value', value: 120_000 } } })
  await act(async () => {
    f.session.store.selectNodes(['pause'])
    await f.session.store.duplicateSelectedNodes()
  })
  const copy = f.session.store.$.selectedNodeIds.value[0]!
  expect(copy).not.toBe('pause')
  expect(f.session.store.$.revision.value!.graph().nodes[copy]).toMatchObject({ kind: 'delay', inputs: { durationMs: { kind: 'value', value: 120_000 } } })
  expect(designerGraph(f.session.store.$.revision.value!.revision).nodes.find((node) => node.id === copy)).toMatchObject({
    inputs: [expect.objectContaining({ handle: 'durationMs' })],
    outputs: [],
  })
  expect(f.input().compareDocumentPosition(f.clear()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(f.clear().compareDocumentPosition(f.unit()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await act(async () => f.clear().click())
  expect(f.node()).toMatchObject({ inputs: { durationMs: { kind: 'unset' } } })
  await act(async () => f.session.start())
  expect(f.node()).toMatchObject({ inputs: { durationMs: { kind: 'unset' } } })
  expect(f.container.querySelector('[aria-invalid="true"]')).not.toBeNull()
  await act(async () => f.session.store.nodes.resetInputs('pause', ['durationMs']))
  expect(f.input().value).toBe('5')
  await f.render(true)
  expect(f.input().readOnly).toBe(true)
  expect(f.unit().disabled).toBe(true)
})

it('keeps blank duration drafts and unit changes mounted until the field loses focus', async () => {
  const f = await fixture()
  await click(f.unit())
  await click([...f.container.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === 'min')!)
  const input = f.input()
  await typeInput(input, '')
  expect(f.node()).toMatchObject({ inputs: { durationMs: { kind: 'value', value: 300_000 } } })
  expect(f.input()).toBe(input)
  expect(input.value).toBe('')
  expect(f.unit().textContent).toContain('min')
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: f.clear() })))
  await act(async () => f.clear().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: f.unit() })))
  await click(f.unit())
  const hour = [...f.container.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === 'h')!
  await act(async () => f.unit().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: hour })))
  await click(hour)
  expect(f.node()).toMatchObject({ inputs: { durationMs: { kind: 'value', value: 300_000 } } })
  expect(f.input()).toBe(input)
  expect(input.value).toBe('')
  expect(f.unit().textContent).toContain('h')
  await typeInput(input, '2')
  expect(f.node()).toMatchObject({ inputs: { durationMs: { kind: 'value', value: 7_200_000 } } })
  expect(f.unit().textContent).toContain('h')
  await typeInput(input, '')
  await act(async () => f.unit().dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(f.node()).toMatchObject({ inputs: { durationMs: { kind: 'unset' } } })
  expect(f.input()).toBeNull()
})
