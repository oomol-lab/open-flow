// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import type { FlowStateView } from '../../../../state/common/state.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { FlowStateButton } from './flowStatePanel.tsx'

const value: FlowStateView = {
  version: 1,
  scope: 'draft',
  bytes: 864000,
  limits: { maxBytes: 2097152, maxValueBytes: 65536, maxIdentities: 10000, maxRunWrites: 1000 },
  values: [],
  spaces: [{ space: 'node:filter', count: 9000, mode: 'new', watermark: null, updatedAt: 1 }],
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
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
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
