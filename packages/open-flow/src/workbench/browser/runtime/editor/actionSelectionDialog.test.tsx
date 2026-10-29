// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { WorkflowCapability } from '../../../../flow/common/change.ts'
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { ConnectorStore } from '../stores/connectorStore.ts'
import type { ActionSettingsProps, SelectedTool } from './actionSelectionDialog.tsx'
import type { WorkflowToolSelection } from './workflowToolSelection.tsx'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { ActionSelectionDialog } from './actionSelectionDialog.tsx'

// Catalog rendering is covered in Lab; exercise the real draft editor and dialog lifecycle.
vi.mock('./actionPicker.tsx', () => ({
  ActionPicker: ({ onToggle }: { onToggle: (action: ConnectorActionView) => void }) => <button onClick={() => onToggle(action)}>Toggle connector</button>,
}))
const action: ConnectorActionView = {
  actionId: 'test.echo',
  name: 'Echo',
  serviceId: 'test',
  serviceName: 'Test',
  authenticated: false,
  description: '',
  inputs: {},
  outputs: {},
}
const workflow: WorkflowCapability = { kind: 'workflow', flowId: 'child', revisionId: '', name: 'original', inputs: [], outputs: [] }
let container: HTMLDivElement
let root: Root
let i18n: ReturnType<typeof createI18n>
let onSave: ReturnType<typeof vi.fn<() => Promise<boolean>>>

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  container.className = 'open-flow-theme'
  document.body.append(container)
  root = createRoot(container)
  i18n = createI18n('en')
  onSave = vi.fn(async () => true)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  i18n.dispose()
  vi.unstubAllGlobals()
})
async function render(
  entries: readonly SelectedTool[] = [],
  settings?: { readonly title: string; readonly render: (props: ActionSettingsProps<SelectedTool>) => ReactNode },
  workflows?: WorkflowToolSelection<SelectedTool>,
) {
  const connectors = {
    $: { actions: val({}), connections: val([]) },
    resolveAction: async () => ({ action, connections: [] }),
  } as unknown as ConnectorStore
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <ActionSelectionDialog<SelectedTool>
          title="Tools"
          entries={entries}
          connectors={connectors}
          disabled={false}
          createEntry={(item) => ({ action: item.actionId })}
          onSave={onSave}
          notify={vi.fn()}
          settings={settings}
          workflows={workflows}
        />
      </I18nProvider>,
    ),
  )
  await click(`Tools · ${entries.length}`)
}
function findButton(name: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.getAttribute('aria-label') === name || element.textContent?.trim() === name,
  )
  expect(button, name).toBeDefined()
  return button!
}
async function click(name: string) {
  await act(async () => {
    const target = findButton(name)
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    target.click()
  })
}
function unloadBlocked() {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}
function confirming() {
  return document.body.textContent!.includes('Discard tool changes?')
}
async function rename(value: string) {
  if (document.querySelector('input[aria-label="Call name"]') == null) await click('Call name')
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Call name"]')!
  expect(input).not.toBeNull()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function pressAliasKey(key: string) {
  await act(async () => document.querySelector('input[aria-label="Call name"]')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}
it('does not warn for unchanged tools or a reverted selection', async () => {
  await render()
  expect(unloadBlocked()).toBe(false)
  await click('Toggle connector')
  expect(unloadBlocked()).toBe(true)
  await click('Toggle connector')
  expect(unloadBlocked()).toBe(false)
  await click('Cancel')
  expect(confirming()).toBe(false)
})
it.each(['Cancel', 'Close', 'Escape'])('guards %s and retains edits when continuing', async (method) => {
  await render()
  await click('Toggle connector')
  if (method === 'Escape') {
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  } else await click(method)
  expect(confirming()).toBe(true)
  await click('Continue editing')
  expect(unloadBlocked()).toBe(true)
  expect(document.body.textContent).toContain('Selected · 1')
  await click('Cancel')
  await click('Discard changes')
  expect(unloadBlocked()).toBe(false)
  expect(onSave).not.toHaveBeenCalled()
  await click('Tools · 0')
  expect(document.body.textContent).toContain('Selected · 0')
})
it('tracks workflow alias changes and stops warning when reverted', async () => {
  await render([workflow])
  expect(unloadBlocked()).toBe(false)
  await rename('changed')
  expect(unloadBlocked()).toBe(true)
  await rename('original')
  expect(unloadBlocked()).toBe(false)
})
it('finishes title editing with Enter or blur and cancels with Escape without closing the dialog', async () => {
  await render([workflow])
  expect(document.querySelector('input[aria-label="Call name"]')).toBeNull()
  await rename('canceled')
  await pressAliasKey('Escape')
  expect(findButton('Call name').textContent).toBe('original')
  expect(document.activeElement).toBe(findButton('Call name'))
  expect(unloadBlocked()).toBe(false)
  expect(confirming()).toBe(false)
  await rename('accepted')
  await pressAliasKey('Enter')
  expect(document.querySelector('input[aria-label="Call name"]')).toBeNull()
  expect(findButton('Call name').textContent).toBe('accepted')
  await rename('blurred')
  await act(async () => document.querySelector<HTMLInputElement>('input[aria-label="Call name"]')!.blur())
  expect(document.querySelector('input[aria-label="Call name"]')).toBeNull()
  expect(findButton('Call name').textContent).toBe('blurred')
  expect(unloadBlocked()).toBe(true)
  await click('Save')
  expect(onSave).toHaveBeenCalledWith([{ ...workflow, name: 'blurred' }])
})
it('keeps the target workflow name when editing and saving an unavailable workflow alias', async () => {
  const list = vi.fn(async () => [{ flowId: 'child', name: 'Original workflow', problem: 'unpublished' as const }])
  await render([workflow], undefined, {
    list,
    load: async () => {
      throw new Error('Unpublished')
    },
    create: () => workflow,
    refresh: (entry) => entry,
  })
  expect(document.body.textContent).toContain('Workflows · Original workflow')
  await rename('renamed')
  expect(document.body.textContent).toContain('Workflows · Original workflow')
  expect(list).toHaveBeenCalledTimes(1)
  await click('Save')
  expect(onSave).toHaveBeenCalledWith([{ ...workflow, name: 'renamed' }])
})
it('keeps protection after a failed save and clears it after a successful save', async () => {
  await render()
  await click('Toggle connector')
  onSave.mockResolvedValueOnce(false)
  await click('Save')
  expect(unloadBlocked()).toBe(true)
  onSave.mockRejectedValueOnce(new Error('Offline'))
  await click('Save')
  expect(unloadBlocked()).toBe(true)
  await click('Save')
  expect(onSave).toHaveBeenCalledTimes(3)
  expect(unloadBlocked()).toBe(false)
  expect(confirming()).toBe(false)
})
it('keeps protection during saving and removes it on unmount', async () => {
  await render()
  await click('Toggle connector')
  let resolve!: (saved: boolean) => void
  onSave.mockImplementation(
    () =>
      new Promise<boolean>((done) => {
        resolve = done
      }),
  )
  await click('Save')
  expect(unloadBlocked()).toBe(true)
  await act(async () => root.render(null))
  expect(unloadBlocked()).toBe(false)
  await act(async () => resolve(true))
})

it('protects an invalid settings draft that has not produced a new tool value', async () => {
  await render([workflow], {
    title: 'Settings',
    render: ({ onValidChange }) => <button onClick={() => onValidChange('value', false)}>Enter invalid value</button>,
  })
  await click('Settings · original')
  await click('Enter invalid value')
  expect(unloadBlocked()).toBe(true)
  await click('Save')
  expect(onSave).not.toHaveBeenCalled()
  expect(unloadBlocked()).toBe(true)
})
