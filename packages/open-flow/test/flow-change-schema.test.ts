import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { Validator } from '@cfworker/json-schema'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { describe, expect, it } from 'vitest'
import { applyFlowChanges, changeOperationsSchema, decodeChangeOperations } from '../src/flow/common/change.ts'
import { decodeFlowDocument } from '../src/flow/common/changeSchema.ts'

const target = { kind: 'flow' }
const operations = [
  { kind: 'graph.node.create', target, nodeId: 'start', node: { kind: 'webhook', name: 'Start', bodyFields: [] } },
  {
    kind: 'graph.node.create',
    target,
    nodeId: 'pause',
    node: { kind: 'wait', name: 'Pause', inputs: {}, inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true }], prompt: 'Continue?' },
  },
  { kind: 'graph.edge.connect', target, edge: { source: 'start', target: 'pause' } },
  {
    kind: 'graph.node.input.set',
    target,
    nodeId: 'pause',
    handle: 'value',
    value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'payload' }] },
  },
]

it.each([
  { kind: 'connector', action: 42, connections: [] },
  { kind: 'connector', action: 'example.echo', connections: [], actionHints: ['example.other'] },
  { kind: 'connector', connectionHints: [{ action: 'example.echo', connectionId: 'connection', extra: true }] },
])('rejects malformed Connector capabilities instead of stripping them: %j', (capability) => {
  const node = { kind: 'task', inputs: {}, task: { name: 'Code', moduleId: 'main', inputs: [], outputs: [], capabilities: [capability] } }
  const operation = { kind: 'graph.node.create', target, nodeId: 'code', node }
  expect(() => decodeChangeOperations([operation])).toThrow()
  expect(new Validator(changeOperationsSchema() as object).validate([operation]).valid).toBe(false)
  expect(() => decodeFlowDocument({ bindings: {}, tasks: {}, subflows: {}, graph: { nodes: { code: node }, edges: [] } })).toThrow()
})

it.each([
  { kind: 'connector', action: 'example.echo', connections: [{ connectionId: 'connection', alias: 'work' }] },
  { kind: 'connector', actionHints: ['example.echo'], connectionHints: [{ action: 'example.echo', connectionId: 'connection' }] },
  { kind: 'connector' },
])('preserves valid Connector capability declarations: %j', (capability) => {
  const operation = {
    kind: 'graph.node.create',
    target,
    nodeId: 'code',
    node: { kind: 'task', inputs: {}, task: { name: 'Code', moduleId: 'main', inputs: [], outputs: [], capabilities: [capability] } },
  }
  expect(decodeChangeOperations([operation])).toEqual([operation])
  expect(new Validator(changeOperationsSchema() as object).validate([operation]).valid).toBe(true)
})

describe('ChangeOperation wire contract', () => {
  it('decodes an atomic creation and mapping batch without changing its meaning', () => {
    const content: RevisionContent = {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: { bindings: {}, tasks: {}, subflows: {}, graph: { edges: [], nodes: {} } },
    }
    expect(applyFlowChanges(content, decodeChangeOperations(operations)).document.graph.nodes.pause).toMatchObject({
      kind: 'wait',
      inputs: { value: operations[3]?.value },
    })
    expect(content.document.graph.nodes).toEqual({})
    expect(decodeChangeOperations(operations)).toEqual(operations)
  })

  it('ignores unknown operation and non-Wait node fields in the decoder and advertised schema', () => {
    const extended = operations.map((operation) => ({
      ...operation,
      extra: true,
      ...(operation.node == null || operation.node.kind == 'wait' ? {} : { node: { ...operation.node, extra: true } }),
    }))
    expect(decodeChangeOperations(extended)).toEqual(operations)
    expect(new Validator(changeOperationsSchema() as object).validate(extended).valid).toBe(true)
  })

  it.each(
    [
      [],
      [{ kind: 'unknown' }],
      [{ ...operations[0], node: { kind: 'manual' } }],
      [{ ...operations[3], value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start' }] } }],
    ].map((value) => [value]),
  )('rejects invalid operations in both decoder and advertised schema', (value) => {
    expect(() => decodeChangeOperations(value)).toThrow()
    expect(new Validator(changeOperationsSchema() as object).validate(value).valid).toBe(false)
  })

  it('publishes a schema that accepts the same complete batch', () => {
    expect(new Validator(changeOperationsSchema() as object).validate(operations).valid).toBe(true)
  })

  it('accepts Approval as a separate node and rejects legacy actions on both resolution nodes', () => {
    const approval = {
      kind: 'graph.node.create',
      target,
      nodeId: 'approval',
      node: { kind: 'approval', inputs: {}, inputDefinitions: [{ handle: 'value', jsonSchema: {}, nullable: true }], prompt: 'Approve?' },
    }
    expect(decodeChangeOperations([approval])).toEqual([approval])
    for (const nodeKind of ['approval', 'wait']) {
      const oldInput = [{ ...approval, node: { ...approval.node, kind: nodeKind, input: { handle: 'value', jsonSchema: {}, nullable: true } } }]
      expect(() => decodeChangeOperations(oldInput)).toThrow()
      const legacy = [{ ...approval, node: { ...approval.node, kind: nodeKind, actions: nodeKind == 'wait' ? ['continue'] : ['approve', 'reject'] } }]
      expect(() => decodeChangeOperations(legacy)).toThrow()
      expect(new Validator(changeOperationsSchema() as object).validate(legacy).valid).toBe(false)
    }
  })
})

it('exposes a small standalone schema for a single operation', () => {
  const schema = changeOperationsSchema('graph.node.input.set')
  expect(new Validator(schema as object).validate(operations[3]).valid).toBe(true)
  expect(new Validator(schema as object).validate(operations[0]).valid).toBe(false)
  expect(() => changeOperationsSchema('invalid')).toThrow(/Unknown operation/)
})

it('rejects a field value with the wrong primitive type', () => {
  const invalid = [{ kind: 'graph.node.field.set', target, nodeId: 'start', field: 'name', before: 'Start', value: 42 }]
  expect(() => decodeChangeOperations(invalid)).toThrow()
  expect(new Validator(changeOperationsSchema() as object).validate(invalid).valid).toBe(false)
})
