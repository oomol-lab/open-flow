import type { ProviderAccessBindingCandidate, TriggerKeySnapshot } from '../api.ts'
import type { FlowCatalogEvent } from '../contract.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { NavigationStore } from '../navigation.ts'
import { canvasInteractiveModePreferenceKey } from './canvasInteractiveMode.ts'
import { resourceValue } from './resource.ts'
import { WorkbenchStore } from './workbenchStore.ts'

const timestamp = '2026-09-01T00:00:00.000Z'

describe('canvas interaction preference', () => {
  it('shares the selected mode across Workbench instances and restores it on reopening', () => {
    const saved = new Map<string, string>()
    const preferences = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
    }
    const create = () => new WorkbenchStore(new WorkbenchClient(vi.fn()), preferences)
    const first = create()
    expect(first.interactiveMode$.value).toBe('touchpad')
    expect(saved.size).toBe(0)
    first.interactiveMode$.set('mouse')
    expect(saved.get(canvasInteractiveModePreferenceKey)).toBe('mouse')
    first.dispose()

    const second = create()
    expect(second.interactiveMode$.value).toBe('mouse')
    second.interactiveMode$.set('touchpad')
    expect(saved.get(canvasInteractiveModePreferenceKey)).toBe('touchpad')
    second.dispose()
  })

  it('uses the default for invalid or unavailable preferences and remains usable', () => {
    const unavailable = {
      getItem: () => {
        throw new Error('unavailable')
      },
      setItem: () => {
        throw new Error('unavailable')
      },
    }
    const store = new WorkbenchStore(new WorkbenchClient(vi.fn()), unavailable)
    expect(store.interactiveMode$.value).toBe('touchpad')
    expect(() => store.interactiveMode$.set('mouse')).not.toThrow()
    expect(store.interactiveMode$.value).toBe('mouse')
    store.dispose()

    const invalid = new WorkbenchStore(new WorkbenchClient(vi.fn()), { getItem: () => 'unknown', setItem: () => {} })
    expect(invalid.interactiveMode$.value).toBe('touchpad')
    invalid.dispose()
  })
})

function catalogSession(initialFlowId?: string, catalogReady: Promise<void> = Promise.resolve()) {
  let emit: ((event?: FlowCatalogEvent) => void) | undefined
  const client = new WorkbenchClient(vi.fn(), undefined, (listener) => {
    emit = listener
    return { ready: catalogReady, stop: vi.fn() }
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
      content: { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, tasks: {}, graph: { nodes: {}, edges: [] } } },
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
    sharedAccessDigest: flowId,
  }
}

describe('Trigger creation permissions', () => {
  const definition: TriggerKeySnapshot = {
    configInputs: [],
    definitionVersion: 2,
    description: '',
    displayName: 'New event',
    key: 'mail.event',
    name: 'event',
    outputs: [],
    provider: 'mail',
    type: 'poll',
  }
  const permissions: NonNullable<ProviderAccessBindingCandidate['permissions']> = {
    actionIds: [],
    allActions: true,
    configured: false,
    proxy: false,
    triggerIds: [],
    allTriggers: false,
  }
  const candidate = (connectionId: string, granted: Partial<typeof permissions> = {}): ProviderAccessBindingCandidate => ({
    connectionId,
    accessBindingId: connectionId,
    connectionDisplayName: connectionId,
    isDefault: connectionId == 'default',
    permissionGroupName: null,
    providerId: 'mail',
    source: { kind: 'policy', ruleId: null },
    permissions: { ...permissions, ...granted },
  })
  function setup(candidates: readonly ProviderAccessBindingCandidate[], implicit = false) {
    const session = catalogSession('first')
    const { client, store } = session
    vi.spyOn(client, 'checkFlow').mockImplementation(async (flowId, revisionId) => ({
      closureDigest: 'closure',
      diagnostics: [],
      engineContract: 'open-flow-engine/v5',
      flowId,
      modelVersion: currentFlowModelVersion,
      revisionDigest: 'digest',
      revisionId,
      valid: true,
      version: 1,
    }))
    const editor = vi.mocked(client.getEditor)
    let sequence = 0
    vi.spyOn(client, 'changeDraft').mockImplementation(async (flowId, request) => ({
      revision: {
        ...(await editor(flowId)).draft,
        revisionId: `revision-${++sequence}`,
        parentRevisionId: request,
      },
      version: 1,
    }))
    vi.spyOn(client, 'updatePresentation').mockImplementation(async (_flowId, expectedRevision, value) => ({
      revision: expectedRevision + 1,
      updatedAt: timestamp,
      value,
      version: 1,
    }))
    vi.spyOn(client, 'getConnectorAccess').mockResolvedValue({ ...access('first'), mode: implicit ? 'implicit' : 'selectable' })
    const lookup = vi.spyOn(client, 'listProviderAccessBindingCandidates').mockResolvedValue({
      version: 1,
      results: [{ version: 1, mode: 'selectable', providerId: 'mail', candidates }],
    })
    vi.spyOn(client, 'readCatalog').mockResolvedValue({
      modified: true,
      etag: null,
      data: ['default', 'other'].map((connectionId) => ({
        connectionId,
        serviceId: 'mail',
        displayName: connectionId,
        status: 'active',
        isDefault: connectionId == 'default',
      })),
    })
    const add = () =>
      store.addNode(
        {
          id: 'trigger:mail.event',
          kind: 'trigger',
          label: 'Event',
          description: '',
          inputs: [],
          outputs: [],
          trigger: { kind: 'catalog', definition },
        },
        { x: 0, y: 0 },
      )
    const nodes = () => Object.values(store.workspace.$.draft.value!.content.document.graph.nodes)
    return { ...session, lookup, add, nodes }
  }

  it.each([
    ['the specific Trigger', [candidate('default', { triggerIds: ['mail.event'] })], 'default'],
    ['all Triggers', [candidate('default', { allTriggers: true })], 'default'],
    ['another eligible account', [candidate('default'), candidate('other', { triggerIds: ['mail.event'] })], 'other'],
    ['only Action permissions', [candidate('default')], undefined],
    ['a different Trigger', [candidate('default', { triggerIds: ['mail.other'] })], undefined],
    ['no eligible accounts', [], undefined],
  ] as const)('selects an account only when permissions allow %s', async (_name, candidates, expected) => {
    const { store, navigation, add, nodes } = setup(candidates)
    try {
      await navigation.start()
      await add()
      expect(nodes()).toEqual([expect.objectContaining({ kind: 'poll' })])
      const node = nodes()[0]
      expect('connectionId' in node ? node.connectionId : undefined).toBe(expected)
      if (expected == null) expect(store.$.notice.value).toMatchObject({ kind: 'error', message: createI18n().t('connectorAccess.noAvailablePermissions') })
    } finally {
      navigation.dispose()
      store.dispose()
    }
  })

  it('keeps node creation and its permitted connection in one undo operation', async () => {
    const { store, navigation, add, nodes, lookup } = setup([candidate('default'), candidate('other', { allTriggers: true })])
    try {
      await navigation.start()
      await add()
      expect(nodes()).toEqual([expect.objectContaining({ connectionId: 'other' })])
      await store.workspace.undo()
      expect(nodes()).toEqual([])
      await store.workspace.redo()
      expect(nodes()).toEqual([expect.objectContaining({ connectionId: 'other' })])
      expect(lookup).toHaveBeenCalledOnce()
    } finally {
      navigation.dispose()
      store.dispose()
    }
  })

  it('uses Connector token authority in implicit mode without querying candidates', async () => {
    const { store, navigation, add, nodes, lookup } = setup([], true)
    try {
      await navigation.start()
      await add()
      expect(nodes()).toEqual([expect.objectContaining({ connectionId: 'default' })])
      expect(lookup).not.toHaveBeenCalled()
    } finally {
      navigation.dispose()
      store.dispose()
    }
  })

  it('creates an unconnected node when permission lookup fails', async () => {
    const { store, navigation, add, nodes, lookup } = setup([])
    lookup.mockRejectedValue(new Error('Permission lookup unavailable'))
    try {
      await navigation.start()
      await add()
      expect(nodes()).toEqual([expect.objectContaining({ kind: 'poll' })])
      expect(nodes()[0]).not.toHaveProperty('connectionId')
      expect(store.$.notice.value).toMatchObject({ kind: 'error', message: 'Permission lookup unavailable' })
    } finally {
      navigation.dispose()
      store.dispose()
    }
  })

  it('does not create a node after leaving the Flow during permission lookup', async () => {
    const { client, store, navigation, add, nodes, lookup } = setup([])
    const pending = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['listProviderAccessBindingCandidates']>>>()
    lookup.mockReturnValue(pending.promise)
    try {
      await navigation.start()
      const added = add()
      await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce())
      await store.selectFlow('second')
      pending.resolve({ version: 1, results: [] })
      await added
      expect(nodes()).toEqual([])
      expect(client.changeDraft).not.toHaveBeenCalled()
    } finally {
      pending.resolve({ version: 1, results: [] })
      navigation.dispose()
      store.dispose()
    }
  })
})

describe('Flow creation notifications', () => {
  it('updates node connection state after granting, revoking and restoring Flow access without a server notification', async () => {
    const { client, store, navigation } = catalogSession('first')
    const editor = await client.getEditor('first')
    vi.mocked(client.getEditor).mockResolvedValue({
      ...editor,
      draft: {
        ...editor.draft,
        content: {
          ...editor.draft.content,
          document: {
            ...editor.draft.content.document,
            tasks: { send: { name: 'Send', executor: { kind: 'connector', action: 'mail.send', connectionId: 'mail-account' }, inputs: [], outputs: [] } },
            graph: { nodes: { send: { kind: 'task', taskId: 'send', inputs: {} } }, edges: [] },
          },
        },
      },
    })
    vi.spyOn(client, 'readProxyCatalog').mockImplementation(async (query) => ({
      modified: true,
      etag: null,
      data: {
        success: true,
        data: query.path.includes('/providers')
          ? [{ service: 'mail', displayName: 'Mail', authTypes: ['oauth2'] }]
          : [{ id: 'mail.send', service: 'mail', name: 'Send', description: '', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } }],
      },
    }))
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
    vi.spyOn(client, 'readCatalog').mockImplementation(async () => ({
      modified: true,
      etag: null,
      data: connected ? [{ connectionId: 'mail-account', serviceId: 'mail', displayName: 'Work', status: 'active', isDefault: true }] : [],
    }))
    try {
      await navigation.start()
      const accounts = store.workspace.catalogs.connections.get('mail', 'first')
      expect(await resourceValue(accounts)).toEqual([])
      store.workspace.selectNodes(['send'])
      await store.connectors.refresh()
      expect(store.$.designer.value.nodes[0]).toMatchObject({ id: 'send', connectionRequired: true })
      await store.connectorAccess.select('mail', 'binding')
      await vi.waitFor(() => expect(accounts.value.data?.map((account) => account.connectionId)).toEqual(['mail-account']))
      await vi.waitFor(() => expect(store.$.designer.value.nodes[0]).toMatchObject({ connectionRequired: false }))
      expect(store.connectors.$.selectedConnection.value?.connectionId).toBe('mail-account')
      await store.connectorAccess.select('mail', 'binding', false)
      await vi.waitFor(() => expect(accounts.value.data).toEqual([]))
      expect(store.$.designer.value.nodes[0]).toMatchObject({ connectionRequired: true })
      expect(store.connectors.$.selectedConnection.value).toBeUndefined()
      expect(store.connectors.$.diagnostics.value).toContainEqual(expect.objectContaining({ code: 'task.connector-connection-required' }))
      await store.connectorAccess.select('mail', 'binding')
      await vi.waitFor(() => expect(store.$.designer.value.nodes[0]).toMatchObject({ connectionRequired: false }))
      expect(store.connectors.$.selectedConnection.value?.connectionId).toBe('mail-account')
      expect(store.connectors.$.diagnostics.value).toEqual([])
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
      .mockResolvedValue({ version: 1, results: [{ version: 1, mode: 'selectable', providerId: 'example', candidates: [] }] })
    const add = vi.spyOn(client, 'addProviderAccessBinding').mockResolvedValue(access('second'))
    try {
      await navigation.start()
      expect(store.connectorAccess.$.value.access?.sharedAccessDigest).toBe('first')
      await store.connectorAccess.loadCandidates(['example'])
      await store.selectFlow('second')
      expect(store.connectorAccess.$.value.candidates).toEqual({})
      expect(store.connectorAccess.$.value.access?.sharedAccessDigest).toBe('second')
      await store.connectorAccess.loadCandidates(['example'])
      expect(candidates).toHaveBeenLastCalledWith('second', ['example'], expect.any(AbortSignal))
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

  it.each(['before', 'after'])('opens the list without waiting for a subscription that settles %s the first read', async (timing) => {
    const connection = Promise.withResolvers<void>()
    const initial = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['listFlows']>>>()
    const refreshed = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['listFlows']>>>()
    const { store, navigation, navigate, list } = catalogSession(undefined, connection.promise)
    const flow = {
      flowId: 'existing',
      name: 'Initial',
      createdAt: timestamp,
      updatedAt: timestamp,
      draftRevisionId: 'revision',
      status: 'active',
      version: 1,
    } as const
    list.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refreshed.promise)
    try {
      const started = navigation.start()
      await vi.waitFor(() => expect(list).toHaveBeenCalledOnce())
      if (timing == 'before') {
        connection.resolve()
        await connection.promise
        expect(list).toHaveBeenCalledOnce()
      }
      initial.resolve({ flows: [flow], version: 1 })
      await started

      expect(navigation.$.ready.value).toBe(true)
      expect(store.workspace.$.flows.value).toEqual([flow])
      expect(store.workspace.$.flowLoading.value).toBe(false)
      if (timing == 'after') connection.resolve()
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))
      expect(store.workspace.$.flowRefreshing.value).toBe(true)
      expect(store.workspace.$.flows.value).toEqual([flow])

      const updated = { ...flow, name: 'Updated before connection' }
      refreshed.resolve({ flows: [updated], version: 1 })
      await vi.waitFor(() => expect(store.workspace.$.flows.value).toEqual([updated]))
      expect(navigate).not.toHaveBeenCalled()
      expect(store.workspace.$.flowId.value).toBeUndefined()
    } finally {
      connection.resolve()
      initial.resolve({ flows: [], version: 1 })
      refreshed.resolve({ flows: [], version: 1 })
      navigation.dispose()
      store.dispose()
    }
  })

  it('preserves the first list after a catch-up failure and refreshes it on reconnect', async () => {
    const connection = Promise.withResolvers<void>()
    const { store, navigation, navigate, list, emit } = catalogSession(undefined, connection.promise)
    const flow = {
      flowId: 'existing',
      name: 'Initial',
      createdAt: timestamp,
      updatedAt: timestamp,
      draftRevisionId: 'revision',
      status: 'active',
      version: 1,
    } as const
    list.mockResolvedValueOnce({ flows: [flow], version: 1 }).mockRejectedValueOnce(new Error('Catch-up failed'))
    try {
      await navigation.start()
      connection.resolve()
      await vi.waitFor(() => expect(store.$.notice.value?.message).toContain('Catch-up failed'))
      expect(navigation.$.ready.value).toBe(true)
      expect(store.workspace.$.flows.value).toEqual([flow])
      expect(store.workspace.$.flowLoading.value).toBe(false)
      expect(store.workspace.$.flowRefreshing.value).toBe(false)
      expect(store.workspace.$.flowLoadFailed.value).toBe(false)

      list.mockResolvedValueOnce({ flows: [], version: 1 })
      emit()
      await vi.waitFor(() => expect(store.workspace.$.flows.value).toEqual([]))
      expect(list).toHaveBeenCalledTimes(3)
      expect(navigate).not.toHaveBeenCalled()
    } finally {
      connection.resolve()
      navigation.dispose()
      store.dispose()
    }
  })

  it('preserves navigation made while the initial list request is pending', async () => {
    const connection = Promise.withResolvers<void>()
    const initial = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['listFlows']>>>()
    const { store, navigation, navigate, list } = catalogSession(undefined, connection.promise)
    list.mockReturnValueOnce(initial.promise)
    try {
      const started = navigation.start()
      await vi.waitFor(() => expect(list).toHaveBeenCalledOnce())
      await navigation.apply({ flowId: 'chosen-flow', view: 'design' })
      initial.resolve({ flows: [], version: 1 })
      await started
      connection.resolve()
      await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))

      expect(navigation.$.ready.value).toBe(true)
      expect(store.workspace.$.flowId.value).toBe('chosen-flow')
      expect(store.workspace.$.draft.value?.flowId).toBe('chosen-flow')
      expect(navigate).not.toHaveBeenCalled()
    } finally {
      connection.resolve()
      initial.resolve({ flows: [], version: 1 })
      navigation.dispose()
      store.dispose()
    }
  })

  it('shows an initial list failure without waiting for connection and recovers after it settles', async () => {
    const connection = Promise.withResolvers<void>()
    const { store, navigation, navigate, list } = catalogSession(undefined, connection.promise)
    list.mockRejectedValueOnce(new Error('Initial list failed'))
    try {
      await navigation.start()
      expect(navigation.$.ready.value).toBe(true)
      expect(store.workspace.$.flowLoadFailed.value).toBe(true)
      expect(store.workspace.$.flowLoading.value).toBe(false)

      connection.resolve()
      await vi.waitFor(() => expect(store.workspace.$.flowLoadFailed.value).toBe(false))
      expect(store.workspace.$.flowLoading.value).toBe(false)
      expect(list).toHaveBeenCalledTimes(2)
      expect(navigate).not.toHaveBeenCalled()
    } finally {
      connection.resolve()
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

it.each(['no candidates', 'ambiguous candidates', 'candidate failure'] as const)('preserves editable Connector metadata after %s', async (scenario) => {
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
    results: [
      {
        candidates:
          scenario == 'no candidates' ? [] : scenario == 'ambiguous candidates' ? [candidate, { ...candidate, accessBindingId: 'mail-2' }] : [candidate],
        mode: 'selectable',
        providerId: 'mail',
        version: 1,
      },
    ],
    version: 1,
  })
  if (scenario == 'candidate failure') candidates.mockRejectedValue(new Error('Candidate lookup failed'))
  const select = vi.spyOn(client, 'addProviderAccessBinding').mockRejectedValue(new Error('Binding save failed'))
  const add = vi.spyOn(store.workspace, 'addNode').mockResolvedValue('node')
  const resolve = vi.spyOn(store.connectors, 'resolveAction').mockResolvedValue({ action, connections: [] })
  try {
    await navigation.start()
    await expect(store.prepareConnectorAction(action)).resolves.toEqual({ action, connections: [] })
    expect(add).not.toHaveBeenCalled()
    expect(resolve).toHaveBeenCalledWith('mail.send')
    expect(store.connectorAccess.$.value.configuration).toBeUndefined()
    expect(select).not.toHaveBeenCalled()
    if (scenario == 'candidate failure') expect(store.$.notice.value?.message).toBe('Candidate lookup failed')
  } finally {
    navigation.dispose()
    store.dispose()
  }
})

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

it('selects an eligible default connection without adding shared Code usage', async () => {
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
        connectionId: 'mail-default',
        source: { kind: 'policy' as const, ruleId: null },
        accessBindingId: 'mail-read-access',
        connectionDisplayName: connection.displayName,
        permissionGroupName: null,
        providerId: 'mail',
        status: 'active',
      },
    ],
    mode: 'selectable',
    sharedAccessDigest: 'access-1',
    version: 1,
  })
  vi.spyOn(client, 'listProviderAccessBindingCandidates').mockResolvedValue({
    results: [
      {
        candidates: [
          {
            connectionId: 'mail-default',
            source: { kind: 'policy' as const, ruleId: null },
            accessBindingId: 'mail-read-access',
            connectionDisplayName: connection.displayName,
            isDefault: true,
            permissions: { actionIds: ['mail.read'], allActions: false, configured: false, proxy: false, triggerIds: [], allTriggers: false },
            permissionGroupName: null,
            providerId: 'mail',
          },
          {
            connectionId: 'mail-default',
            source: { kind: 'policy' as const, ruleId: 'Senders' },
            accessBindingId: 'mail-send-access',
            connectionDisplayName: 'Sending account',
            isDefault: false,
            permissions: { actionIds: ['mail.send'], allActions: false, configured: false, proxy: false, triggerIds: [], allTriggers: false },
            permissionGroupName: 'Senders',
            providerId: 'mail',
          },
        ],
        mode: 'selectable',
        providerId: 'mail',
        version: 1,
      },
    ],
    version: 1,
  })
  const addAccess = vi.spyOn(client, 'addProviderAccessBinding').mockResolvedValue({
    accessRevision: 2,
    bindings: [
      {
        connectionId: 'mail-default',
        source: { kind: 'policy' as const, ruleId: null },
        accessBindingId: 'mail-read-access',
        connectionDisplayName: connection.displayName,
        permissionGroupName: null,
        providerId: 'mail',
        status: 'active',
      },
      {
        connectionId: 'mail-default',
        source: { kind: 'policy' as const, ruleId: 'Senders' },
        accessBindingId: 'mail-send-access',
        connectionDisplayName: 'Sending account',
        permissionGroupName: 'Senders',
        providerId: 'mail',
        status: 'active',
      },
    ],
    mode: 'selectable',
    sharedAccessDigest: 'access-2',
    version: 1,
  })
  const resolve = vi.spyOn(store.connectors, 'resolveAction').mockResolvedValue({ action: resolved, connections: [connection] })
  const add = vi.spyOn(store.workspace, 'addNode').mockResolvedValue('node')
  try {
    await navigation.start()

    await expect(store.prepareConnectorAction(discovered)).resolves.toEqual({ action: resolved, connections: [connection] })
    expect(addAccess).not.toHaveBeenCalled()
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

it('waits for a candidate query already started by the inspector before selecting a default connection without enabling Code usage', async () => {
  const { client, navigation, store } = catalogSession('flow-1')
  const action = { actionId: 'mail.send', authenticated: true, description: '', inputs: {}, outputs: {}, name: 'Send', serviceId: 'mail', serviceName: 'Mail' }
  const connection = { connectionId: 'mail-default', displayName: 'Work', isDefault: true, serviceId: 'mail', status: 'active' as const }
  const binding = {
    accessBindingId: 'default-access',
    connectionId: connection.connectionId,
    connectionDisplayName: connection.displayName,
    providerId: 'mail',
    permissionGroupName: null,
    source: { kind: 'admin-delegation' as const },
    status: 'active' as const,
  }
  vi.spyOn(client, 'getConnectorAccess').mockResolvedValue(access('flow-1'))
  const candidates = Promise.withResolvers<Awaited<ReturnType<WorkbenchClient['listProviderAccessBindingCandidates']>>>()
  const lookup = vi.spyOn(client, 'listProviderAccessBindingCandidates').mockReturnValue(candidates.promise)
  const addAccess = vi.spyOn(client, 'addProviderAccessBinding').mockResolvedValue({ ...access('flow-1'), accessRevision: 3, bindings: [binding] })
  const resolved = { action: { ...action, defaultConnection: connection }, connections: [connection] }
  vi.spyOn(store.connectors, 'resolveAction').mockResolvedValue(resolved)
  try {
    await navigation.start()
    const loading = store.connectorAccess.loadCandidates(['mail'])
    const preparing = store.prepareConnectorAction(action)
    candidates.resolve({
      version: 1,
      results: [
        {
          providerId: 'mail',
          mode: 'selectable',
          version: 1,
          candidates: [
            {
              ...binding,
              isDefault: true,
              permissions: { actionIds: [], allActions: true, configured: false, proxy: true, triggerIds: [], allTriggers: true },
            },
          ],
        },
      ],
    })
    await loading
    expect(await preparing).toEqual(resolved)
    expect(addAccess).not.toHaveBeenCalled()
    expect(lookup).toHaveBeenCalledTimes(1)
  } finally {
    navigation.dispose()
    store.dispose()
  }
})

it('loads immutable publication content without replacing or writing the active draft', async () => {
  const { client, store, navigation } = catalogSession()
  const publication = {
    actorId: 'actor',
    createdAt: timestamp,
    flowId: 'history',
    publicationId: 'published',
    revisionId: 'fixed',
    revisionDigest: 'digest',
    closureDigest: 'closure',
    sharedAccessDigest: 'implicit',
    engineContract: 'engine',
    modelVersion: currentFlowModelVersion,
    operation: 'publish' as const,
    version: 1 as const,
  }
  const fixed = (await client.getEditor('history')).draft
  const getRevision = vi.spyOn(client, 'getRevision').mockResolvedValue({ ...fixed, revisionId: 'fixed' })
  const snapshot = { version: 1 as const, revision: 2, updatedAt: timestamp, value: { saved: true } }
  const getSnapshot = vi.spyOn(client, 'getPublicationPresentation').mockResolvedValue({ version: 1, presentation: snapshot })
  const write = vi.spyOn(client, 'updatePresentation')
  const signal = new AbortController().signal
  try {
    await store.workspace.start('current')
    const draft = store.workspace.$.draft.value
    const presentation = store.workspace.$.presentation.value
    const result = await store.publicationSnapshot(publication, signal)
    expect(result.draft.revisionId).toBe('fixed')
    expect(result.presentation).toBe(snapshot)
    expect(getRevision).toHaveBeenCalledWith('history', 'fixed', signal)
    expect(getSnapshot).toHaveBeenCalledWith('history', 'published', signal)
    expect(store.workspace.$.draft.value).toBe(draft)
    expect(store.workspace.$.presentation.value).toBe(presentation)
    expect(write).not.toHaveBeenCalled()
    getRevision.mockRejectedValueOnce(new Error('Unavailable'))
    await expect(store.publicationSnapshot(publication, signal)).rejects.toThrow('Unavailable')
    expect(store.workspace.$.draft.value).toBe(draft)
    getRevision.mockResolvedValueOnce({ ...fixed, revisionId: 'wrong' })
    await expect(store.publicationSnapshot(publication, signal)).rejects.toThrow('Publication revision mismatch')
  } finally {
    navigation.dispose()
    store.dispose()
  }
})
