import { expect, it } from 'vitest'
import { workflowContractSchema } from '../../workflow/common/workflow.ts'
import { allConnectorConnectionsQuery, connectorProvidersQuery } from './connectorQueries.ts'
import { decodeEventSources } from './eventSources.ts'
import { decodeResultList } from './results.ts'
import { runDetails, runResult } from './runDecoders.ts'

const source = {
  version: 1,
  sourceId: 'source',
  revision: 1,
  name: 'Events',
  provider: 'feishu',
  appId: 'app',
  connectionId: 'connection',
  teamId: null,
  enabled: true,
  eventTypes: ['message.received'],
  manageSubscriptions: true,
  verificationTokenConfigured: false,
  encryptKeyConfigured: false,
  endpointUrl: null,
  verifiedAt: null,
  lastReceivedAt: null,
  updatedAt: '2026-10-16T00:00:00.000Z',
  consumers: [{ flowId: 'flow', flowName: 'Flow', triggerNodeId: 'trigger' }],
}
const result = {
  resultId: 'result',
  callId: 'call',
  toolId: 'tool',
  source: { kind: 'code' },
  bytes: 0,
  digest: 'a'.repeat(64),
  createdAt: '2026-10-16T00:00:00.000Z',
}
const cases: { name: string; decode: (value: unknown) => unknown; value: unknown }[] = [
  { name: 'Providers', decode: connectorProvidersQuery().decode, value: { version: 1, providers: [{ serviceId: 'provider', serviceName: 'Provider' }] } },
  {
    name: 'Connections',
    decode: allConnectorConnectionsQuery().decode,
    value: { version: 1, connections: [{ connectionId: 'connection', displayName: 'Account', isDefault: true, serviceId: 'provider', status: 'active' }] },
  },
  { name: 'Event Sources', decode: decodeEventSources, value: { version: 1, sources: [source] } },
  { name: 'Results', decode: decodeResultList, value: { version: 1, runId: 'run', results: [result] } },
  {
    name: 'Run details',
    decode: runDetails,
    value: {
      version: 1,
      runId: 'run',
      flowId: 'flow',
      revisionId: 'revision',
      source: 'draft',
      status: 'waiting',
      createdAt: '2026-10-16T00:00:00.000Z',
      closureDigest: 'closure',
      engineContract: 'future-engine',
      engineDigest: 'engine',
      modelVersion: 999,
      sharedAccessDigest: 'access',
      revisionDigest: 'revision',
      initiator: { channel: 'cli', actorId: 'actor' },
      caller: { flowId: 'caller-flow', runId: 'caller-run', nodeId: 'call', executionId: 'execution' },
      waits: [{ waitId: 'wait', nodeId: 'node', actions: ['continue'], expiresAt: 'later', waitingSince: 'now', prompt: 'Continue?' }],
    },
  },
  { name: 'Run result', decode: runResult, value: { version: 1, runId: 'run', status: 'completed', finishedAt: 'now', result: 0 } },
  {
    name: 'Workflow contract',
    decode: (value) => workflowContractSchema.parse(value),
    value: {
      version: 1,
      flowId: 'flow',
      name: 'Flow',
      revisionId: 'revision',
      publicationId: 'publication',
      inputs: [{ handle: 'input', jsonSchema: true, nullable: false }],
      outputs: [],
    },
  },
]

function withExtraFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withExtraFields)
  if (value === null || typeof value != 'object') return value
  return { ...Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, withExtraFields(entry)])), extra: true }
}

it.each(cases)('ignores additional fields at every response level: $name', ({ decode, value }) => {
  expect(decode(withExtraFields(value))).toEqual(decode(value))
})

it.each(cases)('still rejects missing or invalid response versions: $name', ({ decode, value }) => {
  const { version: _, ...fields } = value as Record<string, unknown>
  expect(() => decode(fields)).toThrow()
  expect(() => decode({ ...fields, version: 99 })).toThrow()
})

it('still rejects invalid nested known fields', () => {
  expect(() => decodeEventSources({ version: 1, sources: [{ ...source, enabled: 'yes' }] })).toThrow()
  expect(() => decodeResultList({ version: 1, runId: 'run', results: [{ ...result, bytes: -1 }] })).toThrow()
})
