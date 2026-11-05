// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import type { WorkflowExportPreview } from '../../../../flow/common/workflowBundle.ts'
import type { WorkflowFile } from '../../../../flow/common/workflowFile.ts'

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, expect, it, vi } from 'vitest'
import { currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { WorkbenchClient } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { WorkbenchStore } from '../stores/workbenchStore.ts'
import { WorkflowExportDialog } from './workflowTransfer.tsx'
import { WorkspacePublishIsland } from './workspacePublishIsland.tsx'

const file: WorkflowFile = {
  kind: 'open-flow-workflow' as const,
  version: 1 as const,
  name: 'Root',
  content: { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } },
}
let root: Root | undefined
let container: HTMLDivElement
let store: WorkbenchStore
let i18n: ReturnType<typeof createI18n>
afterEach(async () => {
  if (root != null) await act(async () => root!.unmount())
  root = undefined
  store?.dispose()
  i18n?.dispose()
  container?.remove()
  vi.restoreAllMocks()
})

async function setup(preview: WorkflowExportPreview, open = true) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const request = vi.fn(async () => Response.json(preview))
  store = new WorkbenchStore(new WorkbenchClient(request), { getItem: () => null, setItem() {} })
  i18n = createI18n('en')
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const blob = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await act(async () =>
    root!.render(
      <I18nProvider i18n={i18n}>
        <WorkflowExportDialog workspace={store.workspace} container={container} />
      </I18nProvider>,
    ),
  )
  if (open) await act(async () => store.workspace.exportFlow('root'))
  return { request, blob, click }
}

it('downloads immediately without dependencies and lets a dependency bundle use the preview snapshot', async () => {
  const preview: WorkflowExportPreview = { version: 1, entryFlowId: 'root', workflows: [{ flowId: 'root', file }], unavailableFlowIds: [] }
  const { request, blob, click } = await setup(preview)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(click).toHaveBeenCalledOnce()
  expect(JSON.parse(await (blob.mock.calls[0]![0] as Blob).text())).toEqual(file)
  blob.mockClear()
  click.mockClear()
  request.mockResolvedValue(Response.json({ ...preview, workflows: [...preview.workflows, { flowId: 'child', file: { ...file, name: 'Child' } }] }))
  await act(async () => store.workspace.exportFlow('root'))
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('Child')
  expect(dialog.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true')
  expect(click).not.toHaveBeenCalled()
  const requests = request.mock.calls.length
  await act(async () => [...dialog.querySelectorAll('button')].find((button) => button.textContent == 'Export')!.click())
  expect(request).toHaveBeenCalledTimes(requests)
  expect(JSON.parse(await (blob.mock.calls[0]![0] as Blob).text())).toMatchObject({
    kind: 'open-flow-workflow-bundle',
    entryFlowId: 'root',
    workflows: [{ flowId: 'root' }, { flowId: 'child' }],
  })
})

it('blocks incomplete bundles, allows single-workflow export and cancels without downloading', async () => {
  const { blob, click } = await setup({ version: 1, entryFlowId: 'root', workflows: [{ flowId: 'root', file }], unavailableFlowIds: ['missing'] })
  let dialog = document.querySelector('[role="dialog"]')!
  const button = [...dialog.querySelectorAll('button')].find((item) => item.textContent == 'Export')!
  expect(button.disabled).toBe(true)
  expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Unavailable')
  await act(async () => (dialog.querySelector('[role="checkbox"]') as HTMLElement).click())
  expect(button.disabled).toBe(false)
  await act(async () => button.click())
  expect(JSON.parse(await (blob.mock.calls[0]![0] as Blob).text())).toEqual(file)
  await act(async () => store.workspace.exportFlow('root'))
  dialog = document.querySelector('[role="dialog"]')!
  await act(async () => [...dialog.querySelectorAll('button')].find((item) => item.textContent == 'Cancel')!.click())
  expect(store.workspace.exportPreview.value).toBeUndefined()
  expect(click).toHaveBeenCalledOnce()
})

it('offers a bundle for a self-referencing incomplete draft so its identity can be remapped', async () => {
  const self = {
    ...file,
    content: {
      ...file.content,
      document: {
        ...file.content.document,
        graph: {
          edges: [],
          nodes: {
            call: {
              kind: 'task' as const,
              inputs: {},
              task: { name: 'Call', inputs: [], outputs: [], executor: { kind: 'workflow' as const, flowId: 'root', revisionId: '' } },
            },
          },
        },
      },
    },
  }
  const { click } = await setup({ version: 1, entryFlowId: 'root', workflows: [{ flowId: 'root', file: self }], unavailableFlowIds: [] })
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(click).not.toHaveBeenCalled()
})

it('hands focus from the production menu to the export dialog and restores its trigger on close', async () => {
  await setup(
    {
      version: 1,
      entryFlowId: 'root',
      workflows: [
        { flowId: 'root', file },
        { flowId: 'child', file: { ...file, name: 'Child' } },
      ],
      unavailableFlowIds: [],
    },
    false,
  )
  await act(async () =>
    root!.render(
      <I18nProvider i18n={i18n}>
        <WorkspacePublishIsland
          hasPublications={false}
          state="ready"
          onExport={() => void store.workspace.exportFlow('root')}
          onOpenPublications={() => {}}
          onOpenRuns={() => {}}
          onPublish={() => {}}
        />
        <WorkflowExportDialog workspace={store.workspace} container={container} />
      </I18nProvider>,
    ),
  )
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!
  await act(async () => trigger.click())
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) => element.textContent?.trim() == 'Export workflow')!
  await act(async () => item.click())
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog!.contains(document.activeElement)).toBe(true)
  })
  const dialog = document.querySelector('[role="dialog"]')!
  await act(async () => [...dialog.querySelectorAll('button')].find((button) => button.textContent == 'Cancel')!.click())
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
})
