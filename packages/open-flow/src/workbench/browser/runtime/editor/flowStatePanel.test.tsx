// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import type { FlowStateSummary } from '../../../../state/common/state.ts'
import type { FlowStateClient } from './flowStatePanel.tsx'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApiError } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { FlowStateButton, FlowStatePanel } from './flowStatePanel.tsx'

const value: FlowStateSummary = {
  version: 1,
  scope: 'draft',
  limits: { maxValues: 1000, maxSpaces: 100, maxValueBytes: 65536, maxIdentities: 10000, maxRunWrites: 1000 },
  values: { count: 0, updatedAt: null },
  spaces: [{ space: 'node:filter', count: 9000, pendingCount: 0, reservedCount: 9000, updatedAt: 1 }],
}
const nodes = [{ id: 'filter', title: 'Filter articles', icon: ':lucide-light:list-filter:' }]
let root: Root
let container: HTMLDivElement
const i18n = createI18n('en')
const notify = vi.fn()
const client = {
  getFlowStateSummary: vi.fn<FlowStateClient['getFlowStateSummary']>(async (_flowId, scope) => ({ ...value, scope })),
  getFlowState: vi.fn(),
  getFlowStateValues: vi.fn(),
  clearFlowState: vi.fn(async () => {}),
  clearFlowDedupe: vi.fn(async () => {}),
  clearAllFlowDedupe: vi.fn(async () => {}),
}
async function render(history?: { nodeId: string }, trigger = false) {
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <FlowStateButton
          key={trigger ? 'trigger' : 'dialog'}
          client={client}
          flowId="flow"
          nodes={nodes}
          notify={notify}
          history={history}
          onClose={trigger ? undefined : () => {}}
        />
      </I18nProvider>,
    ),
  )
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  client.getFlowStateSummary.mockReset().mockImplementation(async (_flowId, scope) => ({ ...value, scope }))
  client.clearFlowState.mockReset().mockResolvedValue(undefined)
  client.clearFlowDedupe.mockReset().mockResolvedValue(undefined)
  client.clearAllFlowDedupe.mockReset().mockResolvedValue(undefined)
  container = document.createElement('div')
  container.className = 'open-flow-theme'
  document.body.append(container)
  root = createRoot(container)
  await render()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
function button(label: string, scope: ParentNode = document) {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((item) => (item.getAttribute('aria-label') ?? item.textContent) === label)
  expect(found, label).toBeDefined()
  return found!
}
async function click(label: string, scope: ParentNode = document) {
  await act(async () => button(label, scope).click())
}
async function switchScope(next: 'draft' | 'live') {
  await click(i18n.t(`flowState.${next}`))
}
function hasClearButton() {
  return [...document.querySelectorAll('button')].some((item) => item.textContent === i18n.t('flowState.clear'))
}
function section(name: 'values' | 'spaces') {
  const found = [...document.querySelectorAll('section')].find((element) => element.getAttribute('aria-label') === i18n.t(`flowState.${name}`))
  expect(found).toBeDefined()
  return found!
}

it('keeps both sections during the first load and replaces heading status with empty-state text', async () => {
  let resolve!: (result: FlowStateSummary) => void
  client.getFlowStateSummary.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await render(undefined, true)
  await click(i18n.t('flowState.title'))
  expect(section('values').textContent).toContain(i18n.t('flowState.loading'))
  expect(section('spaces').textContent).toContain(i18n.t('flowState.loading'))
  expect(section('values').textContent).not.toContain(i18n.t('flowState.emptyValues'))
  expect(document.body.textContent).not.toContain('0 / 1,000')
  expect(hasClearButton()).toBe(false)
  await act(async () => resolve({ ...value, spaces: [] }))
  expect(section('values').textContent).toContain(i18n.t('flowState.emptyValues'))
  expect(section('spaces').textContent).toContain(i18n.t('flowState.emptySpaces'))
  expect(section('values').textContent).toContain('0 / 1,000')
  expect(section('spaces').textContent).toContain('0 / 10,000')
  expect(document.body.textContent).not.toContain(i18n.t('flowState.loading'))
})
it('retains the section layout after an initial failure without claiming the data is empty, then retries', async () => {
  client.getFlowStateSummary.mockRejectedValueOnce(new Error('Unavailable'))
  await render(undefined, true)
  await click(i18n.t('flowState.title'))
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Unavailable')
  expect(section('values').textContent).toContain(i18n.t('flowState.loadFailed'))
  expect(section('spaces').textContent).toContain(i18n.t('flowState.loadFailed'))
  expect(section('values').textContent).not.toContain(i18n.t('flowState.emptyValues'))
  await click(i18n.t('flowState.retry'))
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(document.body.textContent).toContain('Filter articles')
})

it('opens help by click, keeps it open on repeated clicks and can reopen after Escape or outside interaction', async () => {
  const label = i18n.t('flowState.rules')
  const valuesHelp = i18n.t('flowState.valuesHelp', { name: i18n.t('flowState.values') })
  const helpText = () => container.textContent ?? ''
  await vi.waitFor(() => expect(document.activeElement).toBe(button(i18n.t('flowState.draft'))))
  await act(async () => button(label).focus())
  await click(label)
  await vi.waitFor(() => {
    expect(helpText()).toContain(i18n.t('flowState.isolation'))
    expect(helpText()).toContain(valuesHelp)
    expect(helpText()).toContain(i18n.t('flowState.historyHelp', { name: i18n.t('flowState.spaces') }))
  })
  await click(label)
  expect(helpText()).toContain(i18n.t('flowState.isolation'))
  await act(async () => {
    button(label).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
  })
  await vi.waitFor(() => expect(helpText()).not.toContain(i18n.t('flowState.isolation')))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await click(label)
  await vi.waitFor(() => expect(helpText()).toContain(i18n.t('flowState.isolation')))
  await act(async () => {
    document.querySelector('[role="tablist"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  })
  await vi.waitFor(() => expect(helpText()).not.toContain(i18n.t('flowState.isolation')))
  await click(label)
  await vi.waitFor(() => expect(helpText()).toContain(i18n.t('flowState.isolation')))
})

it('loads only aggregates and clears a selected source without listing keys or reading value bodies', async () => {
  expect(client.getFlowStateSummary).toHaveBeenCalledWith('flow', 'draft', expect.any(AbortSignal))
  expect(client.getFlowState).not.toHaveBeenCalled()
  expect(client.getFlowStateValues).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Filter articles')
  expect(document.body.textContent).toContain(i18n.t('flowState.nearLimit'))
  await click(i18n.t('flowState.clearSource', { name: 'Filter articles' }))
  expect(client.clearFlowDedupe).toHaveBeenCalledWith('flow', 'draft', 'node:filter')
  expect(client.clearFlowState).not.toHaveBeenCalled()
})
it('confirms Live scope, source and count, restores cancellation focus and notifies clear failures', async () => {
  await switchScope('live')
  const trigger = button(i18n.t('flowState.clearSource', { name: 'Filter articles' }))
  await act(async () => trigger.click())
  expect(client.clearFlowDedupe).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain(i18n.t('flowState.confirmTitle', { name: 'Filter articles' }))
  expect(document.body.textContent).toContain(i18n.t('flowState.confirmHistory', { count: '9,000', scope: i18n.t('flowState.live') }))
  await vi.waitFor(() => expect(document.activeElement).toBe(button(i18n.t('flowState.cancel'))))
  await click(i18n.t('flowState.cancel'))
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
  await act(async () => trigger.click())
  client.clearFlowDedupe.mockRejectedValueOnce(new Error('Storage unavailable'))
  await click(i18n.t('flowState.confirmClear'))
  expect(client.clearFlowDedupe).toHaveBeenCalledWith('flow', 'live', 'node:filter')
  expect(notify).toHaveBeenCalledWith({ kind: 'error', message: 'Storage unavailable' })
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
it('shows compact empty totals without timestamps or clearing actions', async () => {
  client.getFlowStateSummary.mockResolvedValueOnce({ ...value, spaces: [] })
  await click(i18n.t('flowState.refresh'))
  expect(document.body.textContent).toContain('0 / 1,000')
  expect(document.body.textContent).toContain('0 / 10,000')
  expect(document.querySelector('time')).toBeNull()
  expect(hasClearButton()).toBe(false)
})
it('shows saved totals, their timestamp and effective quotas, then clears the whole group', async () => {
  client.getFlowStateSummary.mockResolvedValueOnce({ ...value, values: { count: 8, updatedAt: 1793322000000 }, limits: { ...value.limits, maxValues: 10 } })
  await click(i18n.t('flowState.refresh'))
  expect(document.body.textContent).toContain('8 / 10')
  expect(document.body.textContent).toContain(i18n.t('flowState.valuesNearLimit'))
  expect(document.querySelector('time')?.getAttribute('dateTime')).toBe(new Date(1793322000000).toISOString())
  await click(i18n.t('flowState.clearSource', { name: i18n.t('flowState.values') }))
  expect(client.clearFlowState).toHaveBeenCalledWith('flow', 'draft')
})
it('groups source actions under deduplication history and sorts by capacity then stable ID', async () => {
  const spaces = [
    { space: 'node:z', count: 1, pendingCount: 0, reservedCount: 1, updatedAt: 1 },
    { space: 'flow', count: 2, pendingCount: 0, reservedCount: 2, updatedAt: 1 },
    { space: 'node:a', count: 1, pendingCount: 0, reservedCount: 1, updatedAt: 1 },
    ...value.spaces,
  ]
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <FlowStatePanel value={{ ...value, spaces }} nodes={nodes} busy={false} onClearValues={() => {}} onClearHistory={() => {}} onClearSpace={() => {}} />
      </I18nProvider>,
    ),
  )
  const names = ['Filter articles', i18n.t('flowState.shared'), 'node:a', 'node:z']
  expect([...container.querySelectorAll('button')].map((item) => item.getAttribute('aria-label'))).toEqual(
    [i18n.t('flowState.spaces'), ...names].map((name) => i18n.t('flowState.clearSource', { name })),
  )
  expect(container.textContent).not.toContain(i18n.t('flowState.orphaned'))
  expect(
    button(i18n.t('flowState.clearSource', { name: 'Filter articles' }), container)
      .closest('section')
      ?.getAttribute('aria-label'),
  ).toBe(i18n.t('flowState.spaces'))
})
it('shows only the selected node and labels its Flow-wide quota separately', async () => {
  client.getFlowStateSummary.mockImplementation(async (_flowId, scope) => ({
    ...value,
    scope,
    spaces: [...value.spaces, { space: 'flow', count: 500, pendingCount: 0, reservedCount: 500, updatedAt: 1 }],
  }))
  await render({ nodeId: 'filter' })
  await switchScope('live')
  expect(document.body.textContent).toContain(i18n.t('flowState.sourceHistory', { name: 'Filter articles' }))
  expect(document.body.textContent).toContain(i18n.t('flowState.globalUsage'))
  expect(document.body.textContent).toContain('9,500 / 10,000')
  expect(document.body.textContent).not.toContain(i18n.t('flowState.values'))
  expect(document.body.textContent).not.toContain(i18n.t('flowState.shared'))
  await click(i18n.t('flowState.clearSource', { name: 'Filter articles' }))
  await click(i18n.t('flowState.confirmClear'))
  expect(client.clearFlowDedupe).toHaveBeenCalledWith('flow', 'live', 'node:filter')
})
it.each([9000, 9100])('uses reserved capacity %s and protects pending records without double counting', async (reservedCount) => {
  client.getFlowStateSummary.mockResolvedValueOnce({ ...value, spaces: [{ ...value.spaces[0]!, pendingCount: 100, reservedCount }] })
  await click(i18n.t('flowState.refresh'))
  expect(document.body.textContent).toContain(`${reservedCount.toLocaleString('en')} / 10,000`)
  const sourceLabel = i18n.t('flowState.clearSource', { name: 'Filter articles' })
  expect(button(sourceLabel).closest('tr')?.textContent).toContain(reservedCount.toLocaleString('en'))
  expect(document.body.textContent).not.toContain(i18n.t('flowState.pendingClear', { count: '100' }))
  expect(button(sourceLabel).disabled).toBe(true)
  expect(button(i18n.t('flowState.clearSource', { name: i18n.t('flowState.spaces') })).disabled).toBe(true)
  await vi.waitFor(() => expect(document.activeElement).toBe(button(i18n.t('flowState.draft'))))
  await act(async () => button(sourceLabel).closest<HTMLElement>('[role="group"]')!.focus())
  await vi.waitFor(() => expect(document.body.textContent).toContain(i18n.t('flowState.pendingClear', { count: '100' })))
})
it('clears available history as one operation and confirms only clearable records in Live', async () => {
  await click(i18n.t('flowState.clearSource', { name: i18n.t('flowState.spaces') }))
  expect(client.clearAllFlowDedupe).toHaveBeenCalledWith('flow', 'draft')
  expect(client.clearFlowDedupe).not.toHaveBeenCalled()
  expect(client.clearFlowState).not.toHaveBeenCalled()
  client.getFlowStateSummary.mockImplementation(async (_flowId, scope) => ({
    ...value,
    scope,
    spaces: [...value.spaces, { space: 'node:pending', count: 5, pendingCount: 20, reservedCount: 20, updatedAt: 1 }],
  }))
  await switchScope('live')
  await click(i18n.t('flowState.clearSource', { name: i18n.t('flowState.spaces') }))
  expect(document.body.textContent).toContain(i18n.t('flowState.confirmHistory', { count: '9,000', scope: i18n.t('flowState.live') }))
  expect(document.body.textContent).toContain(i18n.t('flowState.retainedHistory', { count: '20' }))
  expect(client.clearAllFlowDedupe).toHaveBeenCalledTimes(1)
  await click(i18n.t('flowState.confirmClear'))
  expect(client.clearAllFlowDedupe).toHaveBeenLastCalledWith('flow', 'live')
})
it('refreshes and disables group clearing if every source becomes pending before the server handles it', async () => {
  client.clearAllFlowDedupe.mockRejectedValueOnce(new ApiError(409, 'flow.conflict', 'Pending'))
  client.getFlowStateSummary.mockResolvedValueOnce({ ...value, spaces: [{ ...value.spaces[0]!, pendingCount: 1 }] })
  await click(i18n.t('flowState.clearSource', { name: i18n.t('flowState.spaces') }))
  expect(notify).toHaveBeenCalledWith({ kind: 'error', message: i18n.t('flowState.clearBlocked') })
  expect(button(i18n.t('flowState.clearSource', { name: i18n.t('flowState.spaces') })).disabled).toBe(true)
})
it('retains rows during refresh and retries a read failure without sending mutation notices', async () => {
  let resolve!: (result: FlowStateSummary) => void
  client.getFlowStateSummary.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await click(i18n.t('flowState.refresh'))
  expect(document.body.textContent).toContain('Filter articles')
  expect(section('values').textContent).toContain(i18n.t('flowState.loading'))
  expect(section('spaces').textContent).toContain(i18n.t('flowState.loading'))
  expect(document.querySelector('[role="tabpanel"]')?.getAttribute('aria-busy')).toBe('true')
  await act(async () => resolve({ ...value, values: { count: 3, updatedAt: null } }))
  expect(document.body.textContent).toContain('3 / 1,000')
  client.getFlowStateSummary.mockRejectedValueOnce(new Error('Read failed'))
  await click(i18n.t('flowState.refresh'))
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Read failed')
  expect(document.body.textContent).toContain('Filter articles')
  expect(notify).not.toHaveBeenCalled()
  await click(i18n.t('flowState.retry'))
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
it('aborts the previous environment request and ignores a delayed response even if transport does not abort', async () => {
  let resolve!: (result: FlowStateSummary) => void
  client.getFlowStateSummary.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await click(i18n.t('flowState.refresh'))
  const signal = client.getFlowStateSummary.mock.calls.at(-1)![2]!
  client.getFlowStateSummary.mockResolvedValueOnce({ ...value, scope: 'live', values: { count: 4, updatedAt: null } })
  await switchScope('live')
  expect(signal.aborted).toBe(true)
  await act(async () => resolve({ ...value, values: { count: 99, updatedAt: null } }))
  expect(document.body.textContent).toContain('4 / 1,000')
  expect(document.body.textContent).not.toContain('99 / 1,000')
})
it('blocks duplicate mutations, scope switching and dismissal while clearing', async () => {
  let resolve!: () => void
  client.clearFlowDedupe.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done
      }),
  )
  const label = i18n.t('flowState.clearSource', { name: 'Filter articles' })
  await act(async () => {
    button(label).click()
    button(label).click()
  })
  expect(client.clearFlowDedupe).toHaveBeenCalledTimes(1)
  await switchScope('live')
  expect(client.getFlowStateSummary).toHaveBeenLastCalledWith('flow', 'draft', expect.any(AbortSignal))
  await click(i18n.t('common.close'))
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  await act(async () => resolve())
})
it('notifies and refreshes when pending history appears before a clear reaches the server', async () => {
  client.clearFlowDedupe.mockRejectedValueOnce(new ApiError(409, 'flow.conflict', 'Pending'))
  const previous = client.getFlowStateSummary.mock.calls.length
  await click(i18n.t('flowState.clearSource', { name: 'Filter articles' }))
  expect(notify).toHaveBeenCalledWith({ kind: 'error', message: i18n.t('flowState.clearBlocked') })
  expect(client.getFlowStateSummary.mock.calls.length).toBe(previous + 1)
})
it('resets to Debug when the node history trigger is reopened', async () => {
  await render({ nodeId: 'filter' }, true)
  await click(i18n.t('flowState.history'))
  await switchScope('live')
  await click(i18n.t('common.close'))
  await click(i18n.t('flowState.history'))
  expect(client.getFlowStateSummary).toHaveBeenLastCalledWith('flow', 'draft', expect.any(AbortSignal))
  expect(button(i18n.t('flowState.draft')).getAttribute('aria-selected')).toBe('true')
})
it('shows zero node records separately from shared usage when that node has no history', async () => {
  await render({ nodeId: 'unused' })
  expect(document.body.textContent).toContain(i18n.t('flowState.records', { count: '0' }))
  expect(document.body.textContent).toContain(i18n.t('flowState.globalUsage'))
  expect(document.body.textContent).toContain('9,000 / 10,000')
  expect(hasClearButton()).toBe(false)
})
