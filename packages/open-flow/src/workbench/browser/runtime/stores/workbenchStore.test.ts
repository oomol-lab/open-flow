import { val } from 'value-enhancer'
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
    let providerIcon = 'https://example.com/amap.svg'
    const actionReady = Promise.withResolvers<void>()
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
            edges: [],
            nodes: {
              connected: { inputs: {}, kind: 'task', taskId: 'connected' },
              connector: { inputs: {}, kind: 'task', taskId: 'geocode' },
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
      if (path == `/v1/flows/${flow.flowId}/editor`)
        return Response.json({
          flow,
          draft,
          live: { flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
          presentation: { revision: 1, updatedAt: timestamp, value: {}, version: 1 },
          version: 1,
        })
      if (path == `/v1/flows/${flow.flowId}/revisions/${flow.draftRevisionId}/check`) {
        return Response.json({
          closureDigest: 'closure-1',
          diagnostics: [],
          engineContract: 'open-flow-engine/v3',
          flowId: flow.flowId,
          modelVersion: 1,
          revisionDigest: draft.digest,
          revisionId: draft.revisionId,
          valid: true,
          version: 1,
        })
      }
      if (path.startsWith('/v1/connector/proxy/providers?'))
        return Response.json({ success: true, data: [{ service: 'amap', displayName: 'AMap', authTypes: ['api_key'], iconUrl: providerIcon }] })
      if (path == `/v1/connector/proxy/actions?flowId=${flow.flowId}&service=amap&locale=en`) {
        await actionReady.promise
        return Response.json({
          data: [
            {
              id: 'amap.geocode',
              authenticated: true,
              description: 'Geocode an address.',
              inputSchema: { type: 'object', properties: {} },
              name: 'Geocode',
              outputSchema: { type: 'object', properties: {} },
              service: 'amap',
              serviceName: 'AMap',
            },
          ],
          success: true,
        })
      }
      if (path.startsWith(`/v1/connector/proxy/apps?flowId=${flow.flowId}`)) {
        return Response.json({
          data: [
            {
              id: 'connection-1',
              displayName: 'Primary',
              isDefault: true,
              service: 'amap',
              status: 'active',
            },
          ],
          service: 'amap',
          success: true,
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
      store.workspace.selectNodes(['connector'])
      expect(store.connectors.$.selectedAction.value).toBeUndefined()
      expect(store.connectors.$.selectedConnection.value).toBeUndefined()
      store.workspace.selectNodes(['connected'])
      expect(store.connectors.$.selectedConnection.value).toBeUndefined()
      expect(store.workspace.$.selection.value?.id).toBe('connected')
      actionReady.resolve()
      await store.connectors.refresh()
      await vi.waitFor(() => expect(store.connectors.$.selectedConnection.value?.connectionId).toBe('connection-1'))
      store.workspace.selectNodes(['connector'])
      expect(store.connectors.$.selectedAction.value?.defaultConnection?.connectionId).toBe('connection-1')
      expect(store.connectors.$.selectedConnection.value).toBeUndefined()
      await vi.waitFor(() => expect(store.$.diagnostics.value?.valid).toBe(false))
      await vi.waitFor(() => expect(requests).toContain(`/v1/connector/proxy/apps?flowId=${flow.flowId}`))

      expect(store.workspace.$.diagnostics.value).toMatchObject({ diagnostics: [], valid: true })
      expect(store.$.diagnostics.value?.diagnostics).toEqual([
        expect.objectContaining({
          code: 'task.connector-connection-required',
          path: '/document/tasks/geocode/executor/connectionId',
          values: { taskId: 'geocode' },
        }),
      ])
      expect(store.$.diagnosticItems.value).toEqual([expect.objectContaining({ location: { nodeId: 'connector', section: 'account' }, scope: 'task' })])
      expect(store.$.designerNodeById.value.get('connector')).toMatchObject({ diagnostics: 1, executorName: 'connector · AMap', connectionRequired: true })
      expect(store.$.designerNodeById.value.get('connected')).toMatchObject({ diagnostics: 0, executorName: 'connector · AMap' })
      const icons = store.$.sourceNodeIcons.value
      expect(icons.connector).toContain(encodeURIComponent(providerIcon))
      const iconUpdates = vi.fn()
      const stop = store.$.sourceNodeIcons.reaction(iconUpdates, true)
      try {
        store.workspace.selectNodes(['connector'])
        expect(store.$.sourceNodeIcons.value).toBe(icons)
        const providerRequests = () => requests.filter((path) => path.startsWith('/v1/connector/proxy/providers?')).length
        const beforeRefresh = providerRequests()
        const providers = store.workspace.catalogs.providers.get(flow.flowId, 'en', true)
        await vi.waitFor(() => expect(providerRequests()).toBeGreaterThan(beforeRefresh))
        await vi.waitFor(() => expect(providers.value.refreshing).toBe(false))
        expect(store.$.sourceNodeIcons.value).toBe(icons)
        expect(iconUpdates).not.toHaveBeenCalled()
        providerIcon = 'https://example.com/amap-updated.svg'
        store.workspace.catalogs.providers.get(flow.flowId, 'en', true)
        await vi.waitFor(() => expect(store.$.sourceNodeIcons.value.connector).toContain(encodeURIComponent(providerIcon)))
        expect(iconUpdates).toHaveBeenCalledOnce()
      } finally {
        stop()
      }
      store.workspace.selectNodes(['connected'])
      await store.connectors.refresh()
      const graph = store.$.designer.value
      const actions = store.connectors.$.actions.value
      const catalogs = store.connectors.$.catalogs.value
      const updates = vi.fn()
      const stops = [
        store.$.designer,
        store.connectors.$.actions,
        store.connectors.$.catalogs,
        store.connectors.$.actionLoading,
        store.connectors.$.connectionLoading,
      ].map((source) => source.reaction(updates, true))
      const requestCount = requests.length
      try {
        for (let index = 0; index < 3; index++) {
          store.workspace.selectNodes([])
          await store.connectors.refresh()
          store.workspace.selectNodes(['connected'])
          await store.connectors.refresh()
        }
        expect(requests).toHaveLength(requestCount)
        expect(updates).not.toHaveBeenCalled()
        expect(store.$.designer.value).toBe(graph)
        expect(store.connectors.$.actions.value).toBe(actions)
        expect(store.connectors.$.catalogs.value).toBe(catalogs)
        await store.connectors.refresh(true)
        expect(requests.length).toBeGreaterThan(requestCount)
        expect(store.connectors.$.selectedConnection.value?.connectionId).toBe('connection-1')
        expect(store.connectors.$.connectionLoading.value).toBeUndefined()
      } finally {
        stops.forEach((dispose) => dispose())
      }
    } finally {
      store.dispose()
    }
  })
})

it('loads Variable names on demand and reuses them until invalidated', async () => {
  const response = Promise.withResolvers<Response>()
  const request = vi.fn(() => response.promise)
  const store = new WorkbenchStore(new WorkbenchClient(request), { getItem: () => null, setItem: () => {} }, () => 'identity')
  try {
    const canvas = store.$.designer.value
    const canvasUpdates = vi.fn()
    const stop = store.$.designer.reaction(canvasUpdates, true)
    store.invalidateVariableNames()
    store.invalidateVariableNames()
    expect(request).not.toHaveBeenCalled()
    const first = store.refreshVariableNames()
    const second = store.refreshVariableNames()
    expect(request).toHaveBeenCalledOnce()
    expect(store.$.variableNamesLoading.value).toBe(true)
    response.resolve(Response.json({ variables: [{ name: 'TOKEN', value: 'value', updatedAt: timestamp, version: 1 }], version: 1 }))
    await Promise.all([first, second])
    expect(store.$.variableNames.value).toEqual(['TOKEN'])
    expect(store.$.variableNamesLoading.value).toBe(false)
    await store.refreshVariableNames()
    expect(request).toHaveBeenCalledOnce()
    store.invalidateVariableNames()
    expect(request).toHaveBeenCalledOnce()
    request.mockImplementation(async () => Response.json({ variables: [], version: 1 }))
    await store.refreshVariableNames()
    expect(request).toHaveBeenCalledTimes(2)
    expect(store.$.variableNames.value).toEqual([])
    expect(store.$.designer.value).toBe(canvas)
    expect(canvasUpdates).not.toHaveBeenCalled()
    stop()
  } finally {
    store.dispose()
  }
})

it('preserves invalidation during a Variable request and retries failed requests', async () => {
  const response = Promise.withResolvers<Response>()
  const request = vi.fn(() => response.promise)
  const store = new WorkbenchStore(new WorkbenchClient(request), { getItem: () => null, setItem: () => {} }, () => 'identity')
  try {
    const loading = store.refreshVariableNames()
    store.invalidateVariableNames()
    response.resolve(Response.json({ variables: [], version: 1 }))
    await loading
    request.mockRejectedValueOnce(new Error('Offline'))
    await store.refreshVariableNames()
    expect(request).toHaveBeenCalledTimes(2)
    expect(store.$.variableNamesLoading.value).toBe(false)
    request.mockImplementation(async () => Response.json({ variables: [], version: 1 }))
    await store.refreshVariableNames()
    expect(request).toHaveBeenCalledTimes(3)
    await store.refreshVariableNames()
    expect(request).toHaveBeenCalledTimes(3)
  } finally {
    store.dispose()
  }
})

describe('WorkbenchStore node catalog', () => {
  it('reports a partial catalog failure and allows a later retry', async () => {
    const store = new WorkbenchStore(
      new WorkbenchClient(async () => {
        throw new Error('Unexpected request.')
      }),
      { getItem: () => null, setItem: () => {} },
    )
    try {
      const trigger = val({ data: [], refreshing: false, error: undefined })
      const connector = val({
        data: undefined as import('../editor/addNodeOptions.ts').AddNodeOption[] | undefined,
        refreshing: false,
        error: new Error('Catalog unavailable') as unknown,
      })
      vi.spyOn(store.triggers, 'browseAddNodeOptions').mockReturnValue(trigger)
      vi.spyOn(store.connectors, 'browseAddNodeOptions').mockReturnValue(connector)
      const controller = new AbortController()
      const source = store.browseAddNodeOptions(controller.signal)
      expect(source.value.error).toEqual(new Error('Catalog unavailable'))
      connector.set({ data: [], refreshing: false, error: undefined })
      expect(source.value.data).toEqual([])
      expect(source.value.error).toBeUndefined()
      controller.abort()
      trigger.dispose()
      connector.dispose()
    } finally {
      store.dispose()
    }
  })
})

async function notificationSession() {
  const client = new WorkbenchClient(vi.fn())
  vi.spyOn(client, 'listVariables').mockRejectedValue(new Error('Existing notification'))
  const store = new WorkbenchStore(client, { getItem: () => null, setItem: () => undefined })
  await store.refreshVariableNames()
  return { store, notice: store.$.notice.value }
}

describe('Workbench notification lifecycle', () => {
  it('preserves notices when leaving the editor is rejected', async () => {
    const { store, notice } = await notificationSession()
    vi.spyOn(store.workspace, 'selectFlow').mockResolvedValue(false)
    try {
      expect(await store.selectFlow('other')).toBe(false)
      expect(store.$.notice.value).toBe(notice)
    } finally {
      store.dispose()
    }
  })

  it('preserves notices on same-Flow refresh and clears them after changing Flow', async () => {
    const { store, notice } = await notificationSession()
    vi.spyOn(store.workspace, 'selectFlow').mockResolvedValue(true)
    try {
      await store.selectFlow(undefined)
      expect(store.$.notice.value).toBe(notice)
      await store.selectFlow('other')
      expect(store.$.notice.value).toBeUndefined()
    } finally {
      store.dispose()
    }
  })

  it('keeps new feedback produced during navigation', async () => {
    const { store, notice } = await notificationSession()
    vi.spyOn(store.workspace, 'selectFlow').mockImplementation(async () => {
      store.invalidateVariableNames()
      await store.refreshVariableNames()
      return true
    })
    try {
      await store.selectFlow('other')
      expect(store.$.notice.value).toBeDefined()
      expect(store.$.notice.value).not.toBe(notice)
      store.dismissNotice()
      expect(store.$.notice.value).toBeUndefined()
    } finally {
      store.dispose()
    }
  })
})

it('reports thrown add failures through notices without treating an empty result as failure', async () => {
  const store = new WorkbenchStore(new WorkbenchClient(vi.fn()), { getItem: () => null, setItem: () => undefined })
  const option = { kind: 'comment' as const, id: 'comment', label: 'Comment', description: '', inputs: [], outputs: [] }
  const add = vi.spyOn(store.workspace, 'addNode').mockRejectedValueOnce(new Error('Add failed')).mockResolvedValue(undefined)
  try {
    await expect(store.addNode(option, { x: 0, y: 0 })).resolves.toBeUndefined()
    expect(store.$.notice.value).toEqual({ kind: 'error', message: 'Add failed' })
    store.dismissNotice()
    await expect(store.addNode(option, { x: 0, y: 0 })).resolves.toBeUndefined()
    expect(store.$.notice.value).toBeUndefined()
    expect(add).toHaveBeenCalledTimes(2)
  } finally {
    store.dispose()
  }
})
