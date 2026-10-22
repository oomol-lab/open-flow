// @vitest-environment happy-dom
import type { ComponentProps, ReactElement } from 'react'
import type { Root } from 'react-dom/client'
import type { GraphNode } from '../../../../flow/common/change.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { publicationFixture } from '../../../../../dev/designer/publicationFixture.ts'
import { createI18n } from '../i18n.ts'
import { revisionView } from '../revisionView.ts'
import { ConnectorAccount, TriggerConnection } from './connectionSettings.tsx'
import { NodeInspector } from './nodeInspector.tsx'

let container: HTMLDivElement
let root: Root
let i18n: ReturnType<typeof createI18n>
const saveResolution = vi.fn()
const saveNodeSettings = vi.fn()
const connect = vi.fn()
const setConnection = vi.fn()
const account = { connectionId: 'connection', displayName: 'Work', isDefault: false, serviceId: 'slack', status: 'active' as const }
const action = {
  actionId: 'slack.send-message',
  authenticated: true,
  serviceId: 'slack',
  serviceName: 'Slack',
  name: 'Send message',
  description: '',
  inputs: {},
  outputs: {},
}
const task: GraphNode = {
  kind: 'task',
  inputs: {},
  name: 'Review',
  timeoutMs: 100,
  maxExecutions: 25,
  task: { name: 'Send message', inputs: [], outputs: [], executor: { kind: 'connector', action: action.actionId, connectionId: account.connectionId } },
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.clearAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  i18n = createI18n('en')
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  i18n.dispose()
  vi.unstubAllGlobals()
})
async function render(element: ReactElement) {
  await act(async () => root.render(<I18nProvider i18n={i18n}>{element}</I18nProvider>))
}
async function inspect(
  node: GraphNode,
  overrides: Partial<Pick<ComponentProps<typeof NodeInspector>, 'onConfigureConnectorAccess' | 'activeConnectorConnections'>> = {},
) {
  const { draft } = publicationFixture('flow', 'fixed')
  const revision = revisionView({
    ...draft,
    content: { ...draft.content, document: { ...draft.content.document, graph: { nodes: { current: node }, edges: [] } } },
  })
  await render(
    <NodeInspector
      theme="light"
      revision={revision}
      selection={revision.node('current')}
      store={{ nodes: { saveResolution, saveNodeSettings } } as unknown as WorkspaceStore}
      connectors={{ connect, setConnection } as unknown as NonNullable<ComponentProps<typeof NodeInspector>['connectors']>}
      triggers={{ connect } as unknown as NonNullable<ComponentProps<typeof NodeInspector>['triggers']>}
      variables={{ enabled: false, loaded: true, loading: false, names: [], onOpen: undefined }}
      connectorAction={action}
      connectorConnection={account}
      activeConnectorConnections={[account]}
      {...overrides}
    />,
  )
}
function button(key: Parameters<typeof i18n.t>[0]) {
  const result = [...container.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent === i18n.t(key))
  expect(result).toBeDefined()
  return result!
}
async function edit(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
}
async function choose(label: string) {
  await act(async () => container.querySelector<HTMLButtonElement>('[role="combobox"]')!.click())
  const option = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent === label)
  expect(option).toBeDefined()
  await act(async () => {
    option!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    option!.click()
  })
}

it.each(['empty', 'invalid'] as const)('routes %s account authorization to the supplied management entry', async (state) => {
  const configure = vi.fn()
  await render(
    <ConnectorAccount
      action={action}
      actionId={action.actionId}
      actionError={undefined}
      accessError={state === 'invalid' ? 'Access required' : undefined}
      activeConnections={[]}
      authorizationPending={false}
      connection={undefined}
      connectionError={undefined}
      connectionId={undefined}
      connectors={{ connect } as unknown as ComponentProps<typeof ConnectorAccount>['connectors']}
      disabled={false}
      fieldIdPrefix="slack"
      loading={false}
      nodeId="current"
      onConfigureAccess={configure}
    />,
  )
  await act(async () => button('inspector.account.manageAccount').click())
  expect(configure).toHaveBeenCalledOnce()
  expect(connect).not.toHaveBeenCalled()
})

it('routes trigger authorization to its provider management entry', async () => {
  const configure = vi.fn()
  await render(
    <TriggerConnection
      activeConnections={[]}
      authorizationPending={false}
      connectionLoading={false}
      disabled={false}
      selection={
        { id: 'trigger', trigger: { kind: 'integration', definition: { provider: 'slack' } } } as ComponentProps<typeof TriggerConnection>['selection']
      }
      triggers={{ connect } as unknown as ComponentProps<typeof TriggerConnection>['triggers']}
      onConfigureAccess={configure}
    />,
  )
  await act(async () => button('inspector.account.manageAccount').click())
  expect(configure).toHaveBeenCalledWith('slack')
  expect(connect).not.toHaveBeenCalled()
})

it('manages accounts and selects a different account through the inspector', async () => {
  const configureAccess = vi.fn()
  await inspect(task, {
    onConfigureConnectorAccess: configureAccess,
    activeConnectorConnections: [account, { ...account, connectionId: 'personal', displayName: 'Personal' }],
  })
  await act(async () => button('inspector.account.manageAccount').click())
  await choose(i18n.t('inspector.account.addAccount'))
  expect(connect).toHaveBeenCalledTimes(2)
  expect(connect).toHaveBeenLastCalledWith('slack')
  expect(configureAccess).not.toHaveBeenCalled()
  expect(setConnection).not.toHaveBeenCalled()
  await choose('Personal')
  expect(setConnection).toHaveBeenCalledWith('current', 'personal')
})

it.each(['approval', 'wait'] as const)('validates and saves the latest %s prompt while preserving its name', async (kind) => {
  await inspect({ kind, name: 'Renamed', inputs: {}, inputDefinitions: [], prompt: 'Continue?' })
  const input = container.querySelector<HTMLTextAreaElement>('#wait-current-prompt')!
  await edit(input, 'Continue?')
  expect(saveResolution).not.toHaveBeenCalled()
  await edit(input, '  ')
  expect(saveResolution).not.toHaveBeenCalled()
  expect(container.textContent).toContain(i18n.t('inspector.wait.promptError'))
  await edit(input, '  Review this request  ')
  expect(saveResolution).toHaveBeenCalledExactlyOnceWith('current', { name: 'Renamed', prompt: 'Review this request' })
  expect(container.textContent).not.toContain(i18n.t('inspector.wait.promptError'))
})

it.each([
  {
    field: 'timeout',
    initial: '100',
    invalid: ['0', '-1', '1.5'],
    valid: '200',
    saved: { name: 'Review', timeoutMs: 200, maxExecutions: 25 },
    cleared: { name: 'Review', maxExecutions: 25 },
  },
  {
    field: 'limit',
    initial: '25',
    invalid: ['0', '-1', '1.5', '9007199254740992'],
    valid: '1000',
    saved: { name: 'Review', timeoutMs: 100, maxExecutions: 1000 },
    cleared: { name: 'Review', timeoutMs: 100, maxExecutions: undefined },
  },
])('validates $field, recovers after correction and preserves sibling settings', async ({ field, initial, invalid, valid, saved, cleared }) => {
  await inspect(task)
  const input = container.querySelector<HTMLInputElement>(`#node-current-${field}`)!
  await edit(input, initial)
  expect(saveNodeSettings).not.toHaveBeenCalled()
  for (const value of invalid) {
    await edit(input, value)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(saveNodeSettings).not.toHaveBeenCalled()
  }
  await edit(input, valid)
  expect(input.getAttribute('aria-invalid')).toBe('false')
  expect(saveNodeSettings).toHaveBeenLastCalledWith('current', saved)
  await edit(input, '')
  expect(saveNodeSettings).toHaveBeenLastCalledWith('current', cleared)
})

it('refreshes saved settings and clears validation feedback when saved node settings change', async () => {
  await inspect(task)
  await edit(container.querySelector<HTMLInputElement>('#node-current-timeout')!, '-1')
  expect(container.querySelector<HTMLInputElement>('#node-current-timeout')!.getAttribute('aria-invalid')).toBe('true')
  await inspect({ ...task, timeoutMs: 500, maxExecutions: 10 })
  const timeout = container.querySelector<HTMLInputElement>('#node-current-timeout')!
  expect(timeout.value).toBe('500')
  expect(timeout.getAttribute('aria-invalid')).toBe('false')
  expect(container.querySelector<HTMLInputElement>('#node-current-limit')!.value).toBe('10')
  expect(saveNodeSettings).not.toHaveBeenCalled()
})

it('edits and saves invalid Wait timing and clears automatic continuation', async () => {
  await inspect({ kind: 'wait', name: 'Wait', prompt: 'Review', inputs: {}, inputDefinitions: [], autoContinue: { kind: 'after', durationMs: 1000 } })
  const selector = container.querySelector<HTMLSelectElement>('select#wait-current-auto')!
  expect(selector.value).toBe('after')
  await edit(container.querySelector<HTMLInputElement>('#wait-current-auto-value')!, '30')
  expect(saveResolution).toHaveBeenLastCalledWith('current', { name: 'Wait', prompt: 'Review', autoContinue: { kind: 'after', durationMs: 30_000 } })
  saveResolution.mockClear()
  await edit(container.querySelector<HTMLInputElement>('#wait-current-auto-value')!, '0')
  expect(saveResolution).toHaveBeenLastCalledWith('current', { name: 'Wait', prompt: 'Review', autoContinue: { kind: 'after', durationMs: 0 } })
  expect(container.textContent).toContain('Enter a positive duration')
  await act(async () => {
    selector.value = 'off'
    selector.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(saveResolution).toHaveBeenLastCalledWith('current', { name: 'Wait', prompt: 'Review', autoContinue: null })
})

it.each([
  ['1.1', 1100, false],
  ['1.001', 1001, false],
  ['0.0001', 0.1, true],
  ['1.0001', 1000.1, true],
  ['', null, true],
  ['1e309', null, true],
] as const)('saves duration %s without confusing floating-point noise with fractional milliseconds', async (text, durationMs, invalid) => {
  await inspect({ kind: 'wait', name: 'Wait', prompt: 'Review', inputs: {}, inputDefinitions: [], autoContinue: { kind: 'after', durationMs: 1000 } })
  const input = container.querySelector<HTMLInputElement>('#wait-current-auto-value')!
  await edit(input, text)
  expect(saveResolution).toHaveBeenLastCalledWith('current', { name: 'Wait', prompt: 'Review', autoContinue: { kind: 'after', durationMs } })
  expect(input.getAttribute('aria-invalid')).toBe(String(invalid))
})

it('edits scheduled Waits with the shared date editor and preserves wall time when selecting a timezone', async () => {
  await inspect({
    kind: 'wait',
    name: 'Wait',
    prompt: 'Review',
    inputs: {},
    inputDefinitions: [],
    autoContinue: { kind: 'at', at: '2026-10-25T10:30:00+08:00', timezone: 'Asia/Kolkata' },
  })
  const input = container.querySelector<HTMLInputElement>('#wait-current-auto-value')!
  expect(input.value).toBe('2026-10-25T08:00')
  await edit(input, '2026-10-26T12:45')
  expect(saveResolution).toHaveBeenLastCalledWith('current', {
    name: 'Wait',
    prompt: 'Review',
    autoContinue: { kind: 'at', at: '2026-10-26T07:15:00.000Z', timezone: 'Asia/Kolkata' },
  })
  await act(async () => container.querySelector<HTMLButtonElement>('#wait-current-auto-timezone')!.click())
  const utc = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent == 'UTC+00:00UTC')!
  expect(utc).toBeDefined()
  await act(async () => {
    utc.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))
    utc.click()
  })
  expect(saveResolution).toHaveBeenLastCalledWith('current', {
    name: 'Wait',
    prompt: 'Review',
    autoContinue: { kind: 'at', at: '2026-10-26T12:45:00.000Z', timezone: 'UTC' },
  })
  await inspect({ kind: 'approval', name: 'Approval', prompt: 'Review', inputs: {}, inputDefinitions: [] })
  expect(container.querySelector('#wait-current-auto')).toBeNull()
})

it.each(['after', 'at'] as const)('saves an empty %s timing selection and validates it after reopening', async (mode) => {
  const node = { kind: 'wait' as const, name: 'Wait', prompt: 'Review', inputs: {}, inputDefinitions: [] }
  await inspect(node)
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>('select#wait-current-auto')!
    select.value = mode
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const expected =
    mode == 'after' ? { kind: 'after' as const, durationMs: null } : { kind: 'at' as const, at: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
  expect(saveResolution).toHaveBeenLastCalledWith('current', { name: 'Wait', prompt: 'Review', autoContinue: expected })
  expect(container.querySelector('#wait-current-auto-value')!.getAttribute('aria-invalid')).toBe('true')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enter a positive duration')
  await inspect({ kind: 'approval', name: 'Approval', prompt: 'Review', inputs: {}, inputDefinitions: [] })
  await inspect({ ...node, autoContinue: expected })
  expect(container.querySelector<HTMLSelectElement>('select#wait-current-auto')!.value).toBe(mode)
  expect(container.querySelector<HTMLInputElement>('#wait-current-auto-value')!.value).toBe('')
  expect(container.querySelector('#wait-current-auto-value')!.getAttribute('aria-invalid')).toBe('true')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Enter a positive duration')
  await edit(container.querySelector<HTMLInputElement>('#wait-current-auto-value')!, mode == 'after' ? '60' : '2026-10-26T12:45')
  expect(container.querySelector('#wait-current-auto-value')!.getAttribute('aria-invalid')).toBe('false')
})

it('preserves invalid scheduled Wait text through save and reopen', async () => {
  const node = {
    kind: 'wait' as const,
    name: 'Wait',
    prompt: 'Review',
    inputs: {},
    inputDefinitions: [],
    autoContinue: { kind: 'at' as const, at: '2026-02-30T10:00', timezone: 'UTC' },
  }
  await inspect(node)
  const input = container.querySelector<HTMLInputElement>('#wait-current-auto-value')!
  expect(input.value).toBe('2026-02-30T10:00')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  await edit(input, 'invalid date')
  expect(saveResolution).toHaveBeenLastCalledWith('current', {
    name: 'Wait',
    prompt: 'Review',
    autoContinue: { kind: 'at', at: 'invalid date', timezone: 'UTC' },
  })
  await inspect({ ...node, autoContinue: { ...node.autoContinue, at: 'invalid date' } })
  expect(container.querySelector<HTMLInputElement>('#wait-current-auto-value')!.value).toBe('invalid date')
  expect(container.querySelector('#wait-current-auto-value')!.getAttribute('aria-invalid')).toBe('true')
})

it('keeps an unsaved Wait timing draft when unrelated node fields refresh', async () => {
  const node = {
    kind: 'wait' as const,
    name: 'Wait',
    prompt: 'Review',
    inputs: {},
    inputDefinitions: [],
    autoContinue: { kind: 'after' as const, durationMs: 1000 },
  }
  await inspect(node)
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('#wait-current-auto-value')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '45')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await inspect({ ...node, prompt: 'Updated prompt', autoContinue: { ...node.autoContinue } })
  const input = container.querySelector<HTMLInputElement>('#wait-current-auto-value')!
  expect(input.value).toBe('45')
  expect(saveResolution).not.toHaveBeenCalled()
  await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
  expect(saveResolution).toHaveBeenLastCalledWith('current', { name: 'Wait', prompt: 'Updated prompt', autoContinue: { kind: 'after', durationMs: 45000 } })
})
