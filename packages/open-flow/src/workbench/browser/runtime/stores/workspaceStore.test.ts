import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { WorkspaceStore } from './workspaceStore.ts'

const timestamp = '2026-08-26T00:00:00.000Z'
const flow = {
  createdAt: timestamp,
  draftRevisionId: 'revision-1',
  flowId: 'flow-1',
  name: 'Main',
  status: 'active',
  updatedAt: timestamp,
  version: 1,
} as const
const draft = {
  actorId: 'actor-1',
  content: {
    document: {
      bindings: {},
      graph: { nodes: {} },
      subflows: {},
      tasks: {},
    },
    modelVersion: 1,
    modules: {},
  },
  createdAt: timestamp,
  digest: 'digest-1',
  flowId: flow.flowId,
  modelVersion: 1,
  parentRevisionId: null,
  revisionId: flow.draftRevisionId,
  version: 1,
} as const

describe('WorkspaceStore', () => {
  it('keeps the loaded Flow catalog visible while a notification refreshes it', async () => {
    const refreshed = Promise.withResolvers<Response>()
    const refreshRequested = Promise.withResolvers<void>()
    let catalogListener: (() => void) | undefined
    let flowLists = 0
    const request = vi.fn(async (path: string) => {
      if (path != '/v1/flows?limit=50&includeTotal=true') throw new Error(`Unexpected request: ${path}`)
      flowLists += 1
      if (flowLists == 1) return Response.json({ flows: [flow], nextCursor: 'old', total: 1, version: 1 })
      refreshRequested.resolve()
      return await refreshed.promise
    })
    const client = new WorkbenchClient(
      request,
      () => () => {},
      (listener) => {
        catalogListener = listener
        return () => {}
      },
    )
    const store = new WorkspaceStore(client, vi.fn())

    try {
      await store.start()
      catalogListener?.()
      await refreshRequested.promise

      expect(store.$.flowLoading.value).toBe(false)
      expect(store.$.flowRefreshing.value).toBe(true)
      expect(store.$.flows.value).toEqual([flow])
      await store.loadMoreFlows()
      expect(request).toHaveBeenCalledTimes(2)

      refreshed.resolve(Response.json({ flows: [], total: 0, version: 1 }))
      await vi.waitFor(() => expect(store.$.flows.value).toEqual([]))
      expect(store.$.flowRefreshing.value).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('discards an in-flight Flow catalog page when a notification refreshes it', async () => {
    const page = Promise.withResolvers<Response>()
    const pageRequested = Promise.withResolvers<void>()
    let catalogListener: (() => void) | undefined
    const refreshedFlow = { ...flow, name: 'Refreshed' }
    const staleFlow = { ...flow, flowId: 'stale', name: 'Stale' }
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows?limit=50&includeTotal=true') {
        const refreshing = request.mock.calls.length > 1
        return Response.json(refreshing ? { flows: [refreshedFlow], total: 1, version: 1 } : { flows: [flow], nextCursor: 'old', total: 2, version: 1 })
      }
      if (path == '/v1/flows?cursor=old&limit=50') {
        pageRequested.resolve()
        return await page.promise
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(
      request,
      () => () => {},
      (listener) => {
        catalogListener = listener
        return () => {}
      },
    )
    const store = new WorkspaceStore(client, vi.fn())

    try {
      await store.start()
      const loadingMore = store.loadMoreFlows()
      await pageRequested.promise
      catalogListener?.()
      await vi.waitFor(() => expect(store.$.flows.value).toEqual([refreshedFlow]))

      page.resolve(Response.json({ flows: [staleFlow], total: 2, version: 1 }))
      await loadingMore
      expect(store.$.flows.value).toEqual([refreshedFlow])
      expect(store.$.flowLoadingMore.value).toBe(false)
    } finally {
      store.dispose()
    }
  })

  it('creates and connects a code task with the source port schema in one Draft change', async () => {
    const sourceDraft = {
      ...draft,
      content: {
        ...draft.content,
        document: {
          ...draft.content.document,
          graph: {
            nodes: {
              source: {
                concurrency: 1,
                inputs: {},
                kind: 'value',
                values: [{ description: 'Count', handle: 'count', jsonSchema: { type: 'number' }, nullable: false, value: 1 }],
              },
            },
          },
        },
      },
    } as const
    let changeBody: { readonly operations: readonly unknown[] } | undefined
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path == '/v1/flows?limit=50&includeTotal=true') return Response.json({ flows: [flow], total: 1, version: 1 })
      if (path == `/v1/flows/${flow.flowId}/draft`) return Response.json(sourceDraft)
      if (path == `/v1/flows/${flow.flowId}/live`) {
        return Response.json({ flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 })
      }
      if (path == `/v1/flows/${flow.flowId}/presentation`) {
        if (init?.method == 'PUT') return Response.json({ revision: 2, updatedAt: timestamp, value: {}, version: 1 })
        return Response.json({ revision: 1, updatedAt: timestamp, value: {}, version: 1 })
      }
      if (path == `/v1/flows/${flow.flowId}/draft/changes`) {
        changeBody = JSON.parse(String(init?.body)) as { readonly operations: readonly unknown[] }
        return Response.json({
          revision: {
            actorId: 'actor-1',
            createdAt: timestamp,
            digest: 'digest-2',
            flowId: flow.flowId,
            modelVersion: 1,
            parentRevisionId: sourceDraft.revisionId,
            revisionId: 'revision-2',
            version: 1,
          },
          version: 1,
        })
      }
      if (path.endsWith('/check')) {
        return Response.json({
          closureDigest: 'closure-1',
          diagnostics: [],
          engineContract: 'open-flow-engine/v1',
          flowId: flow.flowId,
          modelVersion: 1,
          revisionDigest: path.includes('revision-2') ? 'digest-2' : sourceDraft.digest,
          revisionId: path.includes('revision-2') ? 'revision-2' : sourceDraft.revisionId,
          valid: true,
          version: 1,
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new WorkspaceStore(new WorkbenchClient(request), vi.fn(), () => 'code')

    try {
      await store.start(flow.flowId)
      const option = store.$.addNodeOptions.value.find((candidate) => candidate.kind == 'new-task')
      if (option == null) throw new Error('Expected Code Task option.')

      const nodeId = await store.addNode(option, { x: 100, y: 100 }, (createdNodeId) => ({
        source: 'source',
        sourceHandle: 'count',
        target: createdNodeId,
        targetHandle: 'value',
      }))

      expect(nodeId).toBe('code')
      expect(changeBody?.operations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'module.create', moduleId: 'code' }),
          expect.objectContaining({
            kind: 'graph.node.create',
            node: expect.objectContaining({
              task: expect.objectContaining({
                inputs: [{ description: 'Count', handle: 'value', jsonSchema: { type: 'number' }, nullable: false, value: null }],
              }),
            }),
            nodeId: 'code',
          }),
          expect.objectContaining({
            edge: { source: 'source', sourceHandle: 'count', target: 'code', targetHandle: 'value' },
            kind: 'graph.edge.connect',
          }),
        ]),
      )
    } finally {
      store.dispose()
    }
  })

  it('enables publishing after adding a node to a published Flow', async () => {
    const publication = {
      actorId: 'actor-1',
      closureDigest: 'closure-1',
      createdAt: timestamp,
      engineContract: 'open-flow-engine/v1',
      flowId: flow.flowId,
      modelVersion: 1,
      operation: 'publish',
      publicationId: 'publication-1',
      revisionDigest: draft.digest,
      revisionId: draft.revisionId,
      version: 1,
    } as const
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path == '/v1/flows?limit=50&includeTotal=true') return Response.json({ flows: [flow], total: 1, version: 1 })
      if (path == `/v1/flows/${flow.flowId}/draft`) return Response.json(draft)
      if (path == `/v1/flows/${flow.flowId}/live`) {
        return Response.json({
          flowId: flow.flowId,
          hasUnpublishedChanges: false,
          publication,
          revision: 1,
          status: 'runnable',
          version: 1,
        })
      }
      if (path == `/v1/flows/${flow.flowId}/presentation`) {
        if (init?.method == 'PUT') return Response.json({ revision: 2, updatedAt: timestamp, value: {}, version: 1 })
        return Response.json({ revision: 1, updatedAt: timestamp, value: {}, version: 1 })
      }
      if (path == `/v1/flows/${flow.flowId}/draft/changes`) {
        return Response.json({
          revision: {
            actorId: 'actor-1',
            createdAt: timestamp,
            digest: 'digest-2',
            flowId: flow.flowId,
            modelVersion: 1,
            parentRevisionId: draft.revisionId,
            revisionId: 'revision-2',
            version: 1,
          },
          version: 1,
        })
      }
      const check = /^\/v1\/flows\/flow-1\/revisions\/(revision-[12])\/check$/.exec(path)
      if (check != null) {
        return Response.json({
          closureDigest: check[1] == 'revision-1' ? publication.closureDigest : 'closure-2',
          diagnostics: [],
          engineContract: publication.engineContract,
          flowId: flow.flowId,
          modelVersion: 1,
          revisionDigest: check[1] == 'revision-1' ? draft.digest : 'digest-2',
          revisionId: check[1],
          valid: true,
          version: 1,
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new WorkspaceStore(new WorkbenchClient(request), vi.fn(), () => 'node-1')

    try {
      await store.start(flow.flowId)
      expect(store.$.live.value?.hasUnpublishedChanges).toBe(false)
      const option = store.$.addNodeOptions.value.find((candidate) => candidate.kind == 'value')
      if (option == null) throw new Error('Expected Value node option.')

      await store.addNode(option, { x: 100, y: 100 })

      await vi.waitFor(() => expect(store.$.live.value?.hasUnpublishedChanges).toBe(true))
      expect(request).toHaveBeenCalledWith(`/v1/flows/${flow.flowId}/draft/changes`, expect.objectContaining({ method: 'POST' }))
    } finally {
      store.dispose()
    }
  })

  it('loads a host-created Flow by ID before adding it to the catalog', async () => {
    const request = vi.fn(async (path: string) => {
      if (path == `/v1/flows/${flow.flowId}`) return Response.json(flow)
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new WorkspaceStore(new WorkbenchClient(request), vi.fn())
    const create = vi.fn(async () => flow.flowId)

    try {
      await expect(store.createFlow(flow.name, create)).resolves.toEqual(flow)
      expect(create).toHaveBeenCalledWith(flow.name)
      expect(request).toHaveBeenCalledOnce()
      expect(request.mock.calls[0]?.[0]).toBe(`/v1/flows/${flow.flowId}`)
      expect(store.$.flows.value).toEqual([flow])
    } finally {
      store.dispose()
    }
  })

  it('increments the loaded catalog total once for a host-created Flow', async () => {
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows?limit=50&includeTotal=true') return Response.json({ flows: [], total: 0, version: 1 })
      if (path == `/v1/flows/${flow.flowId}`) return Response.json(flow)
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new WorkspaceStore(new WorkbenchClient(request), vi.fn())
    const create = vi.fn(async () => flow.flowId)

    try {
      await store.start()
      await store.createFlow(flow.name, create)
      await store.createFlow(flow.name, create)

      expect(store.$.flows.value).toEqual([flow])
      expect(store.$.flowTotal.value).toBe(1)
    } finally {
      store.dispose()
    }
  })

  it('finishes loading the selected Flow while the catalog reloads', async () => {
    const draftResponse = Promise.withResolvers<Response>()
    const draftRequested = Promise.withResolvers<void>()
    const catalogReloaded = Promise.withResolvers<void>()
    let catalogListener: (() => void) | undefined
    let flowLists = 0
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows?limit=50&includeTotal=true') {
        flowLists += 1
        if (flowLists == 2) catalogReloaded.resolve()
        return Response.json({ flows: [flow], total: 1, version: 1 })
      }
      if (path == `/v1/flows/${flow.flowId}/draft`) {
        draftRequested.resolve()
        return await draftResponse.promise
      }
      if (path == `/v1/flows/${flow.flowId}/live`) {
        return Response.json({ flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 })
      }
      if (path == `/v1/flows/${flow.flowId}/presentation`) {
        return Response.json({ revision: 1, updatedAt: timestamp, value: {}, version: 1 })
      }
      if (path == `/v1/flows/${flow.flowId}/revisions/${flow.draftRevisionId}/check`) {
        return Response.json({
          closureDigest: 'closure-1',
          diagnostics: [],
          engineContract: 'open-flow-engine/v1',
          flowId: flow.flowId,
          modelVersion: 1,
          revisionDigest: draft.digest,
          revisionId: draft.revisionId,
          valid: true,
          version: 1,
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(
      request,
      () => () => {},
      (listener) => {
        catalogListener = listener
        return () => {}
      },
    )
    const store = new WorkspaceStore(client, vi.fn())

    try {
      const started = store.start(flow.flowId)
      await draftRequested.promise
      catalogListener?.()
      await catalogReloaded.promise
      draftResponse.resolve(Response.json(draft))
      await started

      expect(flowLists).toBe(2)
      expect(store.$.draft.value).toEqual(draft)
      expect(store.$.workspaceLoading.value).toBe(false)
      expect(store.$.status.value).toBe('saved')
    } finally {
      store.dispose()
    }
  })
})
