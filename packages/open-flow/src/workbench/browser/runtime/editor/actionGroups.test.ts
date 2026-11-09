import type { AddNodeOption } from './addNodeOptions.ts'

import { expect, it } from 'vitest'
import { groupActionOptions } from './actionGroups.ts'

function action(id: string, operationType?: string): AddNodeOption {
  return {
    id,
    label: id,
    description: '',
    inputs: [],
    outputs: [],
    kind: 'connector',
    connector: { actionId: id, name: id, description: '', serviceId: 'app', serviceName: 'App', authenticated: false, inputs: {}, outputs: {}, operationType },
  }
}

it('orders action categories while preserving catalog order within each group', () => {
  const write = action('write', 'write')
  const read1 = action('read-1', 'read')
  const destructive = action('delete', 'destructive')
  const read2 = action('read-2', 'read')
  const unknown = action('unknown', 'future-operation')
  const missing = action('missing')
  const comment: AddNodeOption = { id: 'comment', label: 'Comment', description: '', inputs: [], outputs: [], kind: 'comment' }
  const provider: AddNodeOption = { ...comment, kind: 'connector-group', serviceId: 'app', choices: [] }
  expect(groupActionOptions([write, read1, unknown, comment, destructive, provider, read2, missing])).toEqual([
    { type: 'read', items: [read1, read2] },
    { type: 'write', items: [write] },
    { type: 'destructive', items: [destructive] },
    { type: 'other', items: [unknown, missing] },
  ])
})

it('omits empty categories from filtered results', () => {
  const read = action('read', 'read')
  expect(groupActionOptions([read])).toEqual([{ type: 'read', items: [read] }])
  expect(groupActionOptions([])).toEqual([])
})

it('keeps Provider request nodes out of Action selection for Code and Agent tools', () => {
  const request: AddNodeOption = {
    id: 'connector-proxy:app',
    kind: 'connector-proxy',
    provider: { serviceId: 'app', serviceName: 'App' },
    label: 'Custom API Request',
    description: '',
    inputs: [],
    outputs: [],
  }
  const read = action('read', 'read')
  expect(groupActionOptions([request, read])).toEqual([{ type: 'read', items: [read] }])
})
