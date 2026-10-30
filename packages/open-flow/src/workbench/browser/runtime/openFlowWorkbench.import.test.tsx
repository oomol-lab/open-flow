// @vitest-environment happy-dom
import type { ComponentProps } from 'react'
import type { Root } from 'react-dom/client'
import type { OpenFlowWorkbenchHandle, OpenFlowWorkbenchProps } from './openFlowWorkbench.tsx'

import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nProvider } from 'val-i18n-react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkbenchClient } from './api.ts'
import { createI18n } from './i18n.ts'
import { OpenFlowWorkbench } from './openFlowWorkbench.tsx'
import { FlowBrowser } from './shell/resourceBrowser.tsx'
import { WorkbenchStore } from './stores/workbenchStore.ts'

const file = {
  kind: 'open-flow-workflow',
  version: 1,
  content: { modelVersion: 6, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } },
}
const input = { text: JSON.stringify(file), fileName: 'Example.openflow.json' }
let root: Root
let container: HTMLDivElement
const cleanup: (() => void)[] = []

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  for (const dispose of cleanup.splice(0)) dispose()
  container.remove()
  vi.restoreAllMocks()
})

async function browser(overrides: Partial<ComponentProps<typeof FlowBrowser>> = {}) {
  const i18n = createI18n('en')
  const store = new WorkbenchStore(
    new WorkbenchClient(async (path) => Response.json(String(path).startsWith('/v1/tags') ? { tags: [], version: 1 } : { flows: [], total: 0, version: 1 })),
    { getItem: () => null, setItem() {} },
    undefined,
    i18n,
  )
  cleanup.push(() => {
    store.dispose()
    i18n.dispose()
  })
  const ref = createRef<OpenFlowWorkbenchHandle>()
  const onImportFlow = vi.fn(async () => false)
  const props = {
    language: 'en' as const,
    store,
    hrefForFlow: () => '/',
    onCreateFlow: vi.fn(async () => false),
    onImportFlow,
    onSelectFlow: vi.fn(),
    ...overrides,
  }
  const render = async (next: Partial<typeof props> = {}) => {
    Object.assign(props, next)
    await act(async () =>
      root.render(
        <I18nProvider i18n={i18n}>
          <FlowBrowser {...props} ref={ref} />
        </I18nProvider>,
      ),
    )
  }
  await render()
  return { ref, store, onImportFlow, render }
}

async function open(ref: { current: OpenFlowWorkbenchHandle | null }, value = input) {
  let result: ReturnType<OpenFlowWorkbenchHandle['openImport']> | undefined
  await act(async () => {
    result = ref.current?.openImport(value)
  })
  return result
}

async function dialog() {
  // The production dialog is lazy-loaded and opens after mounting.
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
  return document.querySelector('[role="dialog"]')!
}

async function cancelDialog(modal: Element) {
  const cancel = [...modal.querySelectorAll('button')].find((button) => button.textContent == 'Cancel')!
  await act(async () => cancel.click())
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
}

it('opens confirmation once, preserves its snapshot, and retries the same submission identity', async () => {
  const { ref, onImportFlow } = await browser()
  await act(async () => {
    expect(ref.current?.openImport(input)).toBe('opened')
    expect(ref.current?.openImport({ ...input, fileName: 'Replacement.json' })).toBe('unavailable')
  })
  const modal = await dialog()
  expect(modal.querySelector('input')?.value).toBe('Example')
  expect(onImportFlow).not.toHaveBeenCalled()
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => {
      modal.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  }
  expect(onImportFlow).toHaveBeenCalledTimes(2)
  expect(onImportFlow.mock.calls[0]).toEqual(onImportFlow.mock.calls[1])
  expect(onImportFlow).toHaveBeenCalledWith(file, 'Example', expect.any(String), [])
})

it('rejects unavailable states before parsing and makes retained handles inert after unmount', async () => {
  const { ref, render, store } = await browser({ initializing: true })
  const handle = ref.current!
  expect(handle.openImport(input)).toBe('unavailable')
  await render({ initializing: false })
  const busy = vi.spyOn(store.workspace.$.busy, 'value', 'get').mockReturnValue('flow')
  expect(handle.openImport(input)).toBe('unavailable')
  busy.mockRestore()
  const newFlow = [...container.querySelectorAll('button')].find((button) => button.textContent == 'New Flow')!
  await act(async () => newFlow.click())
  expect(handle.openImport(input)).toBe('unavailable')
  await act(async () => root.render(null))
  expect(ref.current).toBeNull()
  expect(handle.openImport(input)).toBe('unavailable')
})

it('shows malformed-file feedback without submitting, and can accept a subsequent valid file', async () => {
  const { ref, store, onImportFlow } = await browser()
  expect(await open(ref, { text: '{}', fileName: 'bad.json' })).toBe('invalid-file')
  expect(store.$.notice.value).toEqual({ kind: 'error', message: 'Invalid or unsupported workflow file.' })
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(onImportFlow).not.toHaveBeenCalled()
  expect(await open(ref)).toBe('opened')
  expect(container.querySelector('[role="alert"]')).toBeNull()
  await dialog()
})

it.each(['malformed', 'unreadable'])('notifies once when a selected file is %s and allows selecting it again', async (failure) => {
  const { store, onImportFlow } = await browser()
  const notice = vi.fn()
  const stop = store.$.notice.reaction(notice)
  const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
  const selected = {
    name: 'broken.json',
    text:
      failure === 'malformed'
        ? async () => '{}'
        : async () => {
            throw new Error('Read failed')
          },
  }
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [selected] })
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await act(async () => fileInput.dispatchEvent(new Event('change', { bubbles: true })))
    expect(notice).toHaveBeenCalledTimes(attempt)
    expect(store.$.notice.value).toEqual({ kind: 'error', message: 'Invalid or unsupported workflow file.' })
    expect(fileInput.value).toBe('')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  }
  expect(onImportFlow).not.toHaveBeenCalled()
  stop()
})

it.each([
  [JSON.stringify({ ...file, name: 'Declared' }), 'other.json', 'Declared'],
  [JSON.stringify(file), undefined, 'Imported workflow'],
])('uses the shared name fallback for external files', async (text, fileName, expected) => {
  const { ref } = await browser()
  await act(async () => {
    ref.current!.openImport({ text, ...(fileName == null ? {} : { fileName }) })
  })
  expect((await dialog()).querySelector('input')?.value).toBe(expected)
})

it.each(['https://github.com/oomol-lab/open-flow', 'javascript:alert(1)'])('only links HTTP(S) provenance: %s', async (sourceUrl) => {
  const { ref } = await browser()
  await act(async () => {
    ref.current!.openImport({ ...input, sourceUrl })
  })
  const modal = await dialog()
  expect(modal.textContent).toContain(sourceUrl)
  expect(modal.querySelector('a')?.getAttribute('href')).toBe(sourceUrl.startsWith('https:') ? sourceUrl : undefined)
})

it('cancels without submitting and uses the same dialog for a local file', async () => {
  const { ref, onImportFlow } = await browser()
  await open(ref)
  const modal = await dialog()
  await cancelDialog(modal)
  expect(onImportFlow).not.toHaveBeenCalled()
  const picker = container.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(picker, 'files', { value: [new File([input.text], 'Local.openflow.json')] })
  await act(async () => {
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect((await dialog()).querySelector('input')?.value).toBe('Local')
})

it('does not close a newer confirmation when an earlier submission finishes', async () => {
  const { ref, onImportFlow } = await browser()
  const submission = Promise.withResolvers<boolean>()
  onImportFlow.mockReturnValueOnce(submission.promise)
  await open(ref)
  const first = await dialog()
  await act(async () => {
    first.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await cancelDialog(first)
  expect(await open(ref, { ...input, fileName: 'Next.json' })).toBe('opened')
  const second = await dialog()
  await act(async () => submission.resolve(true))
  expect(document.querySelector('[role="dialog"]')).toBe(second)
  expect(second.querySelector('input')?.value).toBe('Next')
})

it('can open while the host loads teams, keeping submission disabled until the host is ready', async () => {
  const { ref, render, onImportFlow } = await browser({
    createFlowDisabled: true,
    createFlowField: { state: 'loading', label: 'Team', description: 'Choose a team.', status: 'Loading teams' },
  })
  expect(await open(ref)).toBe('opened')
  const modal = await dialog()
  expect(modal.querySelector('[role="status"]')?.textContent).toContain('Loading teams')
  expect(modal.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
  expect(onImportFlow).not.toHaveBeenCalled()
  await render({ createFlowDisabled: false, createFlowField: undefined })
  expect(modal.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false)
})

it('forwards the public ref only to the active list and invalidates old session handles', async () => {
  vi.spyOn(WorkbenchStore.prototype, 'start').mockResolvedValue(undefined)
  vi.spyOn(WorkbenchStore.prototype, 'selectFlow').mockResolvedValue(true)
  const ref = createRef<OpenFlowWorkbenchHandle>()
  const props: OpenFlowWorkbenchProps = {
    host: {
      request: vi.fn(),
      notify: vi.fn(),
      openExternalPage: async () => false,
      subscribeFlow: () => ({ ready: Promise.resolve(), stop() {} }),
      subscribeFlowCatalog: () => ({ ready: Promise.resolve(), stop() {} }),
    },
    hrefFor: () => '/',
    language: 'en',
    location: { view: 'design' },
    onNavigate: vi.fn(),
    preferences: { getItem: () => null, setItem() {} },
    sessionKey: 'first',
    theme: 'light',
  }
  const render = async (next: Partial<OpenFlowWorkbenchProps> = {}) => {
    Object.assign(props, next)
    await act(async () => root.render(<OpenFlowWorkbench {...props} ref={ref} />))
  }
  await render()
  const first = ref.current!
  await render({ location: { flowId: 'existing', view: 'runs' } })
  expect(first.openImport(input)).toBe('unavailable')
  await render({ location: { view: 'design' } })
  expect(await open({ current: first }, { text: '{}', fileName: 'bad.json' })).toBe('invalid-file')
  await render({ location: { view: 'design' }, sessionKey: 'second' })
  expect(first.openImport(input)).toBe('unavailable')
  expect(await open(ref)).toBe('opened')
  await dialog()
  const second = ref.current!
  await act(async () => root.render(null))
  expect(second.openImport(input)).toBe('unavailable')
})
