import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { WorkspaceStore } from '../stores/workspaceStore.ts'
import { PublicationStore } from './publicationStore.ts'

const timestamp = '2026-08-31T00:00:00.000Z'
const publication = {
  actorId: 'actor',
  closureDigest: 'closure',
  createdAt: timestamp,
  engineContract: 'open-flow-engine/v6',
  flowId: 'flow-1',
  modelVersion: currentFlowModelVersion,
  operation: 'publish',
  publicationId: 'publication-1',
  sharedAccessDigest: 'implicit:test',
  revisionDigest: 'digest-1',
  revisionId: 'revision-1',
  version: 1,
} as const
const operation = {
  createdAt: timestamp,
  flowId: 'flow-1',
  operationId: 'operation-1',
  publicationId: publication.publicationId,
  revisionId: publication.revisionId,
  status: 'succeeded',
  updatedAt: timestamp,
  version: 1,
} as const

afterEach(() => vi.useRealTimers())

describe('PublicationStore', () => {
  it('reads a stored Publish operation before its Live and Publication snapshot', async () => {
    const requests: string[] = []
    const accepted = Promise.withResolvers<Response>()
    let published = false
    const request = vi.fn(async (path: string) => {
      requests.push(path)
      if (path == '/v1/flows/flow-1/publish-operations/operation-1') return await accepted.promise
      if (path == '/v1/flows/flow-1/live') {
        return Response.json(
          published
            ? { flowId: 'flow-1', hasUnpublishedChanges: false, publication, revision: 1, status: 'runnable', version: 1 }
            : { flowId: 'flow-1', hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
        )
      }
      if (path == '/v1/flows/flow-1/publications?limit=50&includeTotal=true') {
        return Response.json({ publications: published ? [publication] : [], total: published ? 1 : 0, version: 1 })
      }
      if (path == '/v1/flows/flow-1/triggers') return Response.json({ bindings: [], flowId: 'flow-1', version: 1 })
      throw new Error('Unexpected request: ' + path)
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    const preferences = new Map([['publish-operation:flow-1', 'operation-1']])
    const store = new PublicationStore(client, workspace, vi.fn(), {
      getItem: (key) => preferences.get(key) ?? null,
      setItem: (key, value) => preferences.set(key, value),
    })

    try {
      const loading = store.load('flow-1')
      await vi.waitFor(() => expect(requests).toContain('/v1/flows/flow-1/publish-operations/operation-1'))
      expect(requests).not.toContain('/v1/flows/flow-1/live')
      published = true
      accepted.resolve(Response.json(operation))
      await loading

      expect(store.$.operation.value).toEqual(operation)
      expect(store.$.live.value?.publication?.publicationId).toBe(publication.publicationId)
      expect(store.$.publications.value.map((item) => item.publicationId)).toEqual([publication.publicationId])
    } finally {
      store.dispose()
      workspace.dispose()
    }
  })

  it('stops observing a pending operation when another Flow is loaded', async () => {
    vi.useFakeTimers()
    const requests: string[] = []
    let operationReads = 0
    const request = vi.fn(async (path: string) => {
      requests.push(path)
      if (path == '/v1/flows/flow-1/publish-operations/operation-1') {
        operationReads += 1
        return Response.json(operationReads == 1 ? { ...operation, publicationId: undefined, status: 'pending' } : operation)
      }
      const match = path.match(/^\/v1\/flows\/(flow-[12])\/(live|publications|triggers)/)
      if (match == null) throw new Error('Unexpected request: ' + path)
      const [, flowId, resource] = match
      if (resource == 'live') {
        return Response.json({ flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 })
      }
      if (resource == 'publications') return Response.json({ publications: [], total: 0, version: 1 })
      return Response.json({ bindings: [], flowId, version: 1 })
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    const preferences = new Map([['publish-operation:flow-1', 'operation-1']])
    const store = new PublicationStore(client, workspace, vi.fn(), {
      getItem: (key) => preferences.get(key) ?? null,
      setItem: (key, value) => preferences.set(key, value),
    })

    try {
      await store.load('flow-1')
      await store.load('flow-2')
      await vi.advanceTimersByTimeAsync(750)

      expect(operationReads).toBe(1)
      expect(requests.at(-1)).not.toContain('/flow-1/')
      expect(store.$.live.value?.flowId).toBe('flow-2')
    } finally {
      store.dispose()
      workspace.dispose()
    }
  })

  it('keeps loaded Publications visible while refreshing the same Flow', async () => {
    const refreshed = Promise.withResolvers<Response>()
    let liveReads = 0
    const nextPublication = { ...publication, publicationId: 'publication-2' }
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/live') {
        liveReads += 1
        if (liveReads == 1) {
          return Response.json({ flowId: 'flow-1', hasUnpublishedChanges: false, publication, revision: 1, status: 'runnable', version: 1 })
        }
        return await refreshed.promise
      }
      if (path == '/v1/flows/flow-1/publications?limit=50&includeTotal=true') {
        return Response.json({ publications: liveReads == 1 ? [publication] : [nextPublication, publication], total: liveReads, version: 1 })
      }
      if (path == '/v1/flows/flow-1/triggers') return Response.json({ bindings: [], flowId: 'flow-1', version: 1 })
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    const store = new PublicationStore(client, workspace, vi.fn(), { getItem: () => null, setItem: vi.fn() })

    try {
      await store.load('flow-1')

      const refreshing = store.load('flow-1')
      expect(store.$.loading.value).toBe(false)
      expect(store.$.refreshing.value).toBe(true)
      expect(store.$.publications.value).toEqual([publication])
      expect(store.$.live.value?.publication?.publicationId).toBe(publication.publicationId)

      refreshed.resolve(
        Response.json({ flowId: 'flow-1', hasUnpublishedChanges: false, publication: nextPublication, revision: 2, status: 'runnable', version: 1 }),
      )
      await refreshing

      expect(store.$.refreshing.value).toBe(false)
      expect(store.$.publications.value.map((item) => item.publicationId)).toEqual(['publication-2', 'publication-1'])
      expect(store.$.live.value?.publication?.publicationId).toBe(nextPublication.publicationId)
    } finally {
      store.dispose()
      workspace.dispose()
    }
  })

  it('does not let an older operation refresh replace a newer load', async () => {
    const oldRefresh = Promise.withResolvers<Response>()
    const oldPublication = { ...publication, publicationId: 'publication-old', revisionId: 'revision-old' }
    const nextPublication = { ...publication, publicationId: 'publication-next', revisionId: 'revision-next' }
    let liveReads = 0
    let publicationReads = 0
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/live') {
        liveReads += 1
        if (liveReads == 2) return await oldRefresh.promise
        const current = liveReads == 1 ? publication : nextPublication
        return Response.json({ flowId: 'flow-1', hasUnpublishedChanges: false, publication: current, revision: liveReads, status: 'runnable', version: 1 })
      }
      if (path == '/v1/flows/flow-1/publications?limit=50&includeTotal=true') {
        publicationReads += 1
        const publications = publicationReads == 1 ? [publication] : publicationReads == 2 ? [oldPublication] : [nextPublication]
        return Response.json({ publications, total: 1, version: 1 })
      }
      if (path == '/v1/flows/flow-1/triggers') return Response.json({ bindings: [], flowId: 'flow-1', version: 1 })
      if (path == `/v1/flows/flow-1/publications/${oldPublication.publicationId}/rollback`) return Response.json(oldPublication)
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    vi.spyOn(workspace, 'refreshFlows').mockResolvedValue()
    const updateLive = vi.spyOn(workspace, 'updateLive')
    const store = new PublicationStore(client, workspace, vi.fn(), { getItem: () => null, setItem: vi.fn() })

    try {
      await store.load('flow-1')

      const rollback = store.rollback(oldPublication)
      await vi.waitFor(() => expect(liveReads).toBe(2))
      await store.load('flow-1')

      expect(store.$.live.value?.publication?.publicationId).toBe(nextPublication.publicationId)
      expect(store.$.publications.value).toEqual([nextPublication])

      oldRefresh.resolve(
        Response.json({ flowId: 'flow-1', hasUnpublishedChanges: false, publication: oldPublication, revision: 2, status: 'runnable', version: 1 }),
      )
      await rollback

      expect(store.$.live.value?.publication?.publicationId).toBe(nextPublication.publicationId)
      expect(store.$.publications.value).toEqual([nextPublication])
      expect(updateLive).toHaveBeenLastCalledWith(expect.objectContaining({ publication: nextPublication }))
    } finally {
      store.dispose()
      workspace.dispose()
    }
  })

  it('clears refreshing when an operation refresh replaces a warm load and fails', async () => {
    const warmLive = Promise.withResolvers<Response>()
    const oldPublication = { ...publication, publicationId: 'publication-old', revisionId: 'revision-old' }
    let liveReads = 0
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows/flow-1/live') {
        liveReads += 1
        if (liveReads == 2) return await warmLive.promise
        if (liveReads == 3) throw new Error('Refresh failed')
        return Response.json({ flowId: 'flow-1', hasUnpublishedChanges: false, publication, revision: 1, status: 'runnable', version: 1 })
      }
      if (path == '/v1/flows/flow-1/publications?limit=50&includeTotal=true') {
        return Response.json({ publications: [publication], total: 1, version: 1 })
      }
      if (path == '/v1/flows/flow-1/triggers') return Response.json({ bindings: [], flowId: 'flow-1', version: 1 })
      if (path == `/v1/flows/flow-1/publications/${oldPublication.publicationId}/rollback`) return Response.json(oldPublication)
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    const store = new PublicationStore(client, workspace, vi.fn(), { getItem: () => null, setItem: vi.fn() })

    try {
      await store.load('flow-1')

      const loading = store.load('flow-1')
      await vi.waitFor(() => expect(liveReads).toBe(2))
      expect(store.$.refreshing.value).toBe(true)

      expect(await store.rollback(oldPublication)).toBe(false)
      expect(store.$.refreshing.value).toBe(false)
      expect(store.$.publications.value).toEqual([publication])

      warmLive.resolve(Response.json({ flowId: 'flow-1', hasUnpublishedChanges: false, publication, revision: 1, status: 'runnable', version: 1 }))
      await loading
      expect(store.$.refreshing.value).toBe(false)
    } finally {
      store.dispose()
      workspace.dispose()
    }
  })
})

it('aborts an in-flight operation read on Flow switch and preserves it for later recovery', async () => {
  vi.useFakeTimers()
  const pending = Promise.withResolvers<Response>()
  let signal: AbortSignal | null | undefined
  let reads = 0
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    if (path.includes('/publish-operations/')) {
      reads += 1
      if (reads == 1) return Response.json({ ...operation, publicationId: undefined, status: 'pending' })
      signal = init?.signal
      return await pending.promise
    }
    const flowId = path.includes('/flow-1/') ? 'flow-1' : 'flow-2'
    if (path.endsWith('/live'))
      return Response.json({ flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 })
    if (path.includes('/publications?')) return Response.json({ publications: [], total: 0, version: 1 })
    if (path.endsWith('/triggers')) return Response.json({ bindings: [], flowId, version: 1 })
    throw new Error(path)
  })
  const client = new WorkbenchClient(request)
  const workspace = new WorkspaceStore(client, vi.fn())
  const preferences = new Map([['publish-operation:flow-1', 'operation-1']])
  const notice = vi.fn()
  const store = new PublicationStore(client, workspace, notice, {
    getItem: (key) => preferences.get(key) ?? null,
    setItem: (key, value) => preferences.set(key, value),
  })
  try {
    await store.load('flow-1')
    await vi.advanceTimersByTimeAsync(750)
    expect(signal?.aborted).toBe(false)
    await store.load('flow-2')
    expect(signal?.aborted).toBe(true)
    pending.resolve(Response.json(operation))
    await vi.advanceTimersByTimeAsync(5000)
    expect(reads).toBe(2)
    expect(store.$.live.value?.flowId).toBe('flow-2')
    expect(store.$.operation.value).toBeUndefined()
    expect(preferences.get('publish-operation:flow-1')).toBe('operation-1')
    expect(notice.mock.calls.flat().filter((value) => value != null)).toEqual([])
  } finally {
    store.dispose()
    workspace.dispose()
  }
})

function setup(request: (path: string) => Promise<Response>) {
  const client = new WorkbenchClient(request)
  const workspace = new WorkspaceStore(client, vi.fn())
  const store = new PublicationStore(client, workspace, vi.fn(), { getItem: () => null, setItem: vi.fn() })
  return {
    store,
    dispose: () => {
      store.dispose()
      workspace.dispose()
    },
  }
}

describe('Webhook deployment reads', () => {
  const binding = {
    flowId: 'flow-1',
    triggerNodeId: 'webhook',
    kind: 'webhook',
    currentPublicationId: 'publication-1',
    endpointUrl: 'https://example.com/webhooks/live',
    health: 'healthy',
    runtimeVersion: 1,
    updatedAt: timestamp,
    version: 1,
  } as const

  it('loads the endpoint without publication history and distinguishes failure from an unpublished node', async () => {
    const response = Promise.withResolvers<Response>()
    const request = vi
      .fn()
      .mockImplementationOnce(() => response.promise)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ bindings: [], flowId: 'flow-1', version: 1 }))
    const { store, dispose } = setup(request)
    try {
      const loading = store.loadBindings('flow-1')
      expect(store.$.bindings.value.status).toBe('loading')
      response.resolve(Response.json({ bindings: [binding], flowId: 'flow-1', version: 1 }))
      await loading
      expect(request.mock.calls.map(([path]) => path)).toEqual(['/v1/flows/flow-1/triggers'])
      expect(store.$.bindings.value.bindings).toEqual([binding])
      expect(store.$.bindings.value.status).toBe('loaded')
      await store.loadBindings('flow-1')
      expect(store.$.bindings.value.status).toBe('failed')
      expect(store.$.bindings.value.bindings).toEqual([binding])
      await store.loadBindings('flow-1')
      expect(store.$.bindings.value.status).toBe('loaded')
      expect(store.$.bindings.value.bindings).toEqual([])
    } finally {
      dispose()
    }
  })

  it('does not restore an old endpoint after switching flows or resetting', async () => {
    const stale = Promise.withResolvers<Response>()
    const next = { ...binding, flowId: 'flow-2', endpointUrl: 'https://example.com/webhooks/next' }
    const request = vi
      .fn()
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce(Response.json({ bindings: [next], flowId: 'flow-2', version: 1 }))
    const { store, dispose } = setup(request)
    try {
      const loading = store.loadBindings('flow-1')
      await store.loadBindings('flow-2')
      stale.resolve(Response.json({ bindings: [binding], flowId: 'flow-1', version: 1 }))
      await loading
      expect(store.$.bindings.value.bindings).toEqual([next])
      const pending = Promise.withResolvers<Response>()
      request.mockImplementationOnce(() => pending.promise)
      const resetting = store.loadBindings('flow-2')
      store.reset()
      pending.resolve(Response.json({ bindings: [next], flowId: 'flow-2', version: 1 }))
      await resetting
      expect(store.$.bindings.value.status).toBe('idle')
      expect(store.$.bindings.value.bindings).toEqual([])
    } finally {
      dispose()
    }
  })

  it('keeps publication history and pagination scoped when the inspector reads another flow', async () => {
    const requests: string[] = []
    const { store, dispose } = setup(async (path) => {
      requests.push(path)
      if (path.endsWith('/live'))
        return Response.json({ flowId: 'flow-1', hasUnpublishedChanges: false, publication, revision: 1, status: 'runnable', version: 1 })
      if (path.includes('/publications?')) return Response.json({ publications: [publication], nextCursor: 'next', total: 2, version: 1 })
      if (path === '/v1/flows/flow-1/triggers') return Response.json({ bindings: [binding], flowId: 'flow-1', version: 1 })
      if (path === '/v1/flows/flow-2/triggers') return Response.json({ bindings: [], flowId: 'flow-2', version: 1 })
      throw new Error('Unexpected request: ' + path)
    })
    try {
      await store.load('flow-1')
      await store.loadBindings('flow-2')
      expect(store.$.bindings.value).toEqual({ flowId: 'flow-2', status: 'loaded', bindings: [] })
      expect(store.$.publications.value).toEqual([publication])
      await store.loadMore()
      expect(requests.at(-1)).toMatch(/^\/v1\/flows\/flow-1\/publications\?.*cursor=next/)
    } finally {
      dispose()
    }
  })

  it('lets a publication refresh replace an older inspector read', async () => {
    const stale = Promise.withResolvers<Response>()
    let triggerReads = 0
    const next = { ...binding, currentPublicationId: 'publication-2' }
    const { store, dispose } = setup(async (path) => {
      if (path.endsWith('/triggers')) {
        if (++triggerReads == 1) return stale.promise
        return Response.json({ bindings: [next], flowId: 'flow-1', version: 1 })
      }
      if (path.endsWith('/live'))
        return Response.json({ flowId: 'flow-1', hasUnpublishedChanges: false, publication, revision: 1, status: 'runnable', version: 1 })
      if (path.includes('/publications?')) return Response.json({ publications: [publication], total: 1, version: 1 })
      throw new Error('Unexpected request: ' + path)
    })
    try {
      const loading = store.loadBindings('flow-1')
      await store.load('flow-1')
      stale.resolve(Response.json({ bindings: [binding], flowId: 'flow-1', version: 1 }))
      await loading
      expect(store.$.bindings.value.bindings).toEqual([next])
      expect(store.$.bindings.value.status).toBe('loaded')
    } finally {
      dispose()
    }
  })
})
