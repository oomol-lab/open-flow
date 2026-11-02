// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import type { FlowStateView } from '../../../../state/common/state.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { FlowStateButton, FlowStatePanel } from './flowStatePanel.tsx'

const value: FlowStateView = {
  version: 1,
  scope: 'draft',
  limits: { maxValues: 1000, maxSpaces: 100, maxValueBytes: 65536, maxIdentities: 10000, maxRunWrites: 1000 },
  values: [],
  spaces: [{ space: 'node:filter', count: 9000, pendingCount: 0, reservedCount: 9000, updatedAt: 1 }],
}
let root: Root
let container: HTMLDivElement
const i18n = createI18n('en')
const client = {
  getFlowState: vi.fn(async (_flowId: string, scope: 'draft' | 'live') => ({ ...value, scope })),
  clearFlowState: vi.fn(async () => {}),
  clearFlowDedupe: vi.fn(async () => {}),
}
beforeEach(async () => {
  vi.clearAllMocks()
  client.getFlowState.mockImplementation(async (_flowId, scope) => ({ ...value, scope }))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  container.className = 'open-flow-theme'
  document.body.append(container)
  root = createRoot(container)
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <FlowStateButton client={client} flowId="flow" nodeIds={['filter']} onClose={() => {}} />
      </I18nProvider>,
    ),
  )
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
async function click(label: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll('button')].find((item) => item.textContent === label)
  expect(button, label).toBeDefined()
  await act(async () => button!.click())
}
it('defaults to Draft, hides business values and clears only the selected history space', async () => {
  expect(client.getFlowState).toHaveBeenCalledWith('flow', 'draft', false)
  expect(document.body.textContent).toContain(i18n.t('flowState.nearLimit'))
  await click(i18n.t('flowState.clear'))
  expect(client.clearFlowDedupe).toHaveBeenCalledWith('flow', 'draft', 'node:filter')
  expect(client.clearFlowState).not.toHaveBeenCalled()
})
it('requires a separate Live confirmation, supports cancellation and surfaces clear failures', async () => {
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Scope"]')!
  await act(async () => {
    select.value = 'live'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(client.getFlowState).toHaveBeenLastCalledWith('flow', 'live', false)
  await click(i18n.t('flowState.clear'))
  expect(client.clearFlowDedupe).not.toHaveBeenCalled()
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('node:filter')
  await click(i18n.t('flowState.cancel'))
  expect(client.clearFlowDedupe).not.toHaveBeenCalled()
  await click(i18n.t('flowState.clear'))
  client.clearFlowDedupe.mockRejectedValueOnce(new Error('Storage unavailable'))
  await click(i18n.t('flowState.clear'), document.querySelector('[role="alert"]')!)
  expect(client.clearFlowDedupe).toHaveBeenCalledWith('flow', 'live', 'node:filter')
  expect(document.body.textContent).toContain('Storage unavailable')
})

it('explains empty data and shows entry limits without inactive clear or value controls', async () => {
  client.getFlowState.mockResolvedValueOnce({ ...value, values: [], spaces: [] })
  await click(i18n.t('flowState.refresh'))
  expect(document.body.textContent).toContain(i18n.t('flowState.emptyValues'))
  expect(document.body.textContent).toContain(i18n.t('flowState.emptySpaces'))
  expect(document.body.textContent).toContain('0 / 1,000 entries')
  expect(document.body.textContent).toContain('0 / 10,000 entries')
  expect(document.body.textContent).not.toContain(i18n.t('flowState.clearAll'))
  expect(document.querySelector('[role="checkbox"]')).toBeNull()
})
it('keeps the Flow-wide total visible when inspecting one node history', async () => {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <FlowStatePanel
          value={{ ...value, spaces: [...value.spaces, { space: 'flow', count: 500, pendingCount: 0, reservedCount: 500, updatedAt: 1 }] }}
          space="node:filter"
          nodeIds={['filter']}
          busy={false}
          onClearValues={() => {}}
          onClearSpace={() => {}}
        />
      </I18nProvider>,
    ),
  )
  expect(container.textContent).toContain('9,500 / 10,000 entries')
  expect(container.textContent).toContain('9,000 records')
  expect(container.textContent).not.toContain('500 records')
  expect(container.textContent).not.toContain(i18n.t('flowState.values'))
})

it('shows only the selected node history in Draft and Live', async () => {
  client.getFlowState.mockImplementation(async (_flowId, scope) => ({
    ...value,
    scope,
    spaces: [...value.spaces, { space: 'flow', count: 500, pendingCount: 0, reservedCount: 500, updatedAt: 1 }],
  }))
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <FlowStateButton client={client} flowId="flow" nodeIds={['filter']} history={{ nodeId: 'filter' }} onClose={() => {}} />
      </I18nProvider>,
    ),
  )
  const select = document.querySelector<HTMLSelectElement>('select[aria-label="Scope"]')!
  await act(async () => {
    select.value = 'live'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(document.body.textContent).toContain('9,000 records')
  expect(document.body.textContent).not.toContain('500 records')
  await click(i18n.t('flowState.clear'))
  expect(document.activeElement?.textContent).toBe(i18n.t('flowState.cancel'))
  await click(i18n.t('flowState.clear'), document.querySelector('[role="alert"]')!)
  expect(client.clearFlowDedupe).toHaveBeenCalledWith('flow', 'live', 'node:filter')
})

it('includes pending capacity and prevents clearing a provisional space', async () => {
  client.getFlowState.mockResolvedValueOnce({ ...value, spaces: [{ ...value.spaces[0]!, pendingCount: 100, reservedCount: 9100 }] })
  await click(i18n.t('flowState.refresh'))
  expect(document.body.textContent).toContain('9,100 / 10,000 entries')
  expect(document.body.textContent).toContain(i18n.t('flowState.pendingRecords', { count: '100' }))
  const clear = [...document.querySelectorAll('button')].find((button) => button.textContent === i18n.t('flowState.clear'))!
  expect(clear.disabled).toBe(true)
})

it('keeps overlapping provisional records visible and protected without double counting capacity', async () => {
  client.getFlowState.mockResolvedValueOnce({ ...value, spaces: [{ ...value.spaces[0]!, pendingCount: 100 }] })
  await click(i18n.t('flowState.refresh'))
  expect(document.body.textContent).toContain('9,000 / 10,000 entries')
  expect(document.body.textContent).toContain(i18n.t('flowState.pendingRecords', { count: '100' }))
  const clear = [...document.querySelectorAll('button')].find((button) => button.textContent === i18n.t('flowState.clear'))!
  expect(clear.disabled).toBe(true)
})

it('resets to Draft whenever the persistent history trigger is reopened', async () => {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <FlowStateButton key="persistent-trigger" client={client} flowId="flow" nodeIds={['filter']} history={{ nodeId: 'filter' }} />
      </I18nProvider>,
    ),
  )
  await click(i18n.t('flowState.history'))
  let select = document.querySelector<HTMLSelectElement>('select[aria-label="Scope"]')!
  await act(async () => {
    select.value = 'live'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await click(i18n.t('common.close'))
  await click(i18n.t('flowState.history'))
  select = document.querySelector<HTMLSelectElement>('select[aria-label="Scope"]')!
  expect(select.value).toBe('draft')
})
