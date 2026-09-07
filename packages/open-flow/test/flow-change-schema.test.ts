import { Validator } from '@cfworker/json-schema'
import { describe, expect, it } from 'vitest'
import { applyFlowChanges, changeOperationsSchema, decodeChangeOperations } from '../src/flow/common/change.ts'

const target = { kind: 'flow' }
const operations = [
  { kind: 'graph.node.create', target, nodeId: 'start', node: { kind: 'manual', name: 'Start' } },
  {
    kind: 'graph.node.create',
    target,
    nodeId: 'pause',
    node: { kind: 'wait', name: 'Pause', inputs: {}, input: { handle: 'value', jsonSchema: {}, nullable: true }, actions: ['continue'], prompt: 'Continue?' },
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

describe('ChangeOperation wire contract', () => {
  it('decodes an atomic creation and mapping batch without changing its meaning', () => {
    const content = { modelVersion: 1 as const, modules: {}, document: { bindings: {}, tasks: {}, subflows: {}, graph: { edges: [], nodes: {} } } }
    expect(applyFlowChanges(content, decodeChangeOperations(operations)).document.graph.nodes.pause).toMatchObject({
      kind: 'wait',
      inputs: { value: operations[3]?.value },
    })
    expect(content.document.graph.nodes).toEqual({})
    expect(decodeChangeOperations(operations)).toEqual(operations)
  })

  it.each(
    [
      [],
      [{ kind: 'unknown' }],
      [{ ...operations[0], extra: true }],
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
