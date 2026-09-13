import { describe, expect, it, vi } from 'vitest'
import { WorkbenchClient } from '../api.ts'
import { providerIcon } from '../providerIcon.ts'
import { ConnectorStore } from './connectorStore.ts'
import { resourceValue } from './resource.ts'
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
        graph: { edges: [], nodes: {} },
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
        if (path == `/v1/flows/${flow.flowId}/editor`)
          return Response.json({
            flow,
            draft: draft(flow.flowId, flow.draftRevisionId),
            live: { flowId: flow.flowId, hasUnpublishedChanges: false, publication: null, revision: 0, status: 'not-published', version: 1 },
            presentation: { revision: 1, updatedAt: timestamp, value: {}, version: 1 },
            version: 1,
          })
        if (path == `/v1/flows/${flow!.flowId}/revisions/${flow!.draftRevisionId}/check`) {
          return Response.json({
            closureDigest: `closure-${index}`,
            diagnostics: [],
            engineContract: 'open-flow-engine/v2',
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
      if (path.startsWith('/v1/connector/proxy/providers?')) {
        connectorRequests.push(path)
        return Response.json({
          data: [
            {
              homepageUrl: 'https://mail.example',
              authTypes: ['no_auth'],
              service: 'mail',
              displayName: `${new URL(path, 'https://open-flow.example').searchParams.get('locale') == 'zh-CN' ? '邮件' : 'Mail'} ${flowId}`,
            },
          ],
          success: true,
        })
      }
      if (path.startsWith('/v1/connector/proxy/actions?')) {
        connectorRequests.push(path)
        return Response.json({
          success: true,
          data: [
            {
              id: 'mail.send',
              service: 'mail',
              name: 'Send',
              description: `Send for ${flowId}.`,
              inputSchema: { type: 'object', properties: {} },
              outputSchema: { type: 'object', properties: {} },
            },
          ],
        })
      }
      if (path.startsWith('/v1/connector/proxy/apps')) return Response.json({ success: true, data: [] })
      if (path.startsWith('/v1/connector/action-metadata?')) {
        connectorRequests.push(path)
        return Response.json({
          actions: [
            {
              actionId: 'mail.send',
              authenticated: false,
              description: `Send for ${flowId}.`,
              homepageUrl: 'https://mail.example',
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
      const firstProviders = await resourceValue(connectors.browseAddNodeOptions(signal))
      const firstActions = await resourceValue(connectors.provideAddNodeOptionChoices('connector-provider:mail', signal))

      expect(firstProviders?.[0]?.label).toBe('Mail flow-a')
      expect(firstProviders?.[0]?.icon).toBe(providerIcon({ homepageUrl: 'https://mail.example', serviceId: 'mail', serviceName: 'Mail flow-a' }))
      expect(firstActions?.[0]?.description).toBe('Send for flow-a.')
      expect(firstActions?.[0]?.icon).toBe(providerIcon({ homepageUrl: 'https://mail.example', serviceId: 'mail', serviceName: 'Mail flow-a' }))
      expect(connectors.$.actions.value).toEqual({})
      await connectors.loadCodeAction('mail.send', signal)
      await resourceValue(connectors.provideAddNodeOptions('send', signal))
      expect(connectors.$.actions.value['mail.send']?.description).toBe('Send for flow-a.')

      const choice = firstActions?.[0]
      if (choice?.kind != 'connector') throw new Error('Expected a Connector choice.')
      const lateConnections = Promise.withResolvers<Response>()
      request.mockImplementationOnce(() => lateConnections.promise)
      workspace.catalogs.connections.get('mail', flows[0]!.flowId, true)
      await Promise.resolve()
      const pending = Promise.all([connectors.loadCodeAction('mail.send', signal), connectors.loadCodeConnections('mail', signal)])

      await workspace.selectFlow(flows[1]!.flowId)
      lateConnections.resolve(Response.json({ success: true, data: [] }))
      await pending
      expect(connectors.$.actions.value).toEqual({})
      expect(connectors.$.catalogs.value).toEqual({})

      const secondProviders = await resourceValue(connectors.browseAddNodeOptions(signal))
      await resourceValue(connectors.provideAddNodeOptionChoices('connector-provider:mail', signal))

      expect(secondProviders?.[0]?.label).toBe('Mail flow-b')
      expect(connectors.$.actions.value).toEqual({})
      expect(connectorRequests).toEqual([
        '/v1/connector/proxy/providers?flowId=flow-a&locale=en',
        '/v1/connector/proxy/actions?flowId=flow-a&service=mail&locale=en',
        '/v1/connector/action-metadata?flowId=flow-a&q=send&locale=en',
        '/v1/connector/proxy/providers?flowId=flow-b&locale=en',
        '/v1/connector/proxy/actions?flowId=flow-b&service=mail&locale=en',
      ])
      connectors.setLanguage('zh-CN')
      const localizedProviders = await resourceValue(connectors.browseAddNodeOptions(signal))
      expect(localizedProviders?.[0]?.label).toBe('邮件 flow-b')
      await resourceValue(connectors.provideAddNodeOptionChoices(localizedProviders![0]!.id, signal))
      await resourceValue(connectors.provideAddNodeOptions('send', signal))
      expect(connectorRequests.slice(-2)).toEqual([
        '/v1/connector/proxy/actions?flowId=flow-b&service=mail&locale=zh-CN',
        '/v1/connector/action-metadata?flowId=flow-b&q=send&locale=zh-CN',
      ])
    } finally {
      connectors.dispose()
      workspace.dispose()
    }
  })
})
