import type { Draft, Flow } from '../api.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it, vi } from 'vitest'
import { connectorProxyConfigSchema, connectorProxyTask } from '../../../../connector/common/proxy.ts'
import { WorkbenchClient } from '../api.ts'
import { addNodeIntent } from '../editor/addNodeOptions.ts'
import { createI18n } from '../i18n.ts'
import { providerIcon } from '../providerIcon.ts'
import { RevisionView } from '../revisionView.ts'
import { ConnectorStore } from './connectorStore.ts'
import { resourceValue } from './resource.ts'
import { WorkspaceStore } from './workspaceStore.ts'

const timestamp = '2026-08-30T00:00:00.000Z'
const flows: readonly Flow[] = ['flow-a', 'flow-b'].map((flowId, index) => ({
  createdAt: timestamp,
  draftRevisionId: `revision-${index + 1}`,
  resourceReferences: {
    draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
    sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
  },
  flowId,
  name: `Flow ${index + 1}`,
  status: 'active',
  updatedAt: timestamp,
  version: 1,
}))

function draft(flowId: string, revisionId: string, nodes: Draft['content']['document']['graph']['nodes'] = {}): Draft {
  return {
    actorId: 'actor-1',
    content: {
      document: {
        bindings: {},
        graph: { edges: [], nodes },
      },
      modelVersion: currentFlowModelVersion,
      modules: {},
    },
    createdAt: timestamp,
    digest: `digest-${flowId}`,
    flowId,
    modelVersion: currentFlowModelVersion,
    parentRevisionId: null,
    revisionId,
    version: 1,
  }
}

describe('ConnectorStore', () => {
  it.each(['missing', 'failed'] as const)('reports a %s Provider after loading, and clears the error after a successful retry', async (result) => {
    const catalog = Promise.withResolvers<Response>()
    let recovered = false
    const request = vi.fn(async (path: string) => {
      if (path.includes('/proxy/providers'))
        return recovered ? Response.json({ success: true, data: [{ service: 'example', displayName: 'Example', authTypes: ['no_auth'] }] }) : catalog.promise
      if (path.includes('/connector/connections')) return Response.json({ version: 1, connections: [] })
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(request)
    const saved = draft('flow-a', 'revision-1', {
      request: {
        kind: 'task',
        task: connectorProxyTask(connectorProxyConfigSchema.parse({ providerId: 'example' })),
        inputs: { endpoint: { kind: 'value', value: '/items' } },
      },
    })
    vi.spyOn(client, 'listFlows').mockResolvedValue({ version: 1, flows: flows.map((flow) => ({ ...flow, referenceCount: 0 })) })
    vi.spyOn(client, 'getEditor').mockResolvedValue({
      version: 1,
      flow: flows[0]!,
      draft: saved,
      live: { version: 1, flowId: 'flow-a', hasUnpublishedChanges: false, publication: null, revision: 0, status: 'not-published' },
      presentation: { version: 1, revision: 1, updatedAt: timestamp, value: {} },
    })
    const i18n = createI18n('en')
    const workspace = new WorkspaceStore(client, vi.fn())
    const connectors = new ConnectorStore(client, workspace, vi.fn(), { openExternalPage: async () => false }, i18n)
    try {
      await workspace.start('flow-a')
      workspace.selectNodes(['request'])
      expect(connectors.$.selectedProvider.value).toBeUndefined()
      expect(connectors.$.selectedActionError.value).toBeUndefined()
      if (result === 'missing') catalog.resolve(Response.json({ success: true, data: [] }))
      else catalog.reject(new Error('Provider catalog failed'))
      const message = result === 'missing' ? i18n.t('inspector.account.statusUnavailable', { action: 'example' }) : 'Provider catalog failed'
      await vi.waitFor(() => expect(connectors.$.selectedActionError.value).toEqual({ message }))
      recovered = true
      await connectors.refresh(true)
      await vi.waitFor(() => expect(connectors.$.selectedProvider.value).toMatchObject({ serviceId: 'example' }))
      expect(connectors.$.selectedActionError.value).toBeUndefined()
    } finally {
      catalog.resolve(Response.json({ success: true, data: [] }))
      connectors.dispose()
      workspace.dispose()
      i18n.dispose()
    }
  })

  it('waits for Actions before returning the first Provider choice list', async () => {
    const actions = Promise.withResolvers<Response>()
    const request = vi.fn(async (path: string) => {
      if (path.includes('/proxy/providers')) return Response.json({ success: true, data: [{ service: 'mail', displayName: 'Mail', authTypes: ['no_auth'] }] })
      if (path.includes('/proxy/actions')) return actions.promise
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    const connectors = new ConnectorStore(client, workspace, vi.fn(), { openExternalPage: async () => false })
    const controller = new AbortController()
    try {
      await resourceValue(connectors.browseAddNodeOptions(controller.signal))
      const options = connectors.provideAddNodeOptionChoices('connector-provider:mail', controller.signal)
      await vi.waitFor(() => expect(request.mock.calls.some(([path]) => path.includes('/proxy/actions'))).toBe(true))
      expect(options.value.data).toBeUndefined()
      const firstChoices = resourceValue(options, controller.signal)
      actions.resolve(
        Response.json({
          success: true,
          data: [{ id: 'mail.send', service: 'mail', name: 'Send', description: '', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } }],
        }),
      )
      await expect(firstChoices).resolves.toMatchObject([
        { kind: 'connector', connector: { actionId: 'mail.send' } },
        { kind: 'connector-proxy', provider: { serviceId: 'mail' } },
      ])
    } finally {
      actions.resolve(Response.json({ success: true, data: [] }))
      controller.abort()
      connectors.dispose()
      workspace.dispose()
    }
  })

  it('keeps the Provider request choice available when Actions fail to load', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes('/proxy/providers')) return Response.json({ success: true, data: [{ service: 'mail', displayName: 'Mail', authTypes: ['no_auth'] }] })
      if (path.includes('/proxy/actions')) throw new Error('Actions unavailable')
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    const connectors = new ConnectorStore(client, workspace, vi.fn(), { openExternalPage: async () => false })
    const controller = new AbortController()
    try {
      await resourceValue(connectors.browseAddNodeOptions(controller.signal))
      const options = connectors.provideAddNodeOptionChoices('connector-provider:mail', controller.signal)
      await vi.waitFor(() => expect(options.value.error).toBeDefined())
      await expect(resourceValue(options, controller.signal)).resolves.toMatchObject([{ kind: 'connector-proxy', provider: { serviceId: 'mail' } }])
    } finally {
      controller.abort()
      connectors.dispose()
      workspace.dispose()
    }
  })

  it('offers a Provider request even when the Provider has no Actions', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.includes('/proxy/providers'))
        return Response.json({ success: true, data: [{ service: 'public', displayName: 'Public API', authTypes: ['no_auth'] }] })
      if (path.includes('/proxy/actions')) return Response.json({ success: true, data: [] })
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    const connectors = new ConnectorStore(client, workspace, vi.fn(), { openExternalPage: async () => false })
    const controller = new AbortController()
    try {
      await resourceValue(connectors.browseAddNodeOptions(controller.signal))
      const choices = await resourceValue(connectors.provideAddNodeOptionChoices('connector-provider:public', controller.signal))
      expect(choices).toMatchObject([{ kind: 'connector-proxy', provider: { serviceId: 'public', serviceName: 'Public API', noSetup: true } }])
      expect(choices?.[0]).not.toHaveProperty('connector')
      expect(connectors.$.actions.value).toEqual({})
    } finally {
      controller.abort()
      connectors.dispose()
      workspace.dispose()
    }
  })
  it.each(['providers', 'actions', 'connections', 'missing action'] as const)('retries %s immediately in the selected Flow', async (failure) => {
    let failing = true
    const account = { connectionId: 'account', serviceId: 'mail', displayName: 'Mail', status: 'active', isDefault: true }
    const request = vi.fn(async (path: string) => {
      const url = new URL(path, 'https://test.invalid')
      const kind = url.pathname.split('/').at(-1)
      if (failing && kind == failure) throw new Error('Offline')
      if (kind == 'connections') return Response.json({ version: 1, connections: [account] })
      return Response.json({
        success: true,
        data:
          kind == 'providers'
            ? [{ service: 'mail', displayName: 'Mail', authTypes: ['oauth2'] }]
            : failing && failure == 'missing action'
              ? []
              : [{ id: 'mail.send', service: 'mail', name: 'Send', description: '', inputSchema: { type: 'object' }, outputSchema: { type: 'object' } }],
      })
    })
    const client = new WorkbenchClient(request)
    vi.spyOn(client, 'listFlows').mockResolvedValue({ version: 1, flows: flows.map((flow) => ({ ...flow, referenceCount: 0 })) })
    vi.spyOn(client, 'getEditor').mockResolvedValue({
      version: 1,
      flow: flows[0]!,
      draft: draft('flow-a', 'revision-1'),
      live: { version: 1, flowId: 'flow-a', hasUnpublishedChanges: false, publication: null, revision: 0, status: 'not-published' },
      presentation: { version: 1, revision: 1, updatedAt: timestamp, value: {} },
    })
    const workspace = new WorkspaceStore(client, vi.fn())
    const connectors = new ConnectorStore(client, workspace, vi.fn(), { openExternalPage: async () => false })
    try {
      await workspace.start('flow-a')
      await expect(connectors.resolveAction('mail.send')).rejects.toThrow()
      // Ordinary reads retain backoff. A user retry must bypass it without waiting 30 seconds.
      failing = false
      const reads = request.mock.calls.length
      if (failure == 'missing action') await expect(connectors.resolveAction('mail.send')).rejects.toThrow()
      else {
        connectors.retryAction('mail.send')
        await expect(connectors.resolveAction('mail.send')).resolves.toBeDefined()
      }
      if (failure == 'missing action') expect(request).toHaveBeenCalledTimes(reads)
      if (failure == 'missing action') connectors.retryAction('mail.send')
      await expect(connectors.resolveAction('mail.send')).resolves.toMatchObject({ action: { actionId: 'mail.send' }, connections: [account] })
      const retried = request.mock.calls.slice(reads).map(([path]) => path)
      expect(retried.length).toBeGreaterThan(0)
      if (failure == 'providers') expect(retried).toContain('/v1/connector/proxy/providers?flowId=flow-a&locale=en')
      if (failure == 'actions' || failure == 'missing action') expect(retried).toContain('/v1/connector/proxy/actions?flowId=flow-a&service=mail&locale=en')
      if (failure == 'connections') expect(retried).toContain('/v1/connector/connections?flowId=flow-a')
    } finally {
      connectors.dispose()
      workspace.dispose()
    }
  })

  it('keeps discovery global and resolves selected Actions in the active Flow', async () => {
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
            engineContract: 'open-flow-engine/v6',
            flowId: flow!.flowId,
            modelVersion: currentFlowModelVersion,
            revisionDigest: `digest-${flow!.flowId}`,
            revisionId: flow!.draftRevisionId,
            valid: true,
            version: 1,
          })
        }
      }
      const flowId = new URL(path, 'https://open-flow.example').searchParams.get('flowId')
      const scope = flowId ?? 'global'
      if (path.startsWith('/v1/connector/proxy/providers?')) {
        connectorRequests.push(path)
        return Response.json({
          data: [
            {
              homepageUrl: 'https://mail.example',
              authTypes: ['no_auth'],
              service: 'mail',
              displayName: `${new URL(path, 'https://open-flow.example').searchParams.get('locale') == 'zh-CN' ? '邮件' : 'Mail'} ${scope}`,
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
              description: `Send for ${scope}.`,
              inputSchema: { type: 'object', properties: {} },
              outputSchema: { type: 'object', properties: {} },
            },
          ],
        })
      }
      if (path.startsWith('/v1/connector/connections'))
        return Response.json({
          version: 1,
          connections: flowId == null ? [{ connectionId: 'mail-team', serviceId: 'mail', displayName: 'Team account', status: 'active', isDefault: true }] : [],
        })
      if (path.startsWith('/v1/connector/action-metadata')) {
        connectorRequests.push(path)
        const action = {
          actionId: 'mail.send',
          authenticated: false,
          description: `Send for ${scope}.`,
          homepageUrl: 'https://mail.example',
          inputs: {},
          name: 'Send',
          outputs: {},
          serviceId: 'mail',
          serviceName: `Mail ${scope}`,
        }
        return Response.json({ version: 1, ...(path.includes('/action-metadata/') ? { action } : { actions: [action] }) })
      }
      throw new Error(`Unexpected request: ${path}`)
    })
    const client = new WorkbenchClient(request)
    const workspace = new WorkspaceStore(client, vi.fn())
    const connectors = new ConnectorStore(client, workspace, vi.fn(), { openExternalPage: async () => false })
    const signal = new AbortController().signal

    try {
      await workspace.start(flows[0]!.flowId)
      await connectors.loadConnections(signal)
      expect(connectors.$.pickerConnections.value.map((connection) => connection.connectionId)).toEqual(['mail-team'])
      await resourceValue(workspace.catalogs.connections.get(undefined, flows[0]!.flowId))
      expect(connectors.$.connections.value).toEqual([])
      const firstProviders = await resourceValue(connectors.browseAddNodeOptions(signal))
      const firstActions = await resourceValue(connectors.provideAddNodeOptionChoices('connector-provider:mail', signal))

      expect(firstProviders?.[0]?.label).toBe('Mail global')
      expect(firstProviders?.[0]?.icon).toBe(providerIcon({ homepageUrl: 'https://mail.example', serviceId: 'mail', serviceName: 'Mail global' }))
      expect(firstActions?.[0]?.description).toBe('Send for flow-a.')
      expect(firstActions?.[0]?.icon).toBe(providerIcon({ homepageUrl: 'https://mail.example', serviceId: 'mail', serviceName: 'Mail flow-a' }))
      expect(connectors.$.actions.value).toEqual({})
      const prepared = await connectors.resolveAction('mail.send')
      expect(prepared.action.description).toBe('Send for flow-a.')
      const accountReads = request.mock.calls.filter(([path]) => path.startsWith('/v1/connector/connections')).length
      connectors.retryAction('mail.send')
      await expect(connectors.resolveAction('mail.send')).resolves.toMatchObject({ action: { authenticated: false }, connections: [] })
      expect(request.mock.calls.filter(([path]) => path.startsWith('/v1/connector/connections'))).toHaveLength(accountReads)
      await resourceValue(connectors.provideAddNodeOptions('send', signal))
      expect(connectors.$.actions.value['mail.send']?.description).toBe('Send for flow-a.')

      const choice = firstActions?.[0]
      if (choice?.kind != 'connector') throw new Error('Expected a Connector choice.')
      await connectors.loadCodeConnections('mail', signal)
      const connectionReads = () => request.mock.calls.filter(([path]) => path.startsWith('/v1/connector/connections')).length
      const cachedReads = connectionReads()
      await connectors.loadCodeConnections('mail', signal)
      expect(connectionReads()).toBe(cachedReads)
      await connectors.loadCodeConnections('mail', signal, true)
      expect(connectionReads()).toBe(cachedReads + 1)

      await workspace.selectFlow(flows[1]!.flowId)
      expect(connectors.$.actions.value).toEqual({})
      expect(connectors.$.catalogs.value).toEqual({})

      const secondProviders = await resourceValue(connectors.browseAddNodeOptions(signal))
      await resourceValue(connectors.provideAddNodeOptionChoices('connector-provider:mail', signal))

      expect(secondProviders?.[0]?.label).toBe('Mail global')
      expect(connectors.$.actions.value).toEqual({})
      expect(connectorRequests).toContain('/v1/connector/proxy/providers?locale=en')
      expect(connectorRequests).toContain('/v1/connector/proxy/actions?flowId=flow-a&service=mail&locale=en')
      expect(connectorRequests).toContain('/v1/connector/proxy/actions?flowId=flow-b&service=mail&locale=en')
      expect(connectorRequests).toContain('/v1/connector/action-metadata?q=send&locale=en')
      expect(connectorRequests.some((path) => path.includes('flowId=flow-b'))).toBe(true)
      connectors.setLanguage('zh-CN')
      const localizedProviders = await resourceValue(connectors.browseAddNodeOptions(signal))
      expect(localizedProviders?.[0]?.label).toBe('邮件 global')
      await resourceValue(connectors.provideAddNodeOptionChoices(localizedProviders![0]!.id, signal))
      await resourceValue(connectors.provideAddNodeOptions('send', signal))
      expect(connectorRequests).toContain('/v1/connector/proxy/actions?flowId=flow-b&service=mail&locale=zh-CN')
      expect(connectorRequests).toContain('/v1/connector/action-metadata?q=send&locale=zh-CN')
    } finally {
      connectors.dispose()
      workspace.dispose()
    }
  })
})

it('presents Leina notifications in the selected language while preserving the connector contract', async () => {
  const action = {
    actionId: 'leina.send_notification',
    serviceId: 'leina',
    serviceName: 'Leina',
    name: 'send_notification',
    description: '填写通知订阅时发送到指定会话；留空则发送到机器人 Home。',
    authenticated: false,
    inputs: {
      leinaId: { jsonSchema: { type: 'string' }, nullable: false },
      message: { jsonSchema: { type: 'string' }, nullable: false },
      subscription: { description: '由机器人创建的通知订阅。', jsonSchema: { type: 'string' }, nullable: true, value: null },
    },
    outputs: {},
  }
  const request = vi.fn(async (_path: string) => Response.json({ version: 1, actions: [action] }))
  const client = new WorkbenchClient(request)
  const i18n = createI18n('zh-CN')
  const workspace = new WorkspaceStore(client, vi.fn())
  const connectors = new ConnectorStore(client, workspace, vi.fn(), { openExternalPage: async () => false }, i18n)
  const controller = new AbortController()
  try {
    const options = await resourceValue(connectors.provideAddNodeOptions('通知', controller.signal))
    expect(options).toHaveLength(1)
    const option = options![0]!
    expect(option).toMatchObject({ label: 'Leina 通知', description: action.description, kind: 'connector' })
    const intent = addNodeIntent(option, new RevisionView(draft('flow-a', 'revision-1')), i18n.t)
    expect(intent).toMatchObject({ kind: 'connector', action: { ...action, name: 'Leina 通知' } })
    expect(request.mock.calls[0]?.[0]).toContain('q=%E9%80%9A%E7%9F%A5')
  } finally {
    controller.abort()
    connectors.dispose()
    workspace.dispose()
  }
})
