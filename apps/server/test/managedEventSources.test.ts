import type { EventSource } from '@oomol-lab/open-flow/control-api'

import { inputValues } from '@oomol-lab/open-flow/flow-change'
import { integrationDefinitions } from '@oomol-lab/open-flow/provider-triggers'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { expect, it } from 'vitest'
import { ConnectorTaskError } from '../node/deployment/connector-contract.ts'
import { createServerApp } from '../node/transport/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { openService } from './serviceFixture.ts'
import { sourceProtocolFixture } from './sourceProtocolFixture.ts'

const now = 1_800_000_000_000
function delivery(id: string) {
  return {
    method: 'POST',
    body: JSON.stringify({
      event: {
        id,
        type: 'jira:issue_created',
        payload: { event: 'jira:issue_created', deliveryId: id, cloudId: 'cloud', issueId: '200', body: { id: '200' } },
      },
    }),
    headers: { 'content-type': 'application/json', 'authorization': 'Bearer test' },
  }
}
it('shares a managed Jira project subscription and deduplicates fanout without exposing OAuth secrets', async () => {
  let clock = now
  let failVerification = false
  let failRenewal = false
  const calls: { active: boolean; key: string }[] = []
  const connector = createConnectorHost({
    trigger: async (_provider, connectionId, _trigger, request) => {
      const id = connectionId.slice(-1)
      if (request.operation === 'resource') {
        if (failRenewal && request.active) throw new ConnectorTaskError('connector.unavailable', 'Temporary subscription failure')
        calls.push({ active: request.active, key: request.requestKey })
        return { outcome: 'ready', subscription: request.active ? { webhookId: 42, expiresAt: now + 30 * 86400000 } : {} }
      }
      if (request.operation === 'source') {
        if (request.request.action === 'receive' && failVerification) throw new ConnectorTaskError('connector.unavailable', 'Temporary verification failure')
        const result = sourceProtocolFixture(request.request, `jira:cloud${id}:user`, clock) as { source?: { state: Record<string, unknown> }; event?: unknown }
        if (request.request.action === 'prepare')
          return { ...result, subscriptions: [{ key: 'project', config: { projectId: '100', endpointUrl: request.request.endpointUrl } }] }
        if (request.request.action === 'inspect') {
          const state = request.request.source.state
          return {
            source: {
              ...request.request.source,
              state: {
                ...state,
                projection: {
                  ready: state.resourceStatus === 'ready',
                  expiresAt: now + 30 * 86400000,
                  view: {
                    appId: `cloud${id}`,
                    manageSubscriptions: true,
                    verificationTokenConfigured: false,
                    encryptKeyConfigured: false,
                    verifiedAt: state.verifiedAt == null ? null : new Date(Number(state.verifiedAt)).toISOString(),
                    subscriptionStatus: state.resourceStatus,
                    lastError: state.lastError,
                  },
                },
              },
            },
          }
        }
        return result
      }
      throw new Error('Unexpected operation')
    },
    listConnections: async () =>
      ['1', '2'].map((id) => ({
        connectionId: `connection${id}`,
        providerAccountId: `jira:cloud${id}:user`,
        displayName: `Bot ${id}`,
        serviceId: 'jira',
        status: 'active' as const,
        isDefault: id === '1',
      })),
  })
  const service = await openService(':memory:', {
    clock: () => clock,
    capabilities: { connector: () => connector, integration: () => ({ callbackKey: 'key', publicOrigin: 'https://flow.example' }) },
  })
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const sources: EventSource[] = []
  for (const id of ['1', '2']) {
    const result = await app.request('/v1/event-sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'jira',
        version: 1,
        name: `Bot ${id}`,
        connectionId: `connection${id}`,
        teamId: null,
        project: 'DEMO',
        eventTypes: ['jira:issue_created'],
      }),
    })
    expect(result.status, await result.clone().text()).toBe(201)
    sources.push(await result.json())
  }
  expect(sources[0]!.endpointUrl).not.toBe(sources[1]!.endpointUrl)
  const endpoint = new URL(sources[0]!.endpointUrl!).pathname
  const flows: string[] = []
  for (const index of [0, 0, 1]) {
    const source = sources[index]!
    const created = await service.control.createFlow('operator', `Flow ${flows.length}`, `create-${flows.length}`)
    const flowId = created.flow.flowId
    const draft = await service.control.changeDraft('operator', flowId, created.flow.draftRevisionId, [
      {
        kind: 'graph.node.create',
        nodeId: 'jira',
        node: {
          kind: 'integration',
          name: 'Jira',
          connectionId: source.connectionId,
          definition: integrationDefinitions.find((item) => item.snapshot.key === 'jira.on_issue_event')!.snapshot,
          config: inputValues({ sourceId: source.sourceId, eventTypes: ['jira:issue_created'] }),
        },
      },
    ])
    const operation = await service.control.publishFlow('operator', flowId, draft.revision.revisionId, currentEngineContract, null, `publish-${flows.length}`)
    await service.tickIntegration()
    await service.tickMaintenance()
    expect(service.control.getPublishOperation(flowId, operation.operationId).status).toBe('succeeded')
    flows.push(flowId)
  }

  failVerification = true
  expect((await app.request(endpoint, delivery('event1'))).status).toBe(503)
  expect(flows.map((flow) => service.control.runs.listRuns(flow, 20).page.runs.length)).toEqual([0, 0, 0])
  failVerification = false
  for (let retry = 0; retry < 2; retry++) expect((await app.request(endpoint, delivery('event1'))).status).toBe(200)
  await service.tickIntegration()
  expect(flows.map((flow) => service.control.runs.listRuns(flow, 20).page.runs.length)).toEqual([1, 1, 0])
  expect(calls.filter((call) => call.active).map((call) => call.key)).toEqual([
    `${sources[0]!.sourceId}:project`,
    `${sources[0]!.sourceId}:project`,
    `${sources[1]!.sourceId}:project`,
  ])
  const source = sources[0]!
  const disabled = await app.request(`/v1/event-sources/${source.sourceId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, expectedRevision: source.revision, name: source.name, enabled: false, eventTypes: source.eventTypes }),
  })
  expect(disabled.status).toBe(200)
  expect((await app.request(new URL(sources[1]!.endpointUrl!).pathname, delivery('event2'))).status).toBe(200)
  await service.tickIntegration()
  expect(flows.map((flow) => service.control.runs.listRuns(flow, 20).page.runs.length)).toEqual([1, 1, 1])
  expect(await (await app.request('/v1/event-sources')).text()).not.toContain('"signingSecret"')
  service.control.retireFlow(flows[0]!)
  await service.tickIntegration()
  await service.tickMaintenance()
  expect(calls.filter((call) => !call.active)).toHaveLength(0)
  service.control.retireFlow(flows[1]!)
  await service.tickIntegration()
  await service.tickMaintenance()
  expect(calls.filter((call) => !call.active)).toEqual([{ active: false, key: `${sources[0]!.sourceId}:project` }])
  failRenewal = true
  clock += 120_000
  await service.tickIntegration()
  let listed = (await (await app.request('/v1/event-sources')).json()) as { sources: EventSource[] }
  expect(listed.sources.find((item) => item.sourceId === sources[1]!.sourceId)).toMatchObject({ subscriptionStatus: 'error' })
  failRenewal = false
  clock += 120_000
  await service.tickIntegration()
  listed = (await (await app.request('/v1/event-sources')).json()) as { sources: EventSource[] }
  expect(listed.sources.find((item) => item.sourceId === sources[1]!.sourceId)).toMatchObject({ subscriptionStatus: 'ready' })
})
