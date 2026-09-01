import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { WorkbenchStore } from './workbenchStore.ts'

const timestamp = '2026-09-01T00:00:00.000Z'

describe('WorkbenchStore Variables', () => {
  it('does not request Variable names when the host disables Variables', async () => {
    const request = vi.fn(async () => {
      throw new Error('Unexpected request.')
    })
    const store = new WorkbenchStore(
      new WorkbenchClient(request),
      { getItem: () => null, setItem: () => undefined },
      () => 'identity',
      undefined,
      undefined,
      false,
    )

    try {
      await store.refreshVariableNames()

      expect(request).not.toHaveBeenCalled()
      expect(store.$.variableNamesLoading.value).toBe(false)
    } finally {
      store.dispose()
    }
  })
})

describe('WorkbenchStore diagnostics', () => {
  it('includes missing Connector connections without changing the deterministic Flow check', async () => {
    const flow = {
      createdAt: timestamp,
      draftRevisionId: 'revision-1',
      flowId: 'flow-1',
      name: 'Flow 1',
      status: 'active',
      updatedAt: timestamp,
      version: 1,
    }
    const draft = {
      actorId: 'actor-1',
      content: {
        document: {
          bindings: {},
          graph: {
            nodes: {
              connected: { concurrency: 1, inputs: {}, kind: 'task', taskId: 'connected' },
              connector: { concurrency: 1, inputs: {}, kind: 'task', taskId: 'geocode' },
            },
          },
          subflows: {},
          tasks: {
            geocode: {
              executor: { action: 'amap.geocode', kind: 'connector' },
              inputs: [],
              name: 'Geocode',
              outputs: [],
            },
            connected: {
              executor: { action: 'amap.geocode', connectionId: 'connection-1', kind: 'connector' },
              inputs: [],
              name: 'Connected',
              outputs: [],
            },
            unused: {
              executor: { action: 'amap.geocode', kind: 'connector' },
              inputs: [],
              name: 'Unused',
              outputs: [],
            },
          },
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
    }
    const requests: string[] = []
    const request = vi.fn(async (path: string) => {
      requests.push(path)
      if (path == '/v1/flows?limit=50&includeTotal=true') return Response.json({ flows: [flow], total: 1, version: 1 })
      if (path == `/v1/flows/${flow.flowId}/draft`) return Response.json(draft)
      if (path == `/v1/flows/${flow.flowId}/live`) {
        return Response.json({ flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 })
      }
      if (path == `/v1/flows/${flow.flowId}/presentation`) return Response.json({ revision: 1, updatedAt: timestamp, value: {}, version: 1 })
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
      if (path == `/v1/connector/actions/amap.geocode?flowId=${flow.flowId}`) {
        return Response.json({
          action: {
            actionId: 'amap.geocode',
            authenticated: true,
            description: 'Geocode an address.',
            inputs: {},
            name: 'Geocode',
            outputs: {},
            serviceId: 'amap',
            serviceName: 'AMap',
          },
          version: 1,
        })
      }
      if (path == `/v1/connector/connections/amap?flowId=${flow.flowId}`) {
        return Response.json({
          connections: [
            {
              connectionId: 'connection-1',
              displayName: 'Primary',
              isDefault: true,
              serviceId: 'amap',
              status: 'active',
            },
          ],
          serviceId: 'amap',
          version: 1,
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const store = new WorkbenchStore(
      new WorkbenchClient(request),
      { getItem: () => null, setItem: () => undefined },
      () => 'identity',
      undefined,
      undefined,
      false,
    )

    try {
      await store.start(flow.flowId)
      await vi.waitFor(() => expect(store.$.diagnostics.value?.valid).toBe(false))
      await vi.waitFor(() => expect(requests).toContain(`/v1/connector/connections/amap?flowId=${flow.flowId}`))

      expect(store.workspace.$.diagnostics.value).toMatchObject({ diagnostics: [], valid: true })
      expect(store.$.diagnostics.value?.diagnostics).toEqual([
        expect.objectContaining({
          code: 'task.connector-connection-required',
          path: '/document/tasks/geocode/executor/connectionId',
          values: { taskId: 'geocode' },
        }),
      ])
      expect(store.$.diagnosticItems.value).toEqual([expect.objectContaining({ location: { nodeId: 'connector', section: 'account' }, scope: 'task' })])
      expect(store.$.designerNodeById.value.get('connector')).toMatchObject({ diagnostics: 1, executorName: 'connection required' })
      expect(store.$.designerNodeById.value.get('connected')).toMatchObject({ diagnostics: 0 })
    } finally {
      store.dispose()
    }
  })
})
