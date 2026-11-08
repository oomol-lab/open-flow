import type { JsonValue } from '../src/types/index.ts'

import assert from 'node:assert/strict'
import { test } from 'vitest'
import { connectorActionPorts } from '../src/connector/common/actionSchema.ts'
import { defaultConnection } from '../src/connector/common/model.ts'
import { comparePorts, matchesSchema } from '../src/flow/common/schema.ts'

test('selects the explicit default active Connector connection', () => {
  const active = [
    { displayName: 'Personal', id: 'personal', isDefault: false, service: 'github', status: 'active' },
    { displayName: 'Work', id: 'work', isDefault: true, service: 'github', status: 'active' },
  ] as const
  assert.equal(defaultConnection(active)?.id, 'work')
  assert.equal(defaultConnection([active[0], { ...active[1], status: 'disconnected' }])?.id, 'personal')
  assert.equal(
    defaultConnection([
      { ...active[0], isDefault: false },
      { ...active[1], isDefault: false },
    ]),
    undefined,
  )
})

test('maps Connector action schemas into Designer ports', () => {
  const ports = connectorActionPorts(
    {
      properties: {
        count: { default: 2, type: 'integer' },
        filter: { type: 'string' },
        note: { type: ['string', 'null'] },
        query: { description: 'Search query.', type: 'string' },
      },
      required: ['query'],
      type: 'object',
    },
    {
      properties: { results: { items: { type: 'string' }, type: 'array' } },
      additionalProperties: false,
      required: ['results'],
      type: 'object',
    },
  )

  assert.deepEqual(ports.inputs, [
    { description: undefined, handle: 'count', json_schema: { default: 2, type: 'integer' }, nullable: true, value: 2 },
    { description: undefined, handle: 'filter', json_schema: { type: 'string' }, nullable: true, value: null },
    { description: undefined, handle: 'note', json_schema: { type: ['string', 'null'] }, nullable: true, value: null },
    { description: 'Search query.', handle: 'query', json_schema: { description: 'Search query.', type: 'string' }, nullable: false, value: undefined },
  ])
  assert.deepEqual(ports.initialInputs, [
    { handle: 'count', value: 2 },
    { handle: 'filter', value: null },
    { handle: 'note', value: null },
  ])
  assert.deepEqual(ports.outputs, [{ description: undefined, handle: 'results', json_schema: { items: { type: 'string' }, type: 'array' }, nullable: false }])
})

test.each(['$defs', 'definitions'])('keeps %s references usable in standalone Connector ports', (definitions) => {
  const schema = {
    type: 'object',
    properties: { name: { $ref: `#/${definitions}/name` } },
    [definitions]: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  }
  const ports = connectorActionPorts(schema, schema)
  for (const port of [...ports.inputs, ...ports.outputs]) {
    const selected = { jsonSchema: port.json_schema as JsonValue, nullable: port.nullable }
    assert.deepEqual(comparePorts(selected, { jsonSchema: { type: 'string' }, nullable: false }), { kind: 'compatible' })
    assert.equal(matchesSchema('Ada', selected.jsonSchema), true)
    assert.equal(matchesSchema(42, selected.jsonSchema), false)
  }
})

test('exposes complete dynamic responses without confusing a declared output field', () => {
  for (const schema of [
    { type: 'object' },
    { type: 'object', properties: {}, additionalProperties: true },
    { type: 'object', properties: { output: { type: 'string' } }, additionalProperties: true },
    { type: 'object', properties: { output: { type: 'string' } } },
    { type: 'array', items: {} },
  ]) {
    assert.deepEqual(connectorActionPorts({ type: 'object' }, schema).outputs, [
      { description: undefined, handle: 'output', json_schema: schema, nullable: false },
    ])
  }
  assert.deepEqual(connectorActionPorts({ type: 'object' }, { type: 'object', additionalProperties: false }).outputs, [])
  assert.deepEqual(
    connectorActionPorts({ type: 'object' }, { type: 'object', properties: { output: { type: 'string' } }, required: ['output'], additionalProperties: false })
      .outputs,
    [{ description: undefined, handle: 'output', json_schema: { type: 'string' }, nullable: false }],
  )
})
