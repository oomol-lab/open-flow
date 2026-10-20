import type { RevisionContent, TriggerNode } from '../../flow/common/change.ts'
import type { Publication, TriggerBinding } from './api.ts'

import { expect, it } from 'vitest'
import { currentFlowModelVersion } from '../../flow/common/change.ts'
import { ControlClient } from './api.ts'
import { flowInputDefinitions } from './authoringFields.ts'
import { decodeLiveDetails, liveEntries } from './liveDetails.ts'

const publication: Publication = {
  flowId: 'flow/1',
  publicationId: 'published',
  revisionId: 'fixed',
  actorId: 'actor',
  createdAt: '2026-10-12T00:00:00Z',
  operation: 'publish',
  closureDigest: 'closure',
  revisionDigest: 'revision',
  sharedAccessDigest: 'access',
  engineContract: 'open-flow-engine/v6',
  modelVersion: currentFlowModelVersion,
  version: 1,
}
const nodes: Record<string, TriggerNode> = {
  start: { inputDefs: [], kind: 'start', name: 'Start' },
  webhook: {
    kind: 'webhook',
    name: 'Receive',
    method: 'POST',
    bodyFields: [
      { handle: 'message', jsonSchema: { type: 'string' }, nullable: false },
      { handle: 'count', jsonSchema: { type: 'number' }, nullable: false, value: 0 },
      { handle: 'optional', jsonSchema: {}, nullable: true, value: null },
    ],
    options: { responseStatusCode: 202, responseData: 'Accepted' },
  },
  cron: { kind: 'cron', name: 'Daily', cronTimes: [{ type: 'cron', expression: '0 8 * * *', timezone: 'Asia/Shanghai' }] },
  error: { kind: 'error', name: 'Errors', sourceFlowIds: ['upstream'] },
  poll: {
    kind: 'poll',
    name: 'Poll',
    connectionId: 'account',
    pollTimes: [{ type: 'every', unit: 'minute', value: 5 }],
    config: { folder: { kind: 'unset' } },
    definition: {
      type: 'poll',
      key: 'files',
      name: 'files',
      displayName: 'Files',
      description: '',
      definitionVersion: 1,
      provider: 'drive',
      outputs: [],
      configInputs: [],
    },
  },
  integration: {
    kind: 'integration',
    name: 'Messages',
    config: { sourceId: { kind: 'value', value: 'shared-source' } },
    definition: {
      type: 'integration',
      key: 'messages',
      name: 'messages',
      displayName: 'Messages',
      description: '',
      definitionVersion: 1,
      provider: 'feishu',
      outputs: [],
      configInputs: [],
      endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 200 },
    },
  },
}
const content: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: {
    bindings: {},
    graph: {
      edges: [],
      nodes: {
        ...nodes,
        start: {
          ...(nodes.start as Extract<import('../../flow/common/change.ts').GraphNode, { kind: 'start' }>),
          inputDefs: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }],
        },
      },
    },
  },
}
const bindings: TriggerBinding[] = Object.entries(nodes).flatMap(([triggerNodeId, node]) =>
  node.kind == 'start' || node.kind == 'manual'
    ? []
    : [
        {
          flowId: publication.flowId,
          currentPublicationId: publication.publicationId,
          currentRevisionId: publication.revisionId,
          triggerNodeId,
          kind: node.kind,
          health: 'healthy',
          runtimeVersion: 1,
          updatedAt: publication.createdAt,
          version: 1,
          ...(node.kind == 'webhook' ? { endpointUrl: 'https://flow.example/v1/webhooks/endpoint_123' } : {}),
        },
      ],
)
function details() {
  return {
    inputDefs: flowInputDefinitions(content),
    flowId: publication.flowId,
    publication,
    enabled: true,
    status: 'runnable',
    entries: liveEntries(content, publication, bindings),
    version: 1,
  }
}

it('projects six published entry types with business fields and independent binding state', () => {
  const result = decodeLiveDetails(details())
  expect(result.entries).toHaveLength(6)
  expect(result.entries.find((entry) => entry.type == 'start')).not.toHaveProperty('binding')
  expect(result).toHaveProperty('inputDefs.message', { schema: { type: 'string' }, nullable: false })
  expect(result.entries.find((entry) => entry.type == 'webhook')).toMatchObject({
    config: {
      method: 'POST',
      body: {
        message: { schema: { type: 'string' }, nullable: false },
        count: { default: 0 },
        optional: { nullable: true, default: null },
      },
      options: { responseStatusCode: 202 },
    },
    binding: { endpointUrl: expect.any(String) },
  })
  expect(result.entries.find((entry) => entry.type == 'poll')).toMatchObject({
    provider: 'drive',
    config: { connectionId: 'account', schedule: [{ value: 5 }] },
    inputs: { folder: { kind: 'unset' } },
  })
  expect(result.entries.find((entry) => entry.type == 'integration')).toMatchObject({ inputs: { sourceId: { kind: 'value', value: 'shared-source' } } })
  const suspended = decodeLiveDetails({ ...details(), enabled: false, status: 'suspended' })
  expect(suspended.entries.find((entry) => entry.type == 'webhook')).toHaveProperty('binding.health', 'healthy')
})

it('hides retired bindings and ignores body fields for bodyless methods', () => {
  const webhook = nodes.webhook
  if (webhook?.kind != 'webhook') throw new Error('Missing fixture')
  const changed = { ...content, document: { ...content.document, graph: { edges: [], nodes: { webhook: { ...webhook, method: 'GET' as const } } } } }
  const entries = liveEntries(changed, publication, [...bindings, { ...bindings[0]!, triggerNodeId: 'retired', currentPublicationId: undefined }])
  expect(entries).toHaveLength(1)
  expect(entries[0]).toHaveProperty('config.body', {})
})

it('preserves listener health separately from subscription health', () => {
  const entries = liveEntries(
    content,
    publication,
    bindings.map((item) =>
      item.kind == 'integration'
        ? Object.assign({}, item, {
            health: 'failed' as const,
            lastErrorCode: 'subscription.failed',
            listener: { health: 'healthy' as const },
          })
        : item,
    ),
  )
  expect(decodeLiveDetails({ ...details(), entries }).entries.find((item) => item.type == 'integration')).toMatchObject({
    binding: { health: 'failed', listener: { health: 'healthy' }, lastErrorCode: 'subscription.failed' },
  })
})

it('reads the encoded public endpoint and rejects mixed publications and malformed entries', async () => {
  const client = new ControlClient(async (path) => {
    expect(path).toBe('/v1/flows/flow%2F1/live/details')
    return Response.json(details())
  })
  expect(await client.getLiveDetails(publication.flowId)).toEqual(details())
  const valid = details()
  const entry = valid.entries.find((item) => item.type == 'webhook')!
  if (entry.type != 'webhook') throw new Error('Missing fixture')
  for (const value of [
    { ...valid, flowId: 'another' },
    { ...valid, entries: [entry, entry] },
    { ...valid, entries: [{ ...entry, binding: { ...entry.binding, currentPublicationId: 'another' } }] },
    { ...valid, entries: [{ ...entry, binding: { ...entry.binding, endpointUrl: undefined } }] },
    { ...valid, entries: [{ ...entry, config: { ...entry.config, method: 'BOGUS' } }] },
    { ...valid, entries: [{ ...entry, config: { ...entry.config, body: { message: { nullable: 'yes' } } } }] },
  ])
    expect(() => decodeLiveDetails(value)).toThrow()
})

it('returns an unpublished view without an invented enable switch', () => {
  const empty = { flowId: publication.flowId, publication: null, inputDefs: null, status: 'not-published', entries: [], version: 1 }
  expect(decodeLiveDetails(empty)).toEqual(empty)
  expect(() => decodeLiveDetails({ ...empty, enabled: false })).toThrow()
})

it.each([{ kind: 'cron' as const }, { endpointUrl: undefined }, { currentRevisionId: 'another-revision' }])(
  'rejects inconsistent entry bindings at both production and consumption: %j',
  (patch) => {
    const current = details()
    const entry = current.entries.find((item) => item.type == 'webhook')!
    if (entry.type != 'webhook') throw new Error('Missing fixture')
    const inconsistent = { ...entry.binding, ...patch }
    expect(() =>
      liveEntries(
        content,
        publication,
        bindings.map((item) => (item.kind == 'webhook' ? inconsistent : item)),
      ),
    ).toThrow()
    expect(() => decodeLiveDetails({ ...current, entries: [{ ...entry, binding: inconsistent }] })).toThrow()
  },
)

it('reads legacy published Manual entries without creating a runtime binding', () => {
  const legacy: RevisionContent = {
    modelVersion: 6,
    modules: {},
    document: { bindings: {}, graph: { nodes: { original: { kind: 'manual', name: 'Original' } }, edges: [] } },
  }
  const entries = liveEntries(legacy, publication, [])
  expect(entries).toEqual([{ nodeId: 'original', type: 'manual', name: 'Original', config: {} }])
  expect(decodeLiveDetails({ ...details(), entries }).entries).toEqual(entries)
})

it.each([undefined, null, { message: { schema: { type: 'string' } } }, { message: { schema: { type: 'string' }, nullable: false, default: 'unsupported' } }])(
  'reports malformed workflow input definitions through the public response error contract: %j',
  async (inputDefs) => {
    const client = new ControlClient(async () => Response.json({ ...details(), inputDefs }))
    await expect(client.getLiveDetails(publication.flowId)).rejects.toMatchObject({ code: 'response.invalid', status: 502 })
  },
)
