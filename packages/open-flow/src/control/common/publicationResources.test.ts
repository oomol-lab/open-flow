import { describe, expect, it } from 'vitest'
import { currentFlowModelVersion } from '../../flow/common/change.ts'
import { triggerDefinitions } from '../../trigger/providers/definitions.ts'
import { ControlClient } from './api.ts'
import { publicationResources } from './publicationResources.ts'

it('projects published trigger configuration and excludes ordinary nodes and Manual entries', () => {
  const definition = triggerDefinitions.find(({ snapshot }) => snapshot.type == 'poll')!.snapshot
  if (definition.type != 'poll') throw new Error('Expected a Poll definition.')
  const resources = publicationResources({
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          start: { kind: 'manual', name: 'Start' },
          value: { kind: 'value', name: 'Value', inputs: {}, values: [] },
          mail: {
            kind: 'poll',
            name: 'New mail',
            definition,
            connectionId: 'mail-account',
            config: { filter: { kind: 'value', value: 'unread' } },
            pollTimes: [{ type: 'every', unit: 'minute', value: 5 }],
          },
        },
      },
    },
  })
  expect(resources).toEqual([
    {
      resourceId: 'mail',
      kind: 'trigger',
      type: 'poll',
      name: 'New mail',
      config: { key: definition.key, connectionId: 'mail-account', schedule: [{ type: 'every', unit: 'minute', value: 5 }] },
      inputs: { filter: { kind: 'value', value: 'unread' } },
    },
  ])
})

describe('publication resource response boundaries', () => {
  const runtime = {
    currentPublicationId: 'publication',
    currentRevisionId: 'revision',
    flowId: 'flow',
    triggerNodeId: 'hook',
    kind: 'webhook',
    health: 'healthy',
    runtimeVersion: 1,
    updatedAt: '2026-10-12T00:00:00.000Z',
    version: 1,
  }
  const resource = { resourceId: 'hook', kind: 'trigger', type: 'webhook', name: 'Hook', config: { method: 'POST', body: {} }, inputs: {}, runtime }
  const response = { flowId: 'flow', publicationId: 'publication', revisionId: 'revision', status: 'live', enabled: true, resources: [resource], version: 1 }

  it.each([
    { ...response, status: 'historical', enabled: undefined },
    { ...response, flowId: 'another-flow' },
    { ...response, resources: [{ ...resource, runtime: { ...runtime, currentPublicationId: 'old' } }] },
    { ...response, resources: [{ ...resource, runtime: { ...runtime, currentRevisionId: 'old' } }] },
    { ...response, resources: [{ ...resource, runtime: { ...runtime, triggerNodeId: 'other' } }] },
    { ...response, resources: [{ ...resource, type: 'unknown' }] },
  ])('rejects mismatched identities or historical runtime state: %j', async (body) => {
    const client = new ControlClient(async () => Response.json(body))
    await expect(client.listPublicationResources('flow')).rejects.toMatchObject({ code: 'response.invalid' })
  })

  it('checks requested publication and detail identities', async () => {
    const client = new ControlClient(async () => Response.json(response))
    await expect(client.listPublicationResources('flow', 'other')).rejects.toMatchObject({ code: 'response.invalid' })
    const detail = new ControlClient(async () => Response.json({ ...response, resource }))
    await expect(detail.getPublicationResource('flow', 'other')).rejects.toMatchObject({ code: 'response.invalid' })
    await expect(detail.getPublicationResource('flow', 'hook')).resolves.toMatchObject({ resource })
  })
})
