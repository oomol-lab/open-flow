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
  live: { enabled: true, publicationId: 'live', revisionId: 'published' },
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
  vi.spyOn(client, 'listFlows').mockResolvedValue({ flows: [current], version: 1 })
  catalog.include(flow)
  try {
    await catalog.setEnabled(flow, false)
    expect(change).toHaveBeenCalledWith('flow', 'live', false)
    expect(catalog.flow('flow')).toEqual(current)
    expect(notice).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
  } finally {
    catalog.dispose()
  }
})

it('publishes the selected list revision and shows the authoritative disabled state', async () => {
  const client = new WorkbenchClient(vi.fn())
  const notice = vi.fn()
  const catalog = new FlowCatalog(client, notice, createI18n())
  const changed = { ...flow, live: { enabled: false, publicationId: 'new-live', revisionId: 'draft' } }
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
