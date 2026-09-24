import type { ConnectorConnection } from '../api.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it, vi } from 'vitest'
import { inputValues } from '../../../../flow/common/inputValue.ts'
import { WorkbenchClient } from '../api.ts'
import { createI18n } from '../i18n.ts'
import { providerIcon } from '../providerIcon.ts'
import { resourceValue } from './resource.ts'
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

const connectionRequests = new WeakMap<WorkbenchClient, ReturnType<typeof connectionFetcher>>()
const connectionFetcher = () => vi.fn(async (_service: string, _flowId: string | undefined): Promise<readonly ConnectorConnection[]> => [])

function createSetup(language: 'en' | 'zh-CN' = 'en') {
  const requests: string[] = []
  const fetchConnections = connectionFetcher()
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
              bindings: {},
              graph: {
                edges: [],
                nodes: Object.fromEntries(
                  ['github', 'mail', 'linear'].map((provider) => [
                    provider,
                    {
                      connectionId: `${provider}-old`,

                      config: inputValues(provider == 'linear' ? { teamId: 'team-old', stateIds: ['state-old'] } : {}),
                      definition: {
                        configInputs: [],
                        definitionVersion: 2,
                        description: '',
                        displayName: 'New event',
                        key: provider == 'linear' ? 'linear.on_issue_changed' : `${provider}.event`,
                        name: 'event',
                        outputs: [{ handle: 'payload', jsonSchema: { type: 'object' }, nullable: false }],
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
            modelVersion: currentFlowModelVersion,
            modules: {},
          },
          createdAt: timestamp,
          digest: 'digest',
          flowId: flow.flowId,
          modelVersion: currentFlowModelVersion,
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
          modelVersion: currentFlowModelVersion,
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
        engineContract: 'open-flow-engine/v5',
        flowId: flow.flowId,
        modelVersion: currentFlowModelVersion,
        revisionDigest: 'digest',
        revisionId: flow.draftRevisionId,
        valid: true,
        version: 1,
      })
    }
    if (path.startsWith('/v1/connector/connections')) {
      const url = new URL(path, 'https://test.invalid')
      return Response.json({
        version: 1,
        connections: await fetchConnections('github', url.searchParams.get('flowId') ?? undefined),
      })
    }
    if (path == `/v1/trigger-keys/catalog?locale=${language}`) {
      return Response.json({
        locale: language,
        display: {
          'github.on_repo_event': {
            configInputs: {},
            configInputLabels: {},
            displayName: language == 'en' ? 'Repository event' : '仓库事件',
            description: language == 'en' ? 'Runs when a repository changes.' : '仓库变更时运行。',
            outputs: { payload: language == 'en' ? 'Repository event payload.' : '仓库事件负载。' },
          },
        },
        definitions: [
          {
            configInputs: [],
            definitionVersion: 2,
            description: 'Runs when a repository changes.',
            displayName: 'Repository event',
            endpoint: {
              body: { allowArray: false, allowEmpty: false, formats: ['json'] },
              methods: ['POST'],
              successStatus: 200,
            },
            key: 'github.on_repo_event',
            name: 'on_repo_event',
            outputs: [{ handle: 'payload', jsonSchema: { additionalProperties: true, type: 'object' }, nullable: false }],
            provider: 'github',
            type: 'integration',
          },
        ],
        version: 3,
      })
    }
    throw new Error(`Unexpected request: ${path}`)
  })
  const client = new WorkbenchClient(request)
  connectionRequests.set(client, fetchConnections)
  const workspace = new WorkspaceStore(client, vi.fn())
  const triggers = new TriggerStore(client, workspace, vi.fn(), { openExternalPage: async () => true }, createI18n(language))
  const signal = new AbortController().signal
  return { client, workspace, triggers, requests, request, signal }
}

describe('TriggerStore', () => {
  it('loads catalog definitions without requesting Connections and creates an unconnected option', async () => {
    const { workspace, triggers, requests, signal } = createSetup()

    try {
      await workspace.start(flow.flowId)
      const options = await resourceValue(triggers.browseAddNodeOptions(signal))
      const searched = await resourceValue(triggers.provideAddNodeOptions('repository', signal))

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
      expect(requests.filter((path) => path == '/v1/trigger-keys/catalog?locale=en')).toHaveLength(1)
      expect(requests.some((path) => path.startsWith('/v1/connector/connections'))).toBe(false)
    } finally {
      triggers.dispose()
      workspace.dispose()
    }
  })

  it('searches translated and canonical copy and saves the same definition in both languages', async () => {
    const saved = []
    for (const language of ['en', 'zh-CN'] as const) {
      const { workspace, triggers, client, signal } = createSetup(language)
      connectionRequests.get(client)!.mockResolvedValue([])
      try {
        await workspace.start(flow.flowId)
        const result = await resourceValue(triggers.provideAddNodeOptions(language == 'en' ? 'repository' : '仓库', signal))
        expect(result).toHaveLength(1)
        const option = result![0]!
        expect(option.label).toBe(language == 'en' ? 'Repository event' : '仓库事件')
        expect(await resourceValue(triggers.provideAddNodeOptions('repository', signal))).toHaveLength(1)
        const id = await workspace.addNode(option, { x: 0, y: 0 })
        const node = workspace.$.draft.value!.content.document.graph.nodes[id!]!
        if (node.kind != 'integration') throw new Error('Expected Integration Trigger.')
        saved.push(node.definition)
      } finally {
        triggers.dispose()
        workspace.dispose()
      }
    }
    expect(saved[0]).toEqual(saved[1])
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
      const list = connectionRequests.get(client)!.mockResolvedValue(connections)
      if (scenario == 'failure') list.mockRejectedValue(new Error('Connection lookup failed'))
      try {
        await workspace.start(flow.flowId)
        const option = (await resourceValue(triggers.browseAddNodeOptions(signal)))![0]!
        if (option.kind != 'trigger' || !('trigger' in option) || option.trigger.kind != 'catalog') throw new Error('Expected provider Trigger.')
        const nodeId = await workspace.addNode(scenario == 'explicit' ? { ...option, trigger: { ...option.trigger, connectionId: 'chosen' } } : option, {
          x: 0,
          y: 0,
        })
        expect(nodeId).toBeDefined()
        const node = workspace.$.draft.value!.content.document.graph.nodes[nodeId!]!
        if (node.kind != 'integration') throw new Error('Expected Integration Trigger.')
        const expected = scenario == 'default' ? 'preferred' : scenario == 'only' ? 'other' : scenario == 'explicit' ? 'chosen' : ''
        expect(node.connectionId).toEqual(expected || undefined)
        if (scenario == 'explicit') expect(list).not.toHaveBeenCalled()
        else expect(list).toHaveBeenCalledWith('github', flow.flowId)
      } finally {
        triggers.dispose()
        workspace.dispose()
      }
    },
  )

  it('selects the default Feishu account when adding an Application Event trigger', async () => {
    const { client, workspace, triggers, signal } = createSetup()
    const connection: ConnectorConnection = {
      connectionId: 'feishu-default',
      displayName: 'Feishu app',
      isDefault: true,
      serviceId: 'feishu_app_bot',
      status: 'active',
    }
    const list = connectionRequests.get(client)!.mockResolvedValue([connection])
    try {
      await workspace.start(flow.flowId)
      const option = (await resourceValue(triggers.browseAddNodeOptions(signal)))![0]!
      if (option.kind != 'trigger' || !('trigger' in option) || option.trigger.kind != 'catalog') throw new Error('Expected provider Trigger.')
      const nodeId = await workspace.addNode(
        { ...option, trigger: { ...option.trigger, definition: { ...option.trigger.definition, key: 'feishu_app_bot.on_event', provider: 'feishu_app_bot' } } },
        { x: 0, y: 0 },
      )
      const node = workspace.$.draft.value!.content.document.graph.nodes[nodeId!]!
      if (node.kind != 'integration') throw new Error('Expected Integration Trigger.')
      expect(node.connectionId).toEqual('feishu-default')
      expect(list).toHaveBeenCalledOnce()
    } finally {
      triggers.dispose()
      workspace.dispose()
    }
  })

  it('does not create a Trigger after leaving the Flow during connection lookup', async () => {
    const { client, workspace, triggers, signal, requests } = createSetup()
    const pending = Promise.withResolvers<readonly ConnectorConnection[]>()
    const list = connectionRequests.get(client)!.mockReturnValue(pending.promise)
    try {
      await workspace.start(flow.flowId)
      const option = (await resourceValue(triggers.browseAddNodeOptions(signal)))![0]!
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

  it('keeps Feishu filters compatible when changing sources and event types', async () => {
    const { workspace, triggers, request } = createSetup()
    const original = request.getMockImplementation()!
    let revision = 1
    request.mockImplementation(async (path, init) => {
      const response = await original(path, init)
      if (path.endsWith('/draft/changes')) {
        const data = await response.json()
        data.revision.parentRevisionId = `revision-${revision}`
        data.revision.revisionId = `revision-${++revision}`
        data.revision.digest = `digest-${revision}`
        return Response.json(data)
      }
      if (!path.endsWith('/editor')) return response
      const data = await response.json()
      const node = data.draft.content.document.graph.nodes.linear
      node.kind = 'integration'
      node.definition.type = 'integration'
      node.definition.endpoint = { body: { formats: ['json'], allowArray: false, allowEmpty: false }, methods: ['POST'], successStatus: 200 }
      node.definition.provider = 'feishu_app_bot'
      node.definition.key = 'feishu_app_bot.on_event'
      node.config = inputValues({ sourceId: 'old-source', eventTypes: ['drive.file.edit_v1'], resource: { kind: 'document', id: 'doc' } })
      delete node.pollTimes
      return Response.json(data)
    })
    try {
      await workspace.start(flow.flowId)
      expect(
        await workspace.setTriggerEventSource('linear', {
          version: 1,
          sourceId: 'new-source',
          revision: 1,
          name: 'Events',
          provider: 'feishu_app_bot',
          appId: 'cli_demo',
          connectionId: 'app-connection',
          teamId: null,
          enabled: true,
          eventTypes: ['im.message.receive_v1'],
          manageSubscriptions: false,
          verificationTokenConfigured: true,
          encryptKeyConfigured: true,
          endpointUrl: null,
          verifiedAt: null,
          lastReceivedAt: null,
          updatedAt: timestamp,
          consumers: [],
        }),
      ).toBe(true)
      const node = workspace.$.draft.value!.content.document.graph.nodes.linear!
      if (node.kind != 'integration') throw new Error('Expected integration.')
      expect(node.config).toEqual({
        ...inputValues({ sourceId: 'new-source' }),
        eventTypes: { kind: 'unset' },
        resource: { kind: 'unset' },
        chatIds: { kind: 'unset' },
      })
      expect(node.connectionId).toEqual('app-connection')
      expect(request.mock.calls.filter(([path]) => path.endsWith('/draft/changes'))).toHaveLength(1)
      await workspace.saveTriggerConfig('linear', 'chatIds', ['chat'])
      await workspace.saveTriggerConfig('linear', 'eventTypes', ['drive.file.edit_v1'])
      expect(workspace.$.draft.value!.content.document.graph.nodes.linear).toHaveProperty('config.chatIds.kind', 'unset')
      await workspace.saveTriggerConfig('linear', 'resource', { kind: 'document', id: 'token', documentType: 'docx' })
      await workspace.saveTriggerConfig('linear', 'eventTypes', ['drive.file.title_updated_v1'])
      expect(workspace.$.draft.value!.content.document.graph.nodes.linear).toHaveProperty('config.resource.value.id', 'token')
      await workspace.saveTriggerConfig('linear', 'eventTypes', ['contact.user.created_v3'])
      expect(workspace.$.draft.value!.content.document.graph.nodes.linear).toHaveProperty('config.resource.kind', 'unset')
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
      expect(node.config).toEqual({ teamId: change == 'team' ? { kind: 'value', value: 'team-new' } : { kind: 'unset' }, stateIds: { kind: 'unset' } })
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
    const list = connectionRequests.get(client)!.mockResolvedValueOnce([old]).mockReturnValueOnce(pending.promise).mockResolvedValue([fresh])
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
        await triggers.refresh(true)
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
    const list = connectionRequests.get(client)!.mockResolvedValue([old])
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
      expect(triggers.$.selectedConnection.value).toEqual(timing == 'before' ? old : undefined)
      list.mockResolvedValue([fresh])
      await triggers.refresh()
      expect(list).toHaveBeenLastCalledWith('github', flow.flowId)
      expect(triggers.$.selectedConnection.value).toEqual(fresh)
      expect(list).toHaveBeenCalledTimes(timing == 'before' ? 1 : 2)
    } finally {
      triggers.dispose()
      workspace.dispose()
    }
  })
})
