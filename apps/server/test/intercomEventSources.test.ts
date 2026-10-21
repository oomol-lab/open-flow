import type { EventSource } from '@oomol-lab/open-flow/control-api'

import { inputValues } from '@oomol-lab/open-flow/flow-change'
import { integrationDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { openService } from './serviceFixture.ts'

const now = 1_800_000_000_000
function delivery(payload: unknown) {
  const body = JSON.stringify(payload)
  return {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature': `sha1=${createHmac('sha1', 'key').update(body).digest('hex')}`,
    },
  }
}
const event = (id: string) => ({
  type: 'notification_event',
  app_id: `workspace${id}`,
  id: `notif${id}`,
  topic: 'conversation.user.replied',
  data: { item: { id: 'conversation', body: '客户回复' } },
})
it('shares an app ingress while isolating workspaces, retaining fanout, and keeping the other source alive when one is disabled', async () => {
  const connector = createConnectorHost({
    listConnections: async () =>
      ['1', '2'].map((id) => ({
        connectionId: `connection${id}`,
        providerAccountId: `workspace${id}:admin${id}`,
        displayName: `Bot ${id}`,
        serviceId: 'intercom',
        status: 'active' as const,
        isDefault: id === '1',
      })),
  })
  const service = await openService(':memory:', {
    clock: () => now,
    capabilities: { connector: () => connector, integration: () => ({ callbackKey: 'key', publicOrigin: 'https://flow.example' }) },
  })
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const sources: EventSource[] = []
  for (const id of ['1', '2']) {
    const result = await app.request('/v1/event-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'intercom',
        version: 1,
        name: `Bot ${id}`,
        connectionId: `connection${id}`,
        teamId: null,
        appId: 'A1',
        signingSecret: 'key',
        eventTypes: ['conversation.user.replied'],
      }),
    })
    expect(result.status, await result.clone().text()).toBe(201)
    sources.push(await result.json())
  }
  expect(sources[0]!.endpointUrl).toBe(sources[1]!.endpointUrl)
  const endpoint = new URL(sources[0]!.endpointUrl!).pathname
  const challenge = await app.request(endpoint, delivery({ type: 'notification_event', app_id: 'workspace1', topic: 'ping' }))
  expect(challenge.status).toBe(200)
  const flows: string[] = []
  for (const index of [0, 0, 1]) {
    const source = sources[index]!
    const created = await service.control.createFlow('operator', `Flow ${flows.length}`, `create-${flows.length}`)
    const flowId = created.flow.flowId
    const draft = await service.control.changeDraft('operator', flowId, created.flow.draftRevisionId, [
      {
        kind: 'graph.node.create',
        nodeId: 'intercom',
        node: {
          kind: 'integration',
          name: 'Intercom',
          connectionId: source.connectionId,
          definition: integrationDefinitions.find((item) => item.snapshot.key === 'intercom.on_conversation_event')!.snapshot,
          config: inputValues({ sourceId: source.sourceId, eventTypes: ['conversation.user.replied'] }),
        },
      },
    ])
    const operation = await service.control.publishFlow('operator', flowId, draft.revision.revisionId, 'open-flow-engine/v6', null, `publish-${flows.length}`)
    await service.tickIntegration()
    await service.tickMaintenance()
    expect(service.control.getPublishOperation(flowId, operation.operationId).status).toBe('succeeded')
    flows.push(flowId)
  }

  for (let retry = 0; retry < 2; retry++) expect((await app.request(endpoint, delivery(event('1')))).status).toBe(200)
  await service.tickIntegration()
  expect(flows.map((flow) => service.control.runs.listRuns(flow, 20).page.runs.length)).toEqual([1, 1, 0])
  const source = sources[0]!
  const disabled = await app.request(`/v1/event-sources/${source.sourceId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, expectedRevision: source.revision, name: source.name, enabled: false, eventTypes: source.eventTypes }),
  })
  expect(disabled.status).toBe(200)
  expect((await app.request(endpoint, delivery(event('2')))).status).toBe(200)
  await service.tickIntegration()
  expect(flows.map((flow) => service.control.runs.listRuns(flow, 20).page.runs.length)).toEqual([1, 1, 1])
  expect(await (await app.request('/v1/event-sources')).text()).not.toContain('"signingSecret"')
})
