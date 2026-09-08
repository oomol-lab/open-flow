import { describe, expect, it } from 'vitest'
import { mcpTools } from '../src/control/common/mcp.ts'
import { controlRequests, controlRequestSchema } from '../src/control/common/requests.ts'

const samples = {
  createFlow: { name: 'Flow', version: 1 },
  renameFlow: { name: 'Flow', version: 1 },
  changeDraft: {
    expectedRevisionId: 'r1',
    operations: [{ kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'start', node: { kind: 'manual', name: 'Start' } }],
    version: 1,
  },
  setEnabled: { enabled: false, expectedPublicationId: 'p1', version: 1 },
  updatePresentation: { expectedRevision: 1, value: {}, version: 1 },
  checkFlow: { engineContract: 'open-flow-engine/v2', version: 1 },
  publishFlow: { engineContract: 'open-flow-engine/v2', expectedLivePublicationId: null, version: 1 },
  rollbackFlow: { expectedLivePublicationId: 'p1', version: 1 },
  createDraftRun: { engineContract: 'open-flow-engine/v2', inputs: {}, trigger: { nodeId: 'start', payload: null }, version: 1 },
  createLiveRun: { publicationId: 'p1', inputs: {}, trigger: { nodeId: 'start', payload: {} }, version: 1 },
  resolveWait: { action: 'continue', version: 1 },
  putVariable: { value: '' },
  versionOnly: { version: 1 },
} satisfies Record<keyof typeof controlRequests, unknown>

describe('Control request boundaries', () => {
  for (const name of Object.keys(samples) as (keyof typeof samples)[]) {
    it(`decodes ${name} and rejects unknown fields and unsupported versions`, () => {
      expect(controlRequests[name](samples[name])).toEqual(samples[name])
      expect(controlRequestSchema(name)).toHaveProperty('additionalProperties', false)
      expect(() => controlRequests[name]({ ...samples[name], extra: true })).toThrow()
      expect(() => controlRequests[name]({ ...samples[name], version: 2 })).toThrow()
    })
  }
  it('rejects malformed Trigger payloads, input maps and operations before admission', () => {
    const sample = samples.createDraftRun
    for (const trigger of [undefined, null, {}, { nodeId: 'start' }, { nodeId: 'start', payload: {}, extra: true }]) {
      expect(() => controlRequests.createDraftRun({ ...sample, trigger })).toThrow()
    }
    expect(() => controlRequests.createDraftRun({ ...sample, inputs: { start: 3 } })).toThrow()
    expect(() => controlRequests.changeDraft({ ...samples.changeDraft, operations: [{ kind: 'unknown' }] })).toThrow()
    expect(() => controlRequests.putVariable({ value: '雪'.repeat(21_846) })).toThrow()
    expect(() => controlRequests.createFlow({ name: ' Flow ', version: 1 })).toThrow()
  })
})

it('validates MCP defaults without accepting extra arguments', () => {
  expect(mcpTools.flow_list.inputSchema['~standard'].validate({})).toEqual({ value: { limit: 50 } })
  expect(mcpTools.run_events.inputSchema['~standard'].validate({ runId: 'r1' })).toEqual({ value: { runId: 'r1', after: 0, limit: 50 } })
  expect(mcpTools.flow_get.inputSchema['~standard'].validate({ flowId: 'f1', tenant: 'other' })).toHaveProperty('issues')
  expect(mcpTools.flow_create.inputSchema['~standard'].validate({ name: 'Flow', idempotencyKey: '' })).toHaveProperty('issues')
})
