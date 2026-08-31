import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { ConnectorStore } from './connectorStore.ts'
import { WorkspaceStore } from './workspaceStore.ts'

const timestamp = '2026-08-30T00:00:00.000Z'
const flows = ['flow-a', 'flow-b'].map((flowId, index) => ({
  createdAt: timestamp,
  draftRevisionId: `revision-${index + 1}`,
  flowId,
  name: `Flow ${index + 1}`,
  status: 'active',
  updatedAt: timestamp,
  version: 1,
}))

function draft(flowId: string, revisionId: string) {
  return {
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
    digest: `digest-${flowId}`,
    flowId,
    modelVersion: 1,
    parentRevisionId: null,
    revisionId,
    version: 1,
  }
}

describe('ConnectorStore', () => {
  it('reloads provider and action caches after switching Flows', async () => {
    const connectorRequests: string[] = []
    const request = vi.fn(async (path: string) => {
      if (path == '/v1/flows?limit=50&includeTotal=true') return Response.json({ flows, total: flows.length, version: 1 })
      for (const [index, flow] of flows.entries()) {
        if (path == `/v1/flows/${flow!.flowId}/draft`) return Response.json(draft(flow!.flowId, flow!.draftRevisionId))
        if (path == `/v1/flows/${flow!.flowId}/live`) {
          return Response.json({ flowId: flow!.flowId, hasUnpublishedChanges: false, publication: null, revision: 0, status: 'not-published', version: 1 })
        }
        if (path == `/v1/flows/${flow!.flowId}/presentation`) {
          return Response.json({ revision: 1, updatedAt: timestamp, value: {}, version: 1 })
        }
        if (path == `/v1/flows/${flow!.flowId}/revisions/${flow!.draftRevisionId}/check`) {
          return Response.json({
            closureDigest: `closure-${index}`,
            diagnostics: [],
            engineContract: 'open-flow-engine/v1',
            flowId: flow!.flowId,
            modelVersion: 1,
            revisionDigest: `digest-${flow!.flowId}`,
            revisionId: flow!.draftRevisionId,
            valid: true,
            version: 1,
          })
        }
      }
      const flowId = new URL(path, 'https://open-flow.example').searchParams.get('flowId')
      if (path.startsWith('/v1/connector/providers?')) {
        connectorRequests.push(path)
        return Response.json({ providers: [{ serviceId: 'mail', serviceName: `Mail ${flowId}` }], version: 1 })
      }
      if (path.startsWith('/v1/connector/actions?')) {
        connectorRequests.push(path)
        return Response.json({
          actions: [
            {
              actionId: 'mail.send',
              authenticated: false,
              description: `Send for ${flowId}.`,
              inputs: {},
              name: 'Send',
              outputs: {},
              serviceId: 'mail',
              serviceName: `Mail ${flowId}`,
            },
          ],
          version: 1,
        })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    const connectors = new ConnectorStore(client, workspace, vi.fn(), { openExternalPage: async () => false })
    const signal = new AbortController().signal

    try {
      await workspace.start(flows[0]!.flowId)
      const firstProviders = await connectors.browseAddNodeOptions(signal)
      const firstActions = await connectors.provideAddNodeOptionChoices('connector-provider:mail', signal)

      expect(firstProviders?.[0]?.label).toBe('Mail flow-a')
      expect(firstActions?.[0]?.description).toBe('Send for flow-a.')
      expect(connectors.$.actions.value['mail.send']?.description).toBe('Send for flow-a.')

      await workspace.selectFlow(flows[1]!.flowId)
      expect(connectors.$.actions.value).toEqual({})

      const secondProviders = await connectors.browseAddNodeOptions(signal)
      await connectors.provideAddNodeOptionChoices('connector-provider:mail', signal)

      expect(secondProviders?.[0]?.label).toBe('Mail flow-b')
      expect(connectors.$.actions.value['mail.send']?.description).toBe('Send for flow-b.')
      expect(connectorRequests).toEqual([
        '/v1/connector/providers?flowId=flow-a',
        '/v1/connector/actions?flowId=flow-a&service=mail',
        '/v1/connector/providers?flowId=flow-b',
        '/v1/connector/actions?flowId=flow-b&service=mail',
      ])
    } finally {
      connectors.dispose()
      workspace.dispose()
    }
  })
})
