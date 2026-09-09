import type { NodeContent } from './nodeContent.ts'

import { expect, it } from 'vitest'
import { portSchema } from './nodeContent.ts'

it('reads named ports without treating group labels or execution handles as data ports', () => {
  const node: NodeContent = {
    id: 'task',
    kind: 'task',
    title: 'Task',
    reference: 'task',
    inputs: [{ group: 'Request' }, { handle: 'count', jsonSchema: { type: 'number' } }],
    outputs: [{ handle: 'count', jsonSchema: { type: 'string' } }],
  }
  expect(portSchema(node, 'input', 'count')).toEqual({ type: 'number' })
  expect(portSchema(node, 'output', 'count')).toEqual({ type: 'string' })
  expect(portSchema(node, 'input', 'Request')).toBeUndefined()
  expect(portSchema(node, 'output', '$out')).toBeUndefined()
  expect(portSchema(undefined, 'input', 'count')).toBeUndefined()
})

it('uses Value fields for both ends of data connections', () => {
  const node: NodeContent = {
    id: 'value',
    kind: 'value',
    title: 'Value',
    inputs: [],
    outputs: [],
    values: [{ handle: 'items', jsonSchema: { type: 'array' }, value: [] }],
  }
  expect(portSchema(node, 'input', 'items')).toEqual({ type: 'array' })
  expect(portSchema(node, 'output', 'items')).toEqual({ type: 'array' })
})
