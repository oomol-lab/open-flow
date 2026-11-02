// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { AgentTools } from './agentTools.tsx'

let host: HTMLDivElement
let root: Root
let i18n: ReturnType<typeof createI18n>
const request = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  request.mockClear()
  vi.stubGlobal('fetch', request)
  host = document.createElement('div')
  document.body.append(host)
  i18n = createI18n('en')
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  i18n.dispose()
  vi.unstubAllGlobals()
})

it.each([false, true])('inspects a saved tool selection without editing or fetching catalogs (shadow: %s)', async (shadow) => {
  const mount = document.createElement('div')
  ;(shadow ? host.attachShadow({ mode: 'open' }) : host).append(mount)
  root = createRoot(mount)
  await act(async () =>
    root.render(
      <I18nProvider i18n={i18n}>
        <div className="open-flow-workbench open-flow-theme" data-theme="dark">
          <AgentTools
            disabled
            inputs={[]}
            providers={{ blog: { serviceId: 'blog', serviceName: 'Blog', noSetup: false } }}
            config={{
              kind: 'agent',
              model: 'sample-model',
              prompt: 'Read the published topics.',
              maxRounds: 3,
              tools: [
                {
                  id: 'read-topics',
                  name: 'read_published_topics',
                  action: 'blog.list',
                  connectionId: shadow ? 'saved-connection' : '',
                  description: 'Read topics that have already been published.',
                  approval: true,
                  inputs: [{ handle: 'limit', jsonSchema: { type: 'integer' }, nullable: false, source: { kind: 'value', value: 10 } }],
                },
                {
                  kind: 'workflow',
                  id: 'workflow',
                  flowId: 'saved-flow',
                  revisionId: 'saved-revision',
                  name: 'summarize',
                  description: 'Summarize the saved results.',
                  approval: false,
                  inputs: [],
                  outputs: [],
                },
              ],
            }}
          />
        </div>
      </I18nProvider>,
    ),
  )
  const surface = mount.firstElementChild!
  const trigger = surface.querySelector<HTMLButtonElement>('button')!
  await act(async () => trigger.click())
  const popup = surface.querySelector<HTMLElement>('[role="dialog"]')
  expect(popup).not.toBeNull()
  expect(popup!.getRootNode()).toBe(mount.getRootNode())
  expect(popup!.textContent).toContain('blog.list')
  expect(popup!.textContent).toContain('Blog')
  expect(popup!.textContent).toContain('summarize')
  expect(popup!.textContent).not.toContain(i18n.t('toolPicker.current'))
  expect(popup!.querySelector('[role="searchbox"]')).toBeNull()
  expect(popup!.querySelector(`[aria-label="${i18n.t('actionPicker.refresh')}"]`)).toBeNull()
  expect([...popup!.querySelectorAll('button')].some((button) => button.textContent === i18n.t('common.save'))).toBe(false)
  const account = popup!.querySelector<HTMLInputElement>(`input[aria-label="${i18n.t('actionPicker.accountFor', { action: 'blog.list' })}"]`)!
  expect(account.readOnly).toBe(true)
  expect(account.value).toBe(shadow ? 'saved-connection' : i18n.t('inspector.account.deferred'))
  const settings = popup!.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t('agent.toolSettings')} · blog.list"]`)!
  await act(async () => settings.click())
  const details = surface.querySelector<HTMLElement>('[data-slot="popover-content"]')!
  expect(details.getRootNode()).toBe(mount.getRootNode())
  expect(details.querySelector<HTMLInputElement>(`[aria-label="${i18n.t('agent.toolName')}"]`)!.value).toBe('read_published_topics')
  expect(details.textContent).not.toContain(i18n.t('agent.toolSettingsHint'))
  for (const control of details.querySelectorAll<HTMLButtonElement>('[role="combobox"]')) expect(control.disabled).toBe(true)
  expect([...details.querySelectorAll<HTMLInputElement>('input')].some((input) => input.value === '10')).toBe(true)
  for (const field of surface.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]), textarea'))
    expect(field.readOnly || field.disabled).toBe(true)
  expect([...details.querySelectorAll('button')].some((button) => button.textContent === i18n.t('valueEditor.remove'))).toBe(false)
  const close = details.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t('common.close')}"]`)!
  await act(async () => close.click())
  expect(settings.getAttribute('aria-expanded')).toBe('false')
  const workflowSettings = popup!.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t('agent.toolSettings')} · summarize"]`)!
  await act(async () => workflowSettings.click())
  const workflowName = [...surface.querySelectorAll<HTMLInputElement>(`input[aria-label="${i18n.t('agent.toolName')}"]`)].find(
    (input) => input.value === 'summarize',
  )!
  expect(workflowName).toBeDefined()
  expect(workflowName.readOnly).toBe(true)
  expect(popup!.querySelector(`[aria-label="${i18n.t('workflow.refresh')}"]`)).toBeNull()
  expect(request).not.toHaveBeenCalled()
})
