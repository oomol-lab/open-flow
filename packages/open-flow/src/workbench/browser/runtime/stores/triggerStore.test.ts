import type { ConnectorConnection } from '../api.ts'

import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { providerIcon } from '../providerIcon.ts'
import { TriggerStore } from './triggerStore.ts'
import { WorkspaceStore } from './workspaceStore.ts'

const timestamp = '2026-08-31T00:00:00.000Z'
const flow = {
  createdAt: timestamp,
  draftRevisionId: 'revision-1',
  flowId: 'flow-1',
  name: 'Main',
  status: 'active',
  updatedAt: timestamp,
  version: 1,
} as const

function createSetup() {
  const requests: string[] = []
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    requests.push(path)
    if (path == '/v1/flows?limit=50&includeTotal=true') return Response.json({ flows: [flow], total: 1, version: 1 })
    if (path == `/v1/flows/${flow.flowId}/editor`) {
      return Response.json({
        flow,
        draft: {
          actorId: 'actor',
          content: {
            document: {
              bindings: Object.fromEntries(['github', 'mail', 'linear'].map((provider) => [provider, { kind: 'connection', target: `${provider}-old` }])),
              graph: {
                edges: [],
                nodes: Object.fromEntries(
                  ['github', 'mail', 'linear'].map((provider) => [
                    provider,
                    {
                      bindingId: provider,
                      config: provider == 'linear' ? { teamId: 'team-old', stateIds: ['state-old'] } : {},
                      definition: {
                        configSchema: { type: 'object' },
                        definitionVersion: 1,
                        description: '',
                        displayName: 'New event',
                        key: provider == 'linear' ? 'linear.on_issue_changed' : `${provider}.event`,
                        name: 'event',
                        payloadSchema: { type: 'object' },
                        provider,
                        type: 'poll',
                      },
                      kind: 'poll',
                      name: provider,
                      pollTimes: [],
                    },
                  ]),
                ),
              },
              subflows: {},
              tasks: {},
            },
            modelVersion: 1,
            modules: {},
          },
          createdAt: timestamp,
          digest: 'digest',
          flowId: flow.flowId,
          modelVersion: 1,
          parentRevisionId: null,
          revisionId: flow.draftRevisionId,
          version: 1,
        },
        live: { flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 },
        presentation: { revision: 1, updatedAt: timestamp, value: {}, version: 1 },
        version: 1,
      })
    }
    if (path == `/v1/flows/${flow.flowId}/draft/changes`) {
      return Response.json({
        revision: {
          actorId: 'actor',
          createdAt: timestamp,
          digest: 'next-digest',
          flowId: flow.flowId,
          modelVersion: 1,
          parentRevisionId: flow.draftRevisionId,
          revisionId: 'revision-2',
          version: 1,
        },
        version: 1,
      })
    }
    if (path == `/v1/flows/${flow.flowId}/presentation`) {
      return Response.json({ revision: 2, updatedAt: timestamp, value: JSON.parse(String(init?.body)).value, version: 1 })
    }
    if (path.endsWith('/check')) {
      return Response.json({
        closureDigest: 'closure',
        diagnostics: [],
        engineContract: 'open-flow-engine/v2',
        flowId: flow.flowId,
        modelVersion: 1,
        revisionDigest: 'digest',
        revisionId: flow.draftRevisionId,
        valid: true,
        version: 1,
      })
    }
    if (path == '/v1/trigger-keys/catalog') {
      return Response.json({
        definitions: [
          {
            configSchema: { additionalProperties: false, type: 'object' },
            definitionVersion: 1,
            description: 'Runs when a repository changes.',
            displayName: 'Repository event',
            endpoint: {
              body: { allowArray: false, allowEmpty: false, formats: ['json'] },
              methods: ['POST'],
              successStatus: 200,
            },
            key: 'github.on_repo_event',
            name: 'on_repo_event',
            payloadSchema: { additionalProperties: true, type: 'object' },
            provider: 'github',
            type: 'integration',
          },
        ],
        version: 1,
      })
    }
    throw new Error(`Unexpected request: ${path}`)
  })
  const client = new WorkbenchClient(request)
  const workspace = new WorkspaceStore(client, vi.fn())
  const triggers = new TriggerStore(client, workspace, vi.fn(), { openExternalPage: async () => true })
  const signal = new AbortController().signal
  return { client, workspace, triggers, requests, request, signal }
}

describe('TriggerStore', () => {
  it('loads catalog definitions without requesting Connections and creates an unconnected option', async () => {
    const { workspace, triggers, requests, signal } = createSetup()

    try {
      await workspace.start(flow.flowId)
      const options = await triggers.browseAddNodeOptions(signal)
      const searched = await triggers.provideAddNodeOptions('repository', signal)

      expect(options).toHaveLength(1)
      expect(options?.[0]).toMatchObject({
        group: 'App triggers',
        icon: providerIcon({ serviceId: 'github', serviceName: 'github' }),
        id: 'trigger:github.on_repo_event',
        outputs: [{ handle: 'payload' }],
        trigger: { kind: 'catalog' },
      })
      expect(options?.[0]).not.toHaveProperty('choices')
      expect(options?.[0]).not.toHaveProperty('trigger.connectionId')
      expect(searched?.map((option) => option.id)).toEqual(['trigger:github.on_repo_event'])
      expect(requests.filter((path) => path == '/v1/trigger-keys/catalog')).toHaveLength(1)
      expect(requests.some((path) => path.startsWith('/v1/connector/connections/'))).toBe(false)
    } finally {
      triggers.dispose()
      workspace.dispose()
    }
  })

  it.each(['default', 'only', 'ambiguous', 'inactive', 'empty', 'explicit', 'failure'] as const)(
    'saves a new Trigger with the appropriate connection: %s',
    async (scenario) => {
      const { client, workspace, triggers, signal } = createSetup()
      const account: ConnectorConnection = { connectionId: 'preferred', displayName: 'Work', isDefault: true, serviceId: 'github', status: 'active' }
      const other = { ...account, connectionId: 'other', isDefault: false }
      const connections =
        scenario == 'empty'
          ? []
          : scenario == 'only'
            ? [other]
            : scenario == 'ambiguous'
              ? [other, { ...account, isDefault: false }]
              : scenario == 'inactive'
                ? [{ ...account, status: 'reauth_required' as const }]
                : [other, account]
      const list = vi.spyOn(client, 'listConnectorConnections').mockResolvedValue(connections)
      if (scenario == 'failure') list.mockRejectedValue(new Error('Connection lookup failed'))
      try {
        await workspace.start(flow.flowId)
        const option = (await triggers.browseAddNodeOptions(signal))![0]!
        if (option.kind != 'trigger' || !('trigger' in option) || option.trigger.kind != 'catalog') throw new Error('Expected provider Trigger.')
        const nodeId = await workspace.addNode(scenario == 'explicit' ? { ...option, trigger: { ...option.trigger, connectionId: 'chosen' } } : option, {
          x: 0,
          y: 0,
        })
        expect(nodeId).toBeDefined()
        const node = workspace.$.draft.value!.content.document.graph.nodes[nodeId!]!
        if (node.kind != 'integration') throw new Error('Expected Integration Trigger.')
        const expected = scenario == 'default' ? 'preferred' : scenario == 'only' ? 'other' : scenario == 'explicit' ? 'chosen' : ''
        expect(workspace.$.draft.value!.content.document.bindings[node.bindingId]).toEqual(
          expected == '' ? undefined : { kind: 'connection', target: expected },
        )
        if (scenario == 'explicit') expect(list).not.toHaveBeenCalled()
        else expect(list).toHaveBeenCalledWith('github', undefined, flow.flowId)
      } finally {
        triggers.dispose()
        workspace.dispose()
      }
    },
  )

  it('does not create a Trigger after leaving the Flow during connection lookup', async () => {
    const { client, workspace, triggers, signal, requests } = createSetup()
    const pending = Promise.withResolvers<readonly ConnectorConnection[]>()
    const list = vi.spyOn(client, 'listConnectorConnections').mockReturnValue(pending.promise)
    try {
      await workspace.start(flow.flowId)
      const option = (await triggers.browseAddNodeOptions(signal))![0]!
      const adding = workspace.addNode(option, { x: 0, y: 0 })
      await vi.waitFor(() => expect(list).toHaveBeenCalled())
      await workspace.selectFlow(undefined)
      pending.resolve([])
      expect(await adding).toBeUndefined()
      expect(requests.some((path) => path.endsWith('/draft/changes'))).toBe(false)
    } finally {
      triggers.dispose()
      workspace.dispose()
    }
  })

  it('loads Linear options only after pending configuration is saved', async () => {
    const { client, workspace, triggers } = createSetup()
    const pending = Promise.withResolvers<void>()
    const original = client.changeDraft.bind(client)
    vi.spyOn(client, 'changeDraft').mockImplementation(async (...args) => {
      await pending.promise
      return await original(...args)
    })
    const options = vi.spyOn(client, 'listTriggerConfigOptions').mockResolvedValue([{ value: 'state-new', label: 'Ready' }])
    try {
      await workspace.start(flow.flowId)
      const saving = workspace.saveTriggerConfig('linear', 'teamId', 'team-new')
      const loading = workspace.loadTriggerConfigOptions('linear', 'stateIds', new AbortController().signal)
      await Promise.resolve()
      expect(options).not.toHaveBeenCalled()
      pending.resolve()
      expect(await saving).toBe(true)
      expect(await loading).toEqual([{ value: 'state-new', label: 'Ready' }])
      expect(options).toHaveBeenCalledOnce()
    } finally {
      pending.resolve()
      triggers.dispose()
      workspace.dispose()
    }
  })

  it.each(['team', 'connection'] as const)('clears dependent Linear selections in the same save when changing %s', async (change) => {
    const { workspace, triggers, request } = createSetup()
    try {
      await workspace.start(flow.flowId)
      if (change == 'team') await workspace.saveTriggerConfig('linear', 'teamId', 'team-new')
      else await workspace.setTriggerConnection('linear', 'connection-new')
      const node = workspace.$.draft.value!.content.document.graph.nodes.linear!
      if (node.kind != 'poll') throw new Error('Expected Poll.')
      expect(node.config).toEqual(change == 'team' ? { teamId: 'team-new' } : {})
      const saves = request.mock.calls.filter(([path]) => path.endsWith('/draft/changes'))
      expect(saves).toHaveLength(1)
      const body = JSON.parse(String(saves[0]![1]?.body))
      expect(body.operations).toHaveLength(change == 'team' ? 2 : 3)
    } finally {
      triggers.dispose()
      workspace.dispose()
    }
  })

  it.each(['failure', 'success', 'empty'] as const)('keeps loaded connections during authorization refresh and handles %s', async (outcome) => {
    const { client, workspace, triggers } = createSetup()
    const old: ConnectorConnection = { connectionId: 'github-old', displayName: 'Old', isDefault: true, serviceId: 'github', status: 'active' }
    const fresh = { ...old, displayName: 'Refreshed' }
    const pending = Promise.withResolvers<readonly ConnectorConnection[]>()
    const list = vi.spyOn(client, 'listConnectorConnections').mockResolvedValueOnce([old]).mockReturnValueOnce(pending.promise).mockResolvedValue([fresh])
    try {
      await workspace.start(flow.flowId)
      workspace.selectNodes(['github'])
      await triggers.refresh()
      await triggers.connect('github')
      const refresh = triggers.refreshAfterAuthorization()

      expect(triggers.$.selectedAuthorizationPending.value).toBe(false)
      expect(triggers.$.connectionLoading.value).toBe('github')
      expect(triggers.$.selectedActiveConnections.value).toEqual([old])
      expect(triggers.$.selectedConnection.value).toEqual(old)

      if (outcome == 'failure') pending.reject(new Error('Connection refresh failed'))
      else pending.resolve(outcome == 'empty' ? [] : [fresh])
      await refresh

      expect(triggers.$.connectionLoading.value).toBeUndefined()
      if (outcome == 'failure') {
        expect(triggers.$.selectedActiveConnections.value).toEqual([old])
        expect(triggers.$.selectedConnection.value).toEqual(old)
        expect(triggers.$.selectedConnectionError.value).toContain('Connection refresh failed')
        await triggers.refresh()
        expect(triggers.$.selectedConnection.value).toEqual(fresh)
        expect(triggers.$.selectedConnectionError.value).toBeUndefined()
        expect(list).toHaveBeenCalledTimes(3)
      } else {
        expect(triggers.$.selectedActiveConnections.value).toEqual(outcome == 'empty' ? [] : [fresh])
        await triggers.refresh()
        expect(list).toHaveBeenCalledTimes(2)
      }
    } finally {
      triggers.dispose()
      workspace.dispose()
    }
  })

  it.each(['before', 'during'] as const)('reloads the authorized provider after switching away %s refresh', async (timing) => {
    const { client, workspace, triggers } = createSetup()
    const old: ConnectorConnection = { connectionId: 'github-old', displayName: 'Old', isDefault: true, serviceId: 'github', status: 'active' }
    const fresh = { ...old, displayName: 'Refreshed' }
    const pending = Promise.withResolvers<readonly ConnectorConnection[]>()
    const list = vi.spyOn(client, 'listConnectorConnections').mockResolvedValue([old])
    try {
      await workspace.start(flow.flowId)
      workspace.selectNodes(['mail'])
      await triggers.refresh()
      workspace.selectNodes(['github'])
      await triggers.refresh()
      await triggers.connect('github')
      list.mockClear()

      if (timing == 'before') {
        workspace.selectNodes(['mail'])
        await triggers.refreshAfterAuthorization()
        expect(list).not.toHaveBeenCalled()
      } else {
        list.mockReturnValueOnce(pending.promise)
        const refresh = triggers.refreshAfterAuthorization()
        workspace.selectNodes(['mail'])
        await triggers.refresh()
        expect(triggers.$.connectionLoading.value).toBeUndefined()
        pending.resolve([])
        await refresh
      }
      workspace.selectNodes(['github'])
      expect(triggers.$.selectedConnection.value).toEqual(old)
      list.mockResolvedValue([fresh])
      await triggers.refresh()
      expect(list).toHaveBeenLastCalledWith('github', undefined, flow.flowId)
      expect(triggers.$.selectedConnection.value).toEqual(fresh)
      expect(list).toHaveBeenCalledTimes(timing == 'before' ? 1 : 2)
    } finally {
      triggers.dispose()
      workspace.dispose()
    }
  })
})
