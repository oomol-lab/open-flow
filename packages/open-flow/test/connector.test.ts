import assert from 'node:assert/strict'
import { test } from 'vitest'
import { connectorActionIcon, connectorActionNode, connectorActionTitle, connectorNodeId } from '../src/connector/common/actionNode.ts'
import { connectorActionPorts } from '../src/connector/common/actionSchema.ts'
import { defaultConnection } from '../src/connector/common/model.ts'

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

test('creates a Connector Designer node with stable title and icon behavior', () => {
  const action = {
    actionId: 'gmail.send_email',
    homepageUrl: 'https://mail.google.com/',
    inputSchema: { type: 'object' },
    name: 'send_email',
    outputSchema: { type: 'object' },
    service: 'gmail',
  }

  assert.equal(connectorActionTitle(action.name), 'Send Email')
  assert.match(connectorActionIcon(action) ?? '', /domain=mail.google.com/)
  assert.deepEqual(connectorActionNode(action, 'connection-1', connectorNodeId('gmail_send_email')).task, {
    executor: { name: 'connector', options: { action: 'gmail.send_email', connection: 'connection-1' } },
    inputs_def: [],
    outputs_def: [],
  })
  const unconnected = connectorActionNode(action, undefined, connectorNodeId('gmail_send_email')).task
  if (typeof unconnected == 'string') throw new Error('Expected an inline Connector Task.')
  assert.deepEqual(unconnected.executor, {
    name: 'connector',
    options: { action: 'gmail.send_email' },
  })
})
