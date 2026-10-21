import type { EventSource } from '@oomol-lab/open-flow/control-api'

import { inputValues } from '@oomol-lab/open-flow/flow-change'
import { integrationDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { createHmac } from 'node:crypto'
import { expect, it } from 'vitest'
import { ConnectorTaskError } from '../node/deployment/connector-contract.ts'
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
      'x-hub-signature': `sha256=${createHmac('sha256', 'key').update(body).digest('hex')}`,
    },
  }
}
const event = (id: string, timestamp = now, version?: number) => ({
  event: 'meeting.transcribed',
  meeting_id: `meeting${id}`,
  timestamp,
  reprocessed_at: version,
})
it('isolates meetings, retries access outages, deduplicates timestamp changes and discards older transcript versions', async () => {
  let unavailable = false
  const connector = createConnectorHost({
    trigger: async (_provider, connectionId, _trigger, request) => {
      if (unavailable) throw new ConnectorTaskError('connector.unavailable', 'Temporarily unavailable')
      expect(request.operation).toBe('sourceIdentity')
      const id = connectionId.slice(-1)
      const meetingId = 'config' in request ? request.config.meetingId : undefined
      return { accountId: `account${id}`, meetingId, accessible: meetingId === `meeting${id}` }
    },
    listConnections: async () =>
      ['1', '2'].map((id) => ({
        connectionId: `connection${id}`,
        providerAccountId: `account${id}`,
        displayName: `Bot ${id}`,
        serviceId: 'fireflies',
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
        kind: 'fireflies',
        version: 1,
        name: `Bot ${id}`,
        connectionId: `connection${id}`,
        teamId: null,
        signingSecret: 'key',
        eventTypes: ['meeting.transcribed'],
      }),
    })
    expect(result.status, await result.clone().text()).toBe(201)
    sources.push(await result.json())
  }
  expect(sources[0]!.endpointUrl).not.toBe(sources[1]!.endpointUrl)
  const endpoint = new URL(sources[0]!.endpointUrl!).pathname
  for (const [index, source] of sources.entries())
    expect((await app.request(new URL(source.endpointUrl!).pathname, delivery(event(String(index + 1), now, 1)))).status).toBe(200)
  const flows: string[] = []
  for (const index of [0, 0, 1]) {
    const source = sources[index]!
    const created = await service.control.createFlow('operator', `Flow ${flows.length}`, `create-${flows.length}`)
    const flowId = created.flow.flowId
    const draft = await service.control.changeDraft('operator', flowId, created.flow.draftRevisionId, [
      {
        kind: 'graph.node.create',
        nodeId: 'fireflies',
        node: {
          kind: 'integration',
          name: 'Intercom',
          connectionId: source.connectionId,
          definition: integrationDefinitions.find((item) => item.snapshot.key === 'fireflies.on_meeting_ready')!.snapshot,
          config: inputValues({ sourceId: source.sourceId, eventTypes: ['meeting.transcribed'] }),
        },
      },
    ])
    const operation = await service.control.publishFlow('operator', flowId, draft.revision.revisionId, 'open-flow-engine/v6', null, `publish-${flows.length}`)
    await service.tickIntegration()
    await service.tickMaintenance()
    expect(service.control.getPublishOperation(flowId, operation.operationId).status).toBe('succeeded')
    flows.push(flowId)
  }

  for (let retry = 0; retry < 2; retry++) expect((await app.request(endpoint, delivery(event('1', now, 2)))).status).toBe(200)
  await service.tickIntegration()
  expect(flows.map((flow) => service.control.runs.listRuns(flow, 20).page.runs.length)).toEqual([1, 1, 0])
  unavailable = true
  expect((await app.request(endpoint, delivery(event('1', now, 3)))).status).toBe(503)
  unavailable = false
  for (const value of [event('1', now, 3), event('1', now + 1000, 3), event('1', now, 2), event('1')])
    expect((await app.request(endpoint, delivery(value))).status).toBe(200)
  await service.tickIntegration()
  expect(flows.map((flow) => service.control.runs.listRuns(flow, 20).page.runs.length)).toEqual([2, 2, 0])
  const source = sources[0]!
  const disabled = await app.request(`/v1/event-sources/${source.sourceId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, expectedRevision: source.revision, name: source.name, enabled: false, eventTypes: source.eventTypes }),
  })
  expect(disabled.status).toBe(200)
  expect((await app.request(new URL(sources[1]!.endpointUrl!).pathname, delivery(event('2', now, 2)))).status).toBe(200)
  await service.tickIntegration()
  expect(flows.map((flow) => service.control.runs.listRuns(flow, 20).page.runs.length)).toEqual([2, 2, 1])
  expect(await (await app.request('/v1/event-sources')).text()).not.toContain('"signingSecret"')
})
