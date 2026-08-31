import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { WorkspaceStore } from '../stores/workspaceStore.ts'
import { PublicationStore } from './publicationStore.ts'

const timestamp = '2026-08-31T00:00:00.000Z'
const publication = {
  actorId: 'actor',
  closureDigest: 'closure',
  createdAt: timestamp,
  engineContract: 'open-flow-engine/v1',
  flowId: 'flow-1',
  modelVersion: 1,
  operation: 'publish',
  publicationId: 'publication-1',
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
})
