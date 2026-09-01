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

describe('TriggerStore', () => {
  it('loads catalog definitions without requesting Connections and creates an unconnected option', async () => {
    const requests: string[] = []
    const request = vi.fn(async (path: string) => {
      requests.push(path)
      if (path == '/v1/flows?limit=50&includeTotal=true') return Response.json({ flows: [flow], total: 1, version: 1 })
      if (path == `/v1/flows/${flow.flowId}/draft`) {
        return Response.json({
          actorId: 'actor',
          content: {
            document: { bindings: {}, graph: { nodes: {} }, subflows: {}, tasks: {} },
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
    const triggers = new TriggerStore(client, workspace, vi.fn(), { openExternalPage: async () => false })
    const signal = new AbortController().signal

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
})
