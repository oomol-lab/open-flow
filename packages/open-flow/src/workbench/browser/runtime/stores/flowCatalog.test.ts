import type { WorkflowFile } from '../../../../flow/common/workflowFile.ts'

import { afterEach, expect, it, vi } from 'vitest'
import { ApiError, WorkbenchClient } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { FlowCatalog } from './flowCatalog.ts'

const flow = {
  createdAt: '2026-09-08T00:00:00.000Z',
  updatedAt: '2026-09-08T00:00:00.000Z',
  draftRevisionId: 'draft',
  resourceReferences: {
    draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
    sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
  },
  flowId: 'flow',
  name: 'Main',
  status: 'active',
  version: 1,
  live: { hasStart: true, enabled: true, publicationId: 'live', revisionId: 'published' },
} as const
const operation = {
  createdAt: flow.createdAt,
  updatedAt: flow.updatedAt,
  flowId: flow.flowId,
  operationId: 'operation',
  revisionId: flow.draftRevisionId,
  status: 'pending',
  version: 1,
} as const

afterEach(() => vi.useRealTimers())

it.each(['rename', 'delete'] as const)('can %s a selected Flow outside the workspace page', async (action) => {
  const client = new WorkbenchClient(vi.fn())
  const i18n = createI18n()
  const catalog = new FlowCatalog(client, vi.fn(), i18n)
  const firstPage = { ...flow, referenceCount: 0 }
  const selected = { ...flow, flowId: 'later-page', name: 'Later page' }
  vi.spyOn(client, 'listFlows').mockResolvedValue({ flows: [firstPage], total: 2, nextCursor: 'next', version: 1 })
  const rename = vi.spyOn(client, 'renameFlow').mockResolvedValue({ ...selected, name: 'Renamed' })
  const remove = vi.spyOn(client, 'deleteFlow').mockResolvedValue({ ...selected, status: 'retiring' })
  try {
    await catalog.reload()
    expect(catalog.flow(selected.flowId)).toBeUndefined()
    if (action == 'rename') {
      expect(await catalog.rename(selected, 'Renamed')).toBe(true)
      expect(rename).toHaveBeenCalledWith(selected.flowId, 'Renamed')
      expect(catalog.flow(selected.flowId)?.name).toBe('Renamed')
      expect(catalog.$.total.value).toBe(2)
    } else {
      expect(await catalog.delete(selected)).toBe(true)
      expect(remove).toHaveBeenCalledWith(selected.flowId)
      expect(catalog.$.total.value).toBe(1)
    }
    expect(catalog.flow(flow.flowId)).toEqual(firstPage)
  } finally {
    catalog.dispose()
    i18n.dispose()
  }
})

it.each(['local', 'host'] as const)('imports a Flow through the %s and updates the catalog once', async (source) => {
  const client = new WorkbenchClient(vi.fn())
  const catalog = new FlowCatalog(client, vi.fn(), createI18n())
  const file: WorkflowFile = {
    kind: 'open-flow-workflow',
    version: 1,
    content: { modelVersion: 6, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } },
  }
  const importFlow = vi.spyOn(client, 'importFlow').mockResolvedValue(flow)
  const getFlow = vi.spyOn(client, 'getFlow').mockResolvedValue(flow)
  const importer = vi.fn(async () => flow.flowId)
  vi.spyOn(client, 'listFlows').mockResolvedValue({ version: 1, flows: [], total: 0 })
  try {
    await catalog.reload()
    expect(await catalog.import(file, flow.name, 'import-key', source == 'host' ? importer : undefined)).toEqual(flow)
    if (source == 'host') {
      expect(importer).toHaveBeenCalledWith(file, flow.name, 'import-key')
      expect(getFlow).toHaveBeenCalledWith(flow.flowId)
      expect(importFlow).not.toHaveBeenCalled()
    } else {
      expect(importFlow).toHaveBeenCalledWith(file, { name: flow.name, idempotencyKey: 'import-key' })
      expect(getFlow).not.toHaveBeenCalled()
    }
    await catalog.import(file, flow.name, 'import-key', source == 'host' ? importer : undefined)
    expect(catalog.$.flows.value).toEqual([flow])
    expect(catalog.$.total.value).toBe(1)
  } finally {
    catalog.dispose()
  }
})

it('keeps a failed rename intact and applies the trimmed authoritative result after retry', async () => {
  const client = new WorkbenchClient(vi.fn())
  const notice = vi.fn()
  const catalog = new FlowCatalog(client, notice, createI18n())
  const rename = vi
    .spyOn(client, 'renameFlow')
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue({ ...flow, name: 'Renamed' })
  catalog.include(flow)
  try {
    expect(await catalog.rename(flow, '   ')).toBe(false)
    expect(await catalog.rename(flow, ` ${flow.name} `)).toBe(true)
    expect(rename).not.toHaveBeenCalled()
    expect(await catalog.rename(flow, ' Renamed ')).toBe(false)
    expect(catalog.flow(flow.flowId)).toEqual(flow)
    expect(notice).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'error' }))
    expect(await catalog.rename(flow, ' Renamed ')).toBe(true)
    expect(rename).toHaveBeenLastCalledWith(flow.flowId, 'Renamed')
    expect(catalog.flow(flow.flowId)?.name).toBe('Renamed')
    expect(notice).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'success' }))
  } finally {
    catalog.dispose()
  }
})

it('retains a Flow after failed deletion and removes it only after acceptance', async () => {
  const client = new WorkbenchClient(vi.fn())
  const notice = vi.fn()
  const catalog = new FlowCatalog(client, notice, createI18n())
  const remove = vi
    .spyOn(client, 'deleteFlow')
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValue({ ...flow, status: 'retiring' })
  vi.spyOn(client, 'listFlows').mockResolvedValue({ version: 1, flows: [{ ...flow, status: 'retiring', referenceCount: 0 }], total: 1 })
  try {
    await catalog.reload()
    expect(await catalog.delete(catalog.flow(flow.flowId)!)).toBe(false)
    expect(remove).not.toHaveBeenCalled()
    catalog.include(flow)
    expect(await catalog.delete(flow)).toBe(false)
    expect(catalog.flow(flow.flowId)).toEqual({ ...flow, referenceCount: 0 })
    expect(catalog.$.total.value).toBe(1)
    expect(notice).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'error' }))
    expect(await catalog.delete(flow)).toBe(true)
    expect(remove).toHaveBeenLastCalledWith(flow.flowId)
    expect(catalog.$.flows.value).toEqual([])
    expect(catalog.$.total.value).toBe(0)
    expect(notice).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'success' }))
  } finally {
    catalog.dispose()
  }
})

it.each(['create', 'rename', 'delete'] as const)('ignores a pending %s result after disposal', async (action) => {
  const client = new WorkbenchClient(vi.fn())
  const notice = vi.fn()
  const catalog = new FlowCatalog(client, notice, createI18n())
  const pending = Promise.withResolvers<void>()
  vi.spyOn(client, 'createFlow').mockImplementation(async () => {
    await pending.promise
    return flow
  })
  vi.spyOn(client, 'renameFlow').mockImplementation(async () => {
    await pending.promise
    return { ...flow, name: 'Renamed' }
  })
  vi.spyOn(client, 'deleteFlow').mockImplementation(async () => {
    await pending.promise
    return { ...flow, status: 'retiring' }
  })
  catalog.include(flow)
  const saving = action == 'create' ? catalog.create(flow.name) : action == 'rename' ? catalog.rename(flow, 'Renamed') : catalog.delete(flow)
  catalog.dispose()
  pending.resolve()
  expect(await saving).toBe(action == 'create' ? undefined : false)
  expect(notice).not.toHaveBeenCalled()
})

it('advances the draft and its resource references together while preserving shared access', () => {
  const catalog = new FlowCatalog(new WorkbenchClient(vi.fn()), vi.fn(), createI18n())
  const sharedAccess = { accessRevision: 2, providerIds: ['mail'], bindings: [{ providerId: 'mail', connectionId: 'shared', accessBindingId: 'grant' }] }
  catalog.include({ ...flow, resourceReferences: { ...flow.resourceReferences, sharedAccess } })
  try {
    catalog.advanceHead('flow', 'next', {
      modelVersion: 6,
      modules: {},
      document: {
        bindings: {},
        graph: {
          edges: [],
          nodes: {
            error: { kind: 'error', name: 'Error', sourceFlowIds: ['upstream'] },
          },
        },
      },
    })
    expect(catalog.flow('flow')).toMatchObject({
      draftRevisionId: 'next',
      resourceReferences: { draft: { variableNames: [], connections: [], errorSourceFlowIds: ['upstream'] }, sharedAccess },
    })
  } finally {
    catalog.dispose()
  }
})

it('refreshes stale enable controls without overwriting the current publication', async () => {
  const client = new WorkbenchClient(vi.fn())
  const notice = vi.fn()
  const catalog = new FlowCatalog(client, notice, createI18n())
  const current = { ...flow, live: { ...flow.live, publicationId: 'new-live' } }
  const change = vi.spyOn(client, 'setFlowEnabled').mockRejectedValue(new ApiError(409, 'flow.conflict', 'Changed'))
  vi.spyOn(client, 'listFlows').mockResolvedValue({ flows: [{ ...current, referenceCount: 0 }], version: 1 })
  catalog.include(flow)
  try {
    await catalog.setEnabled(flow, false)
    expect(change).toHaveBeenCalledWith('flow', 'live', false)
    expect(catalog.flow('flow')).toEqual({ ...current, referenceCount: 0 })
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
  } finally {
    catalog.dispose()
  }
})

it('publishes the selected list revision and shows the authoritative disabled state', async () => {
  const client = new WorkbenchClient(vi.fn())
  const notice = vi.fn()
  const catalog = new FlowCatalog(client, notice, createI18n())
  const changed = { ...flow, live: { hasStart: true, enabled: false, publicationId: 'new-live', revisionId: 'draft' } }
  const publish = vi.spyOn(client, 'publishFlow').mockResolvedValue({ ...operation, status: 'succeeded', publicationId: 'new-live' })
  vi.spyOn(client, 'getFlow').mockResolvedValue(changed)
  catalog.include(flow)
  try {
    await catalog.publish(flow)
    expect(publish).toHaveBeenCalledWith('flow', 'draft', 'live')
    expect(catalog.flow('flow')).toEqual(changed)
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
  } finally {
    catalog.dispose()
  }
})

it('stops observing a pending publication when the workspace is disposed', async () => {
  vi.useFakeTimers()
  const client = new WorkbenchClient(vi.fn())
  const notice = vi.fn()
  const catalog = new FlowCatalog(client, notice, createI18n())
  vi.spyOn(client, 'publishFlow').mockResolvedValue(operation)
  const observe = vi.spyOn(client, 'getPublishOperation').mockResolvedValue(operation)
  const publishing = catalog.publish(flow)
  await vi.advanceTimersByTimeAsync(1000)
  expect(observe).toHaveBeenCalledTimes(1)
  catalog.dispose()
  await publishing
  await vi.advanceTimersByTimeAsync(3000)
  expect(observe).toHaveBeenCalledTimes(1)
  expect(notice).not.toHaveBeenCalled()
})

it('retains list counts through detail merges and replaces them only on list reload', async () => {
  const client = new WorkbenchClient(vi.fn())
  const list = vi.spyOn(client, 'listFlows').mockResolvedValue({ flows: [{ ...flow, referenceCount: 2 }], version: 1 })
  const catalog = new FlowCatalog(client, vi.fn(), createI18n())
  try {
    await catalog.reload()
    catalog.include({ ...flow, name: 'Renamed' })
    expect(catalog.$.flows.value[0]).toMatchObject({ name: 'Renamed', referenceCount: 2 })
    const { live: _live, ...unpublished } = flow
    catalog.include(unpublished)
    expect(catalog.$.flows.value[0]).not.toHaveProperty('live')
    expect(catalog.$.flows.value[0]?.referenceCount).toBe(2)
    catalog.include({ ...flow, flowId: 'detail-only' })
    expect(catalog.$.flows.value[1]).not.toHaveProperty('referenceCount')
    list.mockResolvedValue({ flows: [{ ...flow, referenceCount: 0 }], version: 1 })
    await catalog.reload()
    expect(catalog.$.flows.value[0]?.referenceCount).toBe(0)
  } finally {
    catalog.dispose()
  }
})

it('applies list metadata to detail-only entries when their page is loaded without duplicating rows', async () => {
  const client = new WorkbenchClient(vi.fn())
  const detail = { ...flow, flowId: 'detail-only' }
  const listed = { ...detail, name: 'Current name', referenceCount: 3 }
  const list = vi
    .spyOn(client, 'listFlows')
    .mockResolvedValueOnce({ flows: [{ ...flow, referenceCount: 0 }], nextCursor: 'next', version: 1 })
    .mockResolvedValueOnce({ flows: [listed], version: 1 })
  const catalog = new FlowCatalog(client, vi.fn(), createI18n())
  try {
    await catalog.reload()
    catalog.include(detail)
    expect(catalog.$.flows.value[1]).not.toHaveProperty('referenceCount')
    await catalog.loadMore()
    expect(catalog.$.flows.value).toEqual([{ ...flow, referenceCount: 0 }, listed])
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next', limit: 50 }))
  } finally {
    catalog.dispose()
  }
})

it('keeps filtered query pages separate and discards late pages after query changes', async () => {
  const client = new WorkbenchClient(vi.fn())
  const first = Promise.withResolvers<Awaited<ReturnType<typeof client.listFlows>>>()
  const second = Promise.withResolvers<Awaited<ReturnType<typeof client.listFlows>>>()
  const list = vi.spyOn(client, 'listFlows').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const filtered = new FlowCatalog(client, vi.fn(), createI18n())
  const workspace = new FlowCatalog(client, vi.fn(), createI18n())
  workspace.include(flow)
  try {
    const initial = filtered.setQuery({ query: 'old', tagIds: ['tag'] })
    const changed = filtered.setQuery({ query: ' New ', untagged: true })
    expect(list.mock.calls[0]?.[0]?.signal?.aborted).toBe(true)
    second.resolve({ version: 1, flows: [{ ...flow, name: 'New', referenceCount: 0 }], total: 1, nextCursor: 'new-page' })
    await changed
    first.resolve({ version: 1, flows: [{ ...flow, name: 'Old', referenceCount: 0 }], total: 99, nextCursor: 'old-page' })
    await initial
    expect(filtered.$.flows.value.map((item) => item.name)).toEqual(['New'])
    expect(filtered.$.total.value).toBe(1)
    expect(filtered.$.nextCursor.value).toBe('new-page')
    expect(workspace.flow(flow.flowId)).toEqual(flow)
    list.mockResolvedValueOnce({ version: 1, flows: [], total: 1 })
    await filtered.loadMore()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'new', untagged: true, tagIds: [], cursor: 'new-page' }))
  } finally {
    filtered.dispose()
    workspace.dispose()
  }
})
