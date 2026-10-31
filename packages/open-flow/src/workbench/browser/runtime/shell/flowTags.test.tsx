// @vitest-environment happy-dom
import type { Root } from 'react-dom/client'
import type { Flow, Tag } from '../../../../control/common/api.ts'

import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { currentFlowModelVersion } from '../../../../flow/common/change.ts'
import { WorkbenchClient } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { WorkbenchStore } from '../stores/workbenchStore.ts'
import { FlowSettingsButton } from './flowSettings.tsx'
import { FlowTagChips } from './flowTags.tsx'
import { FlowBrowser } from './resourceBrowser.tsx'

let root: Root | undefined
let store: WorkbenchStore
let container: HTMLDivElement
const i18n = createI18n('en')
afterAll(() => i18n.dispose())
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  store?.dispose()
  container?.remove()
  vi.restoreAllMocks()
})

function button(name: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') == name || item.textContent?.trim() == name)
  if (result == null) throw new Error(`Missing button: ${name}`)
  return result
}
async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
}
async function fill(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function tagInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[aria-label="Search tags"]')!
}
async function openTags(): Promise<HTMLInputElement> {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="Add tags"]') ?? button('Filter by tags')
  await act(async () => trigger.click())
  await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull())
  return tagInput()
}
async function chooseTag(name: string): Promise<void> {
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.trim().startsWith(name))!
  expect(option).toBeDefined()
  await act(async () => option.click())
}

async function fixture(editor = false, referenceState: 'draft' | 'published' | 'changed' | 'disabled' = 'published') {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const timestamp = '2026-10-30T00:00:00.000Z'
  let tags: Tag[] = [
    { tagId: 'sales', name: 'Sales', version: 1 },
    { tagId: 'ai', name: 'AI', version: 1 },
  ]
  let flows: Flow[] = ['One', 'Two'].map((name, index) => {
    const flow: Flow = {
      name,
      flowId: String(index),
      tagIds: [index == 0 ? 'sales' : 'ai'],
      version: 1,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
      draftRevisionId: 'draft',
      resourceReferences: { draft: null, sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] } },
    }
    return referenceState == 'draft'
      ? flow
      : Object.assign(flow, {
          live: {
            hasStart: true,
            enabled: referenceState != 'disabled',
            publicationId: 'publication',
            revisionId: referenceState == 'changed' ? 'previous' : 'draft',
          },
        })
  })
  let failUpdate = false
  let failTagSave = false
  let tagConflict = false
  let omitTotal = false
  let flowListWait: Promise<void> | undefined
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    const url = new URL(path, 'https://test')
    if (url.pathname.startsWith('/v1/tags') && (init?.method == 'POST' || init?.method == 'PATCH') && tagConflict) {
      tagConflict = false
      return Response.json({ error: { code: 'tag.conflict', message: 'Duplicate' } }, { status: 409 })
    }
    if (url.pathname.startsWith('/v1/tags') && (init?.method == 'POST' || init?.method == 'PATCH') && failTagSave) {
      failTagSave = false
      return Response.json({ error: { code: 'request.failed', message: 'Unavailable' } }, { status: 500 })
    }
    if (url.pathname == '/v1/flows/0/editor') {
      return Response.json({
        flow: flows[0],
        draft: {
          actorId: 'actor',
          createdAt: timestamp,
          digest: 'digest',
          flowId: '0',
          modelVersion: currentFlowModelVersion,
          parentRevisionId: null,
          revisionId: 'draft',
          version: 1,
          content: { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } },
        },
        live: { flowId: '0', hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
        presentation: { revision: 1, updatedAt: timestamp, value: {}, version: 1 },
        version: 1,
      })
    }
    if (url.pathname == '/v1/tags' && init?.method == 'POST') {
      const { name } = JSON.parse(String(init.body)) as { name: string }
      const tag: Tag = { tagId: `tag-${tags.length}`, name, version: 1 }
      tags = [...tags, tag]
      return Response.json(tag)
    }
    if (url.pathname.startsWith('/v1/tags/') && init?.method == 'PATCH') {
      const tagId = url.pathname.split('/')[3]
      const { name } = JSON.parse(String(init.body)) as { name: string }
      tags = tags.map((tag) => (tag.tagId == tagId ? { ...tag, name } : tag))
      return Response.json(tags.find((tag) => tag.tagId == tagId))
    }
    if (url.pathname == '/v1/tags')
      return Response.json({
        tags: tags.map((tag) => Object.assign({}, tag, { referenceCount: flows.filter((flow) => flow.tagIds?.includes(tag.tagId)).length })),
        version: 1,
      })
    if (init?.method == 'PUT' && url.pathname.endsWith('/enabled')) {
      const flowId = url.pathname.split('/')[3]
      const { enabled } = JSON.parse(String(init.body)) as { enabled: boolean }
      flows = flows.map((flow) =>
        flow.flowId == flowId && flow.live != null ? Object.assign({}, flow, { live: Object.assign({}, flow.live, { enabled }) }) : flow,
      )
      return Response.json(flows.find((flow) => flow.flowId == flowId))
    }
    if (init?.method == 'PATCH') {
      if (failUpdate) {
        failUpdate = false
        return Response.json({ error: { code: 'request.failed', message: 'Unavailable' } }, { status: 500 })
      }
      const flowId = url.pathname.split('/')[3]
      const changes = JSON.parse(String(init.body)) as { name?: string; tagIds?: string[] }
      flows = flows.map((flow) =>
        flow.flowId == flowId
          ? Object.assign({}, flow, changes.name == null ? {} : { name: changes.name }, changes.tagIds == null ? {} : { tagIds: changes.tagIds })
          : flow,
      )
      return Response.json(flows.find((flow) => flow.flowId == flowId))
    }
    if (url.pathname == '/v1/flows') {
      const waiting = flowListWait
      flowListWait = undefined
      await waiting
      const selected = url.searchParams.get('tagIds')?.split(',') ?? []
      const query = url.searchParams.get('query') ?? ''
      const result = flows.filter((flow) => flow.name.toLowerCase().includes(query) && (!selected.length || flow.tagIds?.some((id) => selected.includes(id))))
      return Response.json({ flows: result.map((flow) => ({ ...flow, referenceCount: 0 })), ...(omitTotal ? {} : { total: result.length }), version: 1 })
    }
    throw new Error(path)
  })
  const client = new WorkbenchClient(request)
  store = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, i18n)
  if (editor) await store.workspace.start('0')
  else await store.workspace.reloadFlows()
  container = document.createElement('div')
  container.className = 'open-flow-workbench open-flow-theme'
  document.body.append(container)
  root = createRoot(container)
  const onCreateFlow = vi.fn(async (_name: string, _tagIds?: readonly string[]) => false)
  const context = { store, container, hrefForFlow: (flow: Pick<Flow, 'flowId'>) => `/flows/${flow.flowId}/design`, onSelectFlow: vi.fn() }
  function Editor() {
    const flow = useVal(store.workspace.$.flow)
    return flow == null ? null : <FlowSettingsButton key={flow.flowId} {...context} flow={flow} />
  }
  await act(async () =>
    root!.render(
      <StrictMode>
        <I18nProvider i18n={i18n}>{editor ? <Editor /> : <FlowBrowser {...context} language="en" onCreateFlow={onCreateFlow} />}</I18nProvider>
      </StrictMode>,
    ),
  )
  await vi.waitFor(() => expect(editor ? container.querySelector('[aria-label="Flow settings"]') : container.textContent?.includes('One')).toBeTruthy())
  return {
    request,
    onCreateFlow,
    selectFlow: context.onSelectFlow,
    omitFlowTotal: () => {
      omitTotal = true
    },
    failUpdate: () => {
      failUpdate = true
    },
    failTagSave: () => {
      failTagSave = true
    },
    conflictOnTagSave: () => {
      tagConflict = true
    },
    blockNextFlowList: () => {
      const pending = Promise.withResolvers<void>()
      flowListWait = pending.promise
      return pending.resolve
    },
  }
}

it('filters a production list and queries usage without narrowing the editor catalog', async () => {
  const { request } = await fixture()
  await click('Filter by Sales')
  await vi.waitFor(() => expect(container.textContent).not.toContain('Two'))
  expect(store.workspace.$.flows.value.map((flow) => flow.name)).toEqual(['One', 'Two'])
  expect(document.querySelector('[aria-label="Remove Sales"]')).not.toBeNull()
  expect(request).toHaveBeenCalledWith(expect.stringContaining('tagIds=sales'), expect.anything())
  await openTags()
  await click('Manage tags')
  await click('Flows tagged “Sales”')
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"] a[href="/flows/0/design"]')).not.toBeNull())
  expect(document.querySelector('[role="dialog"] a[href="/flows/0/design"]')?.textContent).toBe('One')
})

it('refreshes the active query after renaming without waiting for catalog notifications', async () => {
  await fixture()
  await fill(document.querySelector<HTMLInputElement>('input[name="flow-search"]')!, 'One')
  await vi.waitFor(() => expect(container.textContent).not.toContain('Two'))
  await click('Actions')
  const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() == 'Rename')!
  await act(async () => rename.click())
  const name = document.querySelector<HTMLInputElement>('input[name="flow-name"]')!
  await fill(name, 'Outside query')
  await act(async () => name.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(container.querySelector('a[href="/flows/0/design"]')).toBeNull())
  expect(store.workspace.$.flows.value.find((flow) => flow.flowId == '0')?.name).toBe('Outside query')
})

it('refreshes runtime status in the active query after stopping a Flow', async () => {
  await fixture()
  await fill(document.querySelector<HTMLInputElement>('input[name="flow-search"]')!, 'One')
  await vi.waitFor(() => expect(container.textContent).not.toContain('Two'))
  await click('Actions')
  const stop = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() == 'Stop')!
  await act(async () => stop.click())
  await vi.waitFor(() => expect(container.textContent).toContain('Stopped'))
  expect(container.textContent).not.toContain('Two')
  expect(store.workspace.$.flows.value.find((flow) => flow.flowId == '0')?.live?.enabled).toBe(false)
})

it('does not infer a query total from loaded rows when the response omits it', async () => {
  const { omitFlowTotal } = await fixture()
  omitFlowTotal()
  await fill(document.querySelector<HTMLInputElement>('input[name="flow-search"]')!, 'One')
  await vi.waitFor(() => expect(container.textContent).not.toContain('Two'))
  expect(container.querySelector('a[href="/flows/0/design"]')).not.toBeNull()
  expect(container.textContent).not.toContain('1 total')
})

it('searches and multi-selects inside the filter panel, then restores focus to its icon', async () => {
  await fixture()
  expect(tagInput()).toBeNull()
  const trigger = button('Filter by tags')
  const input = await openTags()
  await vi.waitFor(() => expect(document.activeElement).toBe(input))
  expect(input.closest('[role="dialog"]')?.getAttribute('aria-label')).toBe('Filter by tags')
  await fill(input, 'sAl')
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
  expect(document.querySelector('[role="option"]')?.textContent).toContain('Sales')
  await chooseTag('Sales')
  expect(input.value).toBe('')
  await chooseTag('AI')
  expect(document.querySelector('[aria-label="Remove Sales"]')).not.toBeNull()
  expect(document.querySelector('[aria-label="Remove AI"]')).not.toBeNull()
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(tagInput()).toBeNull()
  await click('Clear filters')
  expect(document.querySelector('[aria-label="Remove Sales"]')).toBeNull()
  expect(document.querySelector('[aria-label="Remove AI"]')).toBeNull()
})

it('hands focus from the tag panel to management and back to the add chip', async () => {
  await fixture(true)
  await click('Flow settings')
  const trigger = button('Add tags')
  await openTags()
  await click('Manage tags')
  await vi.waitFor(() => expect(document.activeElement).toBe(tagInput()))
  expect(document.querySelector('[role="listbox"]')).toBeNull()
  await click('Close')
  await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
  expect(document.querySelector('[aria-label="Remove Sales"]')).not.toBeNull()
})

it('searches inside the tag panel and retains title and tag edits together for retry', async () => {
  const { request, failUpdate } = await fixture(true)
  await click('Flow settings')
  const title = document.querySelector<HTMLInputElement>('input[name="flow-title"]')!
  await fill(title, 'Renamed')
  expect(tagInput()).toBeNull()
  expect(button('Add tags').getAttribute('aria-expanded')).toBe('false')
  const input = await openTags()
  expect(document.querySelectorAll('input[aria-label="Search tags"]')).toHaveLength(1)
  expect(input.closest('[role="dialog"]')?.getAttribute('aria-label')).toBe('Add tags')
  await fill(input, 'New label')
  await vi.waitFor(() => expect(document.querySelector('[role="option"]')?.textContent).toContain('Create “New label”'))
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await vi.waitFor(() => expect(document.querySelector('[aria-label="Remove New label"]')).not.toBeNull())
  expect(document.activeElement).toBe(input)
  expect(request.mock.calls.filter(([, init]) => init?.method == 'PATCH')).toHaveLength(0)
  if (input.getAttribute('aria-expanded') == 'true') await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  failUpdate()
  await click('Save')
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(title.value).toBe('Renamed')
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New label')
  expect(store.$.notice.value?.kind).toBe('error')
  await click('Save')
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  expect(store.workspace.$.flows.value[0]).toMatchObject({ name: 'Renamed', tagIds: ['sales', 'tag-2'], live: { revisionId: 'draft' } })
  const saves = request.mock.calls.filter(([, init]) => init?.method == 'PATCH')
  expect(saves).toHaveLength(2)
  expect(saves[0]?.[1]?.body).toEqual(saves[1]?.[1]?.body)
  expect(JSON.parse(String(saves[0]?.[1]?.body))).toEqual({ name: 'Renamed', tagIds: ['sales', 'tag-2'], version: 1 })
})

it('validates the title and saves a title-only change without replacing tags', async () => {
  const { request } = await fixture(true)
  await click('Flow settings')
  const title = document.querySelector<HTMLInputElement>('input[name="flow-title"]')!
  await fill(title, '  ')
  expect(title.getAttribute('aria-invalid')).toBe('true')
  expect(button('Save').disabled).toBe(true)
  await fill(title, '  Updated title  ')
  await click('Save')
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  expect(JSON.parse(String(request.mock.calls.find(([, init]) => init?.method == 'PATCH')?.[1]?.body))).toEqual({ name: 'Updated title', version: 1 })
  expect(store.workspace.$.flows.value[0]?.tagIds).toEqual(['sales'])
})

it.each(['cancel', 'close', 'escape'])('confirms unsaved title and tag changes on %s', async (method) => {
  const { request } = await fixture(true)
  await click('Flow settings')
  const title = document.querySelector<HTMLInputElement>('input[name="flow-title"]')!
  await fill(title, 'Unsaved title')
  const input = await openTags()
  await chooseTag('AI')
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(document.body.textContent).not.toContain('Discard changes?')
  if (method == 'cancel') await click('Cancel')
  else if (method == 'close') await act(async () => document.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]')!.click())
  else await act(async () => title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(document.body.textContent).toContain('Discard changes?'))
  await click('Continue editing')
  expect(title.value).toBe('Unsaved title')
  expect(document.querySelector('[aria-label="Remove AI"]')).not.toBeNull()
  await click('Cancel')
  await click('Discard changes')
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  expect(request.mock.calls.filter(([, init]) => init?.method == 'PATCH')).toHaveLength(0)
  await click('Flow settings')
  expect(document.querySelector<HTMLInputElement>('input[name="flow-title"]')!.value).toBe('One')
  expect(document.querySelector('[aria-label="Remove AI"]')).toBeNull()
})

it('allows closing immediately after restoring the original title and tag set', async () => {
  await fixture(true)
  await click('Flow settings')
  const title = document.querySelector<HTMLInputElement>('input[name="flow-title"]')!
  await fill(title, 'Changed')
  const input = await openTags()
  await chooseTag('AI')
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await click('Remove AI')
  await fill(title, 'One')
  await click('Cancel')
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
})

it('guards navigation from tag usage while settings contain unsaved tags', async () => {
  const { selectFlow } = await fixture(true)
  await click('Flow settings')
  await openTags()
  await chooseTag('AI')
  await click('Manage tags')
  await click('Flows tagged “AI”')
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"] a[href="/flows/1/design"]')).not.toBeNull())
  await act(async () => document.querySelector<HTMLAnchorElement>('[role="dialog"] a[href="/flows/1/design"]')!.click())
  expect(selectFlow).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('Discard changes?')
  await click('Discard changes')
  expect(selectFlow).toHaveBeenCalledWith(expect.objectContaining({ flowId: '1' }))
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
})

it('shows overflow tags in a menu and filters through them', async () => {
  await fixture()
  await act(async () => {
    await store.tags.save('Overflow')
  })
  const onFilter = vi.fn()
  await act(async () =>
    root!.render(
      <I18nProvider i18n={i18n}>
        <FlowTagChips store={store} ids={['sales', 'ai', 'tag-2']} onFilter={onFilter} container={container} />
      </I18nProvider>,
    ),
  )
  expect(document.querySelector('[aria-label="Filter by Overflow"]')).toBeNull()
  await click('Show 1 more tags')
  const item = document.querySelector<HTMLElement>('[role="menuitem"][aria-label="Filter by Overflow"]')!
  expect(item).not.toBeNull()
  await act(async () => item.click())
  expect(onFilter).toHaveBeenCalledWith('tag-2')
})

it.each(['create', 'rename'])('keeps settings and tag management open after a tag %s without submitting Flow edits', async (operation) => {
  const { request, blockNextFlowList, failTagSave } = await fixture(true)
  await click('Flow settings')
  const title = document.querySelector<HTMLInputElement>('input[name="flow-title"]')!
  await fill(title, 'Unsubmitted title')
  await openTags()
  await click('Manage tags')
  if (operation == 'rename') {
    await click('Actions')
    const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() == 'Rename')!
    await act(async () => rename.click())
  } else await click('New tag')
  const tagName = document.querySelector<HTMLInputElement>('#tag-name')!
  expect(tagName.closest('[role="dialog"]')?.getAttribute('aria-label')).toBe(operation == 'create' ? 'New tag' : 'Rename')
  if (operation == 'create') {
    expect(tagName.getAttribute('aria-invalid')).toBe('false')
    expect(tagName.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true)
    await act(async () => tagName.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(request.mock.calls.some(([path, init]) => path == '/v1/tags' && init?.method == 'POST')).toBe(false)
  }
  await fill(tagName, 'Managed label')
  failTagSave()
  await act(async () => tagName.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())
  expect(document.querySelector('#tag-name')).toBe(tagName)
  expect(tagName.value).toBe('Managed label')
  expect(store.$.notice.value?.kind).toBe('error')
  const release = blockNextFlowList()
  try {
    await act(async () => tagName.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())
    await vi.waitFor(() => expect(request.mock.calls.some(([path]) => path.startsWith('/v1/flows?'))).toBe(true))
    expect(document.querySelectorAll('[data-slot="dialog-content"]')).toHaveLength(2)
    expect(title.value).toBe('Unsubmitted title')
  } finally {
    await act(async () => release())
  }
  await vi.waitFor(() => expect(store.tags.state.value.tags.some((tag) => tag.name == 'Managed label')).toBe(true))
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
  expect(button('New tag')).toBeDefined()
  expect(document.activeElement).toBe(button(operation == 'create' ? 'New tag' : 'Actions'))
  expect(request.mock.calls.filter(([path, init]) => path.startsWith('/v1/flows/') && init?.method == 'PATCH')).toHaveLength(0)
  expect(store.workspace.$.flows.value[0]?.name).toBe('One')
  await click('Close')
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
  expect(title.value).toBe('Unsubmitted title')
})

it('dismisses the tag form with Escape and returns to management without submitting', async () => {
  const { request } = await fixture(true)
  await click('Flow settings')
  await openTags()
  await click('Manage tags')
  await click('New tag')
  const input = document.querySelector<HTMLInputElement>('#tag-name')!
  await fill(input, 'Unsaved tag')
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(document.querySelector('#tag-name')).toBeNull())
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
  expect(document.activeElement).toBe(button('New tag'))
  expect(request.mock.calls.filter(([path, init]) => path.startsWith('/v1/tags') && (init?.method == 'POST' || init?.method == 'PATCH'))).toEqual([])
  expect(request.mock.calls.some(([path, init]) => path == '/v1/flows/0' && init?.method == 'PATCH')).toBe(false)
})

it.each(['create', 'rename'])('reports duplicate names on the %s field and clears feedback when corrected', async (operation) => {
  const { request } = await fixture(true)
  await click('Flow settings')
  await openTags()
  await click('Manage tags')
  if (operation == 'rename') {
    await click('Actions')
    const rename = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() == 'Rename')!
    await act(async () => rename.click())
  } else await click('New tag')
  const input = document.querySelector<HTMLInputElement>('#tag-name')!
  const submit = input.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!
  if (operation == 'rename') expect(submit.disabled).toBe(false)
  const notice = store.$.notice.value
  await fill(input, '  aI  ')
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('A tag with this name already exists.')
  expect(submit.disabled).toBe(true)
  expect(store.$.notice.value).toBe(notice)
  expect(request.mock.calls.filter(([path, init]) => path.startsWith('/v1/tags') && (init?.method == 'POST' || init?.method == 'PATCH'))).toEqual([])
  await fill(input, 'Distinct name')
  expect(input.getAttribute('aria-invalid')).toBe('false')
  expect(input.getAttribute('aria-describedby')).toBeNull()
  expect(submit.disabled).toBe(false)
})

it('keeps a server name conflict on the field and allows correction and retry without a global notice', async () => {
  const { conflictOnTagSave } = await fixture(true)
  await click('Flow settings')
  await openTags()
  await click('Manage tags')
  await click('New tag')
  const input = document.querySelector<HTMLInputElement>('#tag-name')!
  await fill(input, 'Created elsewhere')
  const notice = store.$.notice.value
  conflictOnTagSave()
  await act(async () => input.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())
  expect(input.isConnected).toBe(true)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toBe('A tag with this name already exists.')
  expect(store.$.notice.value).toBe(notice)
  await fill(input, 'New unique name')
  expect(input.getAttribute('aria-invalid')).toBe('false')
  await act(async () => input.closest('form')!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click())
  await vi.waitFor(() => expect(document.querySelector('#tag-name')).toBeNull())
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
  expect(store.tags.hasName('New unique name')).toBe(true)
})

it('searches tag rows and cancels deletion from the row menu without leaving management', async () => {
  const { request } = await fixture(true)
  await click('Flow settings')
  await openTags()
  await click('Manage tags')
  const manager = [...document.querySelectorAll('[role="dialog"]')].at(-1)!
  const search = manager.querySelector<HTMLInputElement>('input[aria-label="Search tags"]')!
  await fill(search, 'sales')
  expect(manager.querySelector('tbody')?.textContent).toContain('Sales')
  expect(manager.querySelector('tbody')?.textContent).not.toContain('AI')
  await click('Actions')
  const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() == 'Delete')!
  await act(async () => remove.click())
  const confirmation = [...document.querySelectorAll('[role="dialog"]')].at(-1)!
  expect(confirmation.textContent).toContain('Delete “Sales”?')
  const cancel = [...confirmation.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() == 'Cancel')!
  await act(async () => cancel.click())
  await vi.waitFor(() => expect(document.activeElement).toBe(button('Actions')))
  expect(manager.isConnected).toBe(true)
  expect(request.mock.calls.some(([, init]) => init?.method == 'DELETE')).toBe(false)
  await fill(search, 'missing')
  expect(manager.querySelector('tbody')?.children).toHaveLength(0)
  expect(manager.textContent).toContain('No matching tags')
})

it('includes combobox tag selections in the creation form submission', async () => {
  const { onCreateFlow } = await fixture()
  await click('New Flow')
  await vi.waitFor(() => expect(document.querySelector('input[name="resource-name"]')).not.toBeNull())
  const name = document.querySelector<HTMLInputElement>('input[name="resource-name"]')!
  await fill(name, 'Created')
  const input = await openTags()
  await chooseTag('Sales')
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await act(async () => name.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(onCreateFlow).toHaveBeenCalledWith('Created', ['sales'])
})

it('closes settings before navigating through a usage reference', async () => {
  const { selectFlow } = await fixture(true)
  await click('Flow settings')
  await openTags()
  await click('Manage tags')
  await click('Flows tagged “AI”')
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"] a[href="/flows/1/design"]')).not.toBeNull())
  await act(async () => document.querySelector<HTMLAnchorElement>('[role="dialog"] a[href="/flows/1/design"]')!.click())
  expect(selectFlow).toHaveBeenCalledWith(expect.objectContaining({ flowId: '1' }))
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
})

it.each([
  ['draft', ['Draft']],
  ['published', ['Published', 'Running']],
  ['changed', ['Changes pending', 'Running']],
  ['disabled', ['Published', 'Stopped']],
] as const)('summarizes %s tag references without repeating unpublished state', async (state, summary) => {
  await fixture(false, state)
  await openTags()
  await click('Manage tags')
  await click('Flows tagged “Sales”')
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"] a[href="/flows/0/design"]')).not.toBeNull())
  const row = document.querySelector('[role="dialog"] a[href="/flows/0/design"]')!.closest('li')!
  for (const label of summary) expect(row.textContent).toContain(label)
  expect(row.textContent).not.toContain('Unpublished')
})
