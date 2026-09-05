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
  const request = vi.fn(async (path: string) => {
    requests.push(path)
    if (path == '/v1/flows?limit=50&includeTotal=true') return Response.json({ flows: [flow], total: 1, version: 1 })
    if (path == `/v1/flows/${flow.flowId}/draft`) {
      return Response.json({
        actorId: 'actor',
        content: {
          document: {
            bindings: Object.fromEntries(['github', 'mail'].map((provider) => [provider, { kind: 'connection', target: `${provider}-old` }])),
            graph: {
              edges: [],
              nodes: Object.fromEntries(
                ['github', 'mail'].map((provider) => [
                  provider,
                  {
                    bindingId: provider,
                    config: {},
                    definition: {
                      configSchema: { type: 'object' },
                      definitionVersion: 1,
                      description: '',
                      displayName: 'New event',
                      key: `${provider}.event`,
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
      })
    }
    if (path == `/v1/flows/${flow.flowId}/live`) {
      return Response.json({ flowId: flow.flowId, hasUnpublishedChanges: true, publication: null, revision: 0, status: 'not-published', version: 1 })
    }
    if (path == `/v1/flows/${flow.flowId}/presentation`) {
      return Response.json({ revision: 1, updatedAt: timestamp, value: {}, version: 1 })
    }
    if (path == `/v1/flows/${flow.flowId}/revisions/${flow.draftRevisionId}/check`) {
      return Response.json({
        closureDigest: 'closure',
        diagnostics: [],
        engineContract: 'open-flow-engine/v1',
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
  return { client, workspace, triggers, requests, signal }
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
