import type { FlowCatalogEvent } from '../contract.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { NavigationStore } from '../navigation.ts'
import { resourceValue } from './resource.ts'
import { WorkbenchStore } from './workbenchStore.ts'

const timestamp = '2026-09-01T00:00:00.000Z'

function catalogSession(initialFlowId?: string) {
  let emit: ((event?: FlowCatalogEvent) => void) | undefined
  const client = new WorkbenchClient(vi.fn(), undefined, (listener) => {
    emit = listener
    return { ready: Promise.resolve(), stop: vi.fn() }
  })
  const list = vi.spyOn(client, 'listFlows').mockResolvedValue({ flows: [], version: 1 })
  vi.spyOn(client, 'getEditor').mockImplementation(async (flowId) => ({
    flow: { flowId, name: flowId, createdAt: timestamp, updatedAt: timestamp, draftRevisionId: 'revision', status: 'active', version: 1 },
    draft: {
      flowId,
      revisionId: 'revision',
      actorId: 'actor',
      createdAt: timestamp,
      digest: 'digest',
      modelVersion: currentFlowModelVersion,
      parentRevisionId: null,
      version: 1,
      content: { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, tasks: {}, subflows: {}, graph: { nodes: {}, edges: [] } } },
    },
    live: { flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
    presentation: { revision: 1, updatedAt: timestamp, value: {}, version: 1 },
    version: 1,
  }))
  const store = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} })
  const navigate = vi.fn()
  const navigation = new NavigationStore(store, { flowId: initialFlowId, view: 'design' }, navigate)
  return { client, store, navigation, navigate, list, emit: (event?: FlowCatalogEvent) => emit!(event) }
}

function access(flowId: string) {
  return {
    version: 1 as const,
    mode: 'selectable' as const,
    accessRevision: flowId == 'first' ? 1 : 2,
    bindings: [],
    providerAccessDigest: flowId,
  }
}

describe('Flow creation notifications', () => {
  it('refreshes scoped accounts after saving and removing access without a server notification', async () => {
    const { client, store, navigation } = catalogSession('first')
    let connected = false
    vi.spyOn(client, 'getConnectorAccess').mockResolvedValue(access('first'))
    vi.spyOn(client, 'addProviderAccessBinding').mockImplementation(async () => {
      connected = true
      return { ...access('first'), accessRevision: 2 }
    })
    vi.spyOn(client, 'removeProviderAccessBinding').mockImplementation(async () => {
      connected = false
      return { ...access('first'), accessRevision: 3 }
    })
    vi.spyOn(client, 'readProxyCatalog').mockImplementation(async () => ({
      modified: true,
      etag: null,
      data: { success: true, data: connected ? [{ id: 'mail-account', service: 'mail', displayName: 'Work', status: 'active', isDefault: true }] : [] },
    }))
    try {
      await navigation.start()
      const accounts = store.workspace.catalogs.connections.get('mail', 'first')
      expect(await resourceValue(accounts)).toEqual([])
      await store.connectorAccess.select('mail', 'binding')
      await vi.waitFor(() => expect(accounts.value.data?.map((account) => account.connectionId)).toEqual(['mail-account']))
      await store.connectorAccess.select('mail', 'binding', false)
      await vi.waitFor(() => expect(accounts.value.data).toEqual([]))
    } finally {
      navigation.dispose()
      store.dispose()
    }
  })

  it('switches access and candidate requests to the selected Flow and clears access on exit', async () => {
    const { client, store, navigation } = catalogSession('first')
    vi.spyOn(client, 'getConnectorAccess').mockImplementation(async (flowId) => access(flowId))
    const candidates = vi
      .spyOn(client, 'listProviderAccessBindingCandidates')
      .mockResolvedValue({ version: 1, mode: 'selectable', providerId: 'example', candidates: [] })
    const add = vi.spyOn(client, 'addProviderAccessBinding').mockResolvedValue(access('second'))
    try {
      await navigation.start()
      expect(store.connectorAccess.$.value.access?.providerAccessDigest).toBe('first')
      await store.connectorAccess.loadCandidates('example')
      await store.selectFlow('second')
      expect(store.connectorAccess.$.value.candidates).toEqual({})
      expect(store.connectorAccess.$.value.access?.providerAccessDigest).toBe('second')
      await store.connectorAccess.loadCandidates('example')
      expect(candidates).toHaveBeenLastCalledWith('second', 'example')
      await store.connectorAccess.select('example', 'binding')
      expect(add).toHaveBeenCalledWith('second', 'example', 'binding', 2)
      await store.selectFlow(undefined)
      expect(store.connectorAccess.$.value.access).toBeUndefined()
      expect(await store.connectorAccess.select('example', 'binding')).toBe(false)
    } finally {
      navigation.dispose()
      store.dispose()
    }
  })

  it('opens a newly created Flow from the catalog and ignores a burst once navigation starts', async () => {
    const { store, navigation, navigate, emit } = catalogSession()
    try {
      await navigation.start()
      emit({ kind: 'flow.created', flowId: 'new-flow', version: 1 })
      emit({ kind: 'flow.created', flowId: 'second-flow', version: 1 })
      await vi.waitFor(() => expect(store.workspace.$.draft.value?.flowId).toBe('new-flow'))
      expect(navigate).toHaveBeenCalledTimes(1)
      expect(navigate).toHaveBeenCalledWith({ flowId: 'new-flow', view: 'design' }, { replace: true })
      emit({ kind: 'flow.created', flowId: 'third-flow', version: 1 })
      expect(store.workspace.$.flowId.value).toBe('new-flow')
    } finally {
      navigation.dispose()
      store.dispose()
    }
  })

  it('refreshes without navigation on initial load, catalog changes and reconnection', async () => {
    const { store, navigation, navigate, list, emit } = catalogSession()
    try {
      await navigation.start()
      emit({ kind: 'flows.changed', version: 1 })
      emit()
      expect(list).toHaveBeenCalledTimes(3)
      expect(navigate).not.toHaveBeenCalled()
      expect(store.workspace.$.flowId.value).toBeUndefined()
      store.dispose()
      emit({ kind: 'flow.created', flowId: 'late-flow', version: 1 })
      expect(navigate).not.toHaveBeenCalled()
    } finally {
      navigation.dispose()
      store.dispose()
    }
  })

  it('does not replace an initial detail route with a creation received during startup', async () => {
    const { store, navigation, navigate, list, emit } = catalogSession('existing-flow')
    const loading = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['listFlows']>>>()
    list.mockReturnValueOnce(loading.promise)
    try {
      const started = navigation.start()
      await vi.waitFor(() => expect(list).toHaveBeenCalled())
      emit({ kind: 'flow.created', flowId: 'new-flow', version: 1 })
      loading.resolve({ flows: [], version: 1 })
      await started
      expect(store.workspace.$.flowId.value).toBe('existing-flow')
      expect(navigate).not.toHaveBeenCalled()
    } finally {
      loading.resolve({ flows: [], version: 1 })
      navigation.dispose()
      store.dispose()
    }
  })
})

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
        modelVersion: currentFlowModelVersion,
        modules: {},
      },
      createdAt: timestamp,
      digest: 'digest-1',
      flowId: flow.flowId,
      modelVersion: currentFlowModelVersion,
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
          engineContract: 'open-flow-engine/v5',
          flowId: flow.flowId,
          modelVersion: currentFlowModelVersion,
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
          success: true,
          data: [
            {
              id: 'amap.geocode',
              service: 'amap',
              description: 'Geocode an address.',
              name: 'Geocode',
              inputSchema: { type: 'object', properties: {} },
              outputSchema: { type: 'object', properties: {} },
            },
          ],
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

it.each(['no candidates', 'ambiguous candidates', 'candidate failure', 'binding failure'] as const)(
  'preserves editable Connector metadata after %s',
  async (scenario) => {
    const { client, navigation, store } = catalogSession('flow-1')
    const action = {
      actionId: 'mail.send',
      authenticated: true,
      description: '',
      inputs: {},
      name: 'Send',
      outputs: {},
      serviceId: 'mail',
      serviceName: 'Mail',
    }
    vi.spyOn(client, 'getConnectorAccess').mockResolvedValue(access('flow-1'))
    const candidate = {
      connectionId: 'fixture-account',
      source: { kind: 'policy' as const, ruleId: null },
      accessBindingId: 'mail-1',
      connectionDisplayName: 'Mail',
      permissionGroupName: null,
      providerId: 'mail',
    }
    const candidates = vi.spyOn(client, 'listProviderAccessBindingCandidates').mockResolvedValue({
      candidates:
        scenario == 'no candidates' ? [] : scenario == 'ambiguous candidates' ? [candidate, { ...candidate, accessBindingId: 'mail-2' }] : [candidate],
      mode: 'selectable',
      providerId: 'mail',
      version: 1,
    })
    if (scenario == 'candidate failure') candidates.mockRejectedValue(new Error('Candidate lookup failed'))
    const select = vi.spyOn(client, 'addProviderAccessBinding').mockRejectedValue(new Error('Binding save failed'))
    const add = vi.spyOn(store.workspace, 'addNode').mockResolvedValue('node')
    const resolve = vi.spyOn(store.connectors, 'resolveAction')
    try {
      await navigation.start()
      await expect(store.prepareConnectorAction(action)).resolves.toEqual({ action, connections: [] })
      expect(add).not.toHaveBeenCalled()
      expect(resolve).not.toHaveBeenCalled()
      expect(store.connectorAccess.$.value.configuration).toBeUndefined()
      expect(select).toHaveBeenCalledTimes(scenario == 'binding failure' ? 1 : 0)
      if (scenario == 'binding failure') expect(store.$.notice.value?.message).toBe('Binding save failed')
      if (scenario == 'candidate failure') expect(store.$.notice.value?.message).toBe('Candidate lookup failed')
    } finally {
      navigation.dispose()
      store.dispose()
    }
  },
)

it('adds a no-auth Action without loading account candidates or creating a binding', async () => {
  const { client, navigation, store } = catalogSession('flow-1')
  const action = {
    actionId: 'oomol_rag.list_files',
    authenticated: false,
    description: '',
    inputs: {},
    name: 'list_files',
    outputs: {},
    serviceId: 'oomol_rag',
    serviceName: 'RAG',
  }
  const candidates = vi.spyOn(client, 'listProviderAccessBindingCandidates')
  const select = vi.spyOn(client, 'addProviderAccessBinding')
  vi.spyOn(store.connectors, 'resolveAction').mockResolvedValue({ action, connections: [] })
  const add = vi.spyOn(store.workspace, 'addNode').mockResolvedValue('node')
  try {
    await navigation.start()
    await expect(
      store.addNode(
        { connector: action, description: '', id: 'connector:oomol_rag.list_files', inputs: [], kind: 'connector', label: 'list_files', outputs: [] },
        { x: 0, y: 0 },
      ),
    ).resolves.toBe('node')
    expect(add).toHaveBeenCalledOnce()
    expect(candidates).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  } finally {
    navigation.dispose()
    store.dispose()
  }
})

it('prepares default Provider access without prompting', async () => {
  const { client, navigation, store } = catalogSession('flow-1')
  const discovered = {
    actionId: 'mail.send',
    authenticated: true,
    description: 'Global catalog',
    inputs: {},
    name: 'Send',
    outputs: {},
    serviceId: 'mail',
    serviceName: 'Mail',
  }
  const connection = {
    connectionId: 'mail-default',
    displayName: 'Default account',
    isDefault: true,
    serviceId: 'mail',
    status: 'active' as const,
  }
  const resolved = { ...discovered, defaultConnection: connection, description: 'Flow catalog' }
  vi.spyOn(client, 'getConnectorAccess').mockResolvedValue({
    accessRevision: 1,
    bindings: [
      {
        connectionId: 'fixture-account',
        source: { kind: 'policy' as const, ruleId: null },
        accessBindingId: 'mail-read-access',
        connectionDisplayName: connection.displayName,
        permissionGroupName: null,
        providerId: 'mail',
        status: 'active',
      },
    ],
    mode: 'selectable',
    providerAccessDigest: 'access-1',
    version: 1,
  })
  vi.spyOn(client, 'listProviderAccessBindingCandidates').mockResolvedValue({
    candidates: [
      {
        connectionId: 'fixture-account',
        source: { kind: 'policy' as const, ruleId: null },
        accessBindingId: 'mail-read-access',
        connectionDisplayName: connection.displayName,
        isDefault: true,
        permissions: { actionIds: ['mail.read'], allActions: false, configured: false, proxy: false },
        permissionGroupName: null,
        providerId: 'mail',
      },
      {
        connectionId: 'fixture-account',
        source: { kind: 'policy' as const, ruleId: 'Senders' },
        accessBindingId: 'mail-send-access',
        connectionDisplayName: 'Sending account',
        isDefault: false,
        permissions: { actionIds: ['mail.send'], allActions: false, configured: false, proxy: false },
        permissionGroupName: 'Senders',
        providerId: 'mail',
      },
    ],
    mode: 'selectable',
    providerId: 'mail',
    version: 1,
  })
  const addAccess = vi.spyOn(client, 'addProviderAccessBinding').mockResolvedValue({
    accessRevision: 2,
    bindings: [
      {
        connectionId: 'fixture-account',
        source: { kind: 'policy' as const, ruleId: null },
        accessBindingId: 'mail-read-access',
        connectionDisplayName: connection.displayName,
        permissionGroupName: null,
        providerId: 'mail',
        status: 'active',
      },
      {
        connectionId: 'fixture-account',
        source: { kind: 'policy' as const, ruleId: 'Senders' },
        accessBindingId: 'mail-send-access',
        connectionDisplayName: 'Sending account',
        permissionGroupName: 'Senders',
        providerId: 'mail',
        status: 'active',
      },
    ],
    mode: 'selectable',
    providerAccessDigest: 'access-2',
    version: 1,
  })
  const resolve = vi.spyOn(store.connectors, 'resolveAction').mockResolvedValue({ action: resolved, connections: [connection] })
  const add = vi.spyOn(store.workspace, 'addNode').mockResolvedValue('node')
  try {
    await navigation.start()

    await expect(store.prepareConnectorAction(discovered)).resolves.toEqual({ action: resolved, connections: [connection] })
    expect(addAccess).toHaveBeenCalledWith('flow-1', 'mail', 'mail-send-access', 1)
    expect(resolve).toHaveBeenCalledWith('mail.send')
    expect(add).not.toHaveBeenCalled()
  } finally {
    navigation.dispose()
    store.dispose()
  }
})

it.each(['unchanged', 'deleted', 'account selected', 'flow switched', 'failed'] as const)(
  'adds a Connector before authorization completes and respects %s state',
  async (scenario) => {
    const { navigation, store } = catalogSession('flow-1')
    const action = {
      actionId: 'mail.send',
      authenticated: true,
      description: '',
      inputs: {},
      outputs: {},
      name: 'Send',
      serviceId: 'mail',
      serviceName: 'Mail',
    }
    const connection = { connectionId: 'mail-default', displayName: 'Work', isDefault: true, serviceId: 'mail', status: 'active' as const }
    let finish!: (value: { action: typeof action & { defaultConnection: typeof connection }; connections: (typeof connection)[] }) => void
    let fail!: (error: Error) => void
    const preparation = new Promise<{ action: typeof action & { defaultConnection: typeof connection }; connections: (typeof connection)[] }>(
      (resolve, reject) => {
        finish = resolve
        fail = reject
      },
    )
    vi.spyOn(store, 'prepareConnectorAction').mockReturnValue(preparation)
    const add = vi.spyOn(store.workspace, 'addNode').mockResolvedValue('new-node')
    const setConnection = vi.spyOn(store.workspace, 'setConnectorConnection').mockResolvedValue(true)
    const refresh = vi.spyOn(store.connectors, 'refresh').mockResolvedValue()
    try {
      await navigation.start()
      const revision = store.workspace.$.revision.value!
      vi.spyOn(revision, 'node').mockReturnValue(
        scenario == 'deleted' ? undefined : { id: 'new-node', kind: 'task', node: { kind: 'task', taskId: 'task-1', inputs: {} } },
      )
      vi.spyOn(revision, 'task').mockReturnValue({
        name: 'Send',
        inputs: [],
        outputs: [],
        executor: { kind: 'connector', action: 'mail.send', ...(scenario == 'account selected' ? { connectionId: 'chosen-by-user' } : {}) },
      })
      const option = {
        connector: { ...action, defaultConnection: connection },
        description: '',
        id: 'connector:mail.send',
        inputs: [],
        kind: 'connector' as const,
        label: 'Send',
        outputs: [],
      }
      await expect(store.addNode(option, { x: 10, y: 20 })).resolves.toBe('new-node')
      expect(add).toHaveBeenCalledWith({ ...option, connector: action }, { x: 10, y: 20 }, undefined)
      expect(setConnection).not.toHaveBeenCalled()
      if (scenario == 'flow switched') await store.selectFlow('second')
      if (scenario == 'failed') fail(new Error('Authorization unavailable'))
      else finish({ action: { ...action, defaultConnection: connection }, connections: [connection] })
      await preparation.catch(() => {})
      await Promise.resolve()
      if (scenario == 'unchanged') {
        expect(setConnection).toHaveBeenCalledWith('task-1', 'mail-default')
        expect(refresh).toHaveBeenCalled()
      } else expect(setConnection).not.toHaveBeenCalled()
      if (scenario == 'failed') expect(store.$.notice.value?.message).toBe('Authorization unavailable')
    } finally {
      navigation.dispose()
      store.dispose()
    }
  },
)

it.each(['connected', 'unconfigured', 'failed'] as const)('keeps new Connector account initialization pending until %s completes', async (outcome) => {
  const { navigation, store } = catalogSession('flow-1')
  const action = { actionId: 'mail.send', authenticated: true, description: '', inputs: {}, outputs: {}, name: 'Send', serviceId: 'mail', serviceName: 'Mail' }
  const connection = { connectionId: 'work', displayName: 'Work', isDefault: true, serviceId: 'mail', status: 'active' as const }
  const preparation = Promise.withResolvers<{ action: typeof action & { defaultConnection?: typeof connection }; connections: (typeof connection)[] }>()
  const saving = Promise.withResolvers<boolean>()
  vi.spyOn(store, 'prepareConnectorAction').mockReturnValue(preparation.promise)
  const save = vi.spyOn(store.workspace, 'setConnectorConnection').mockReturnValue(saving.promise)
  vi.spyOn(store.connectors, 'refresh').mockResolvedValue()
  try {
    await navigation.start()
    const revision = store.workspace.$.revision.value!
    const definition = { name: 'Send', inputs: [], outputs: [], executor: { kind: 'connector' as const, action: 'mail.send' } }
    const node = { id: 'new', kind: 'task' as const, node: { kind: 'task' as const, taskId: 'send', inputs: {} }, definition }
    vi.spyOn(revision, 'selection').mockImplementation((_target, id) => ({ ...node, id }))
    vi.spyOn(revision, 'node').mockReturnValue(node)
    vi.spyOn(revision, 'task').mockReturnValue(definition)
    vi.spyOn(store.workspace, 'addNode').mockImplementation(async () => {
      store.workspace.selectNodes(['new'])
      expect(store.$.connectorSetupPending.value).toBe(true)
      return 'new'
    })
    await expect(
      store.addNode({ connector: action, description: '', id: 'mail.send', inputs: [], outputs: [], kind: 'connector', label: 'Send' }, { x: 0, y: 0 }),
    ).resolves.toBe('new')
    expect(store.$.connectorSetupPending.value).toBe(true)
    store.workspace.selectNodes(['existing'])
    expect(store.$.connectorSetupPending.value).toBe(false)
    store.workspace.selectNodes(['new'])
    expect(store.$.connectorSetupPending.value).toBe(true)
    if (outcome == 'failed') preparation.reject(new Error('Authorization failed'))
    else
      preparation.resolve({
        action: outcome == 'connected' ? { ...action, defaultConnection: connection } : action,
        connections: outcome == 'connected' ? [connection] : [],
      })
    if (outcome == 'connected') {
      await vi.waitFor(() => expect(save).toHaveBeenCalledWith('send', 'work'))
      expect(store.$.connectorSetupPending.value).toBe(true)
      saving.resolve(true)
    }
    await vi.waitFor(() => expect(store.$.connectorSetupPending.value).toBe(false))
    if (outcome == 'failed') expect(store.$.notice.value?.message).toBe('Authorization failed')
  } finally {
    preparation.resolve({ action, connections: [] })
    saving.resolve(true)
    navigation.dispose()
    store.dispose()
  }
})
