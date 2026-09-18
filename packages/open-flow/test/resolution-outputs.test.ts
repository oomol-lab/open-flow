import type { ResolutionNode } from '../src/flow/common/change.ts'

import { expect, it } from 'vitest'
import { normalizeWaitComment } from '../src/execution/common/wait.ts'
import { resolutionOutputPorts } from '../src/flow/common/graph.ts'
import { matchesSchema } from '../src/flow/common/schema.ts'

it.each(['wait', 'approval'] as const)('declares fixed %s outputs with named, untyped input values', (kind) => {
  const node: ResolutionNode = {
    kind,
    prompt: 'Ready?',
    inputs: {},
    inputDefinitions: [
      { handle: 'orderId', jsonSchema: { type: 'string' }, nullable: false },
      { handle: 'amount', jsonSchema: { type: 'number' }, nullable: false },
    ],
  }
  const ports = resolutionOutputPorts(node)
  const inputs = { orderId: 42, amount: 'untyped at the output boundary' }
  const urls: Record<string, string> =
    kind == 'wait' ? { continueUrl: 'https://example.com/continue' } : { approveUrl: 'https://example.com/approve', rejectUrl: 'https://example.com/reject' }
  const pending = { inputs, prompt: 'Ready?', ...urls, expiresAt: '2030-01-01T00:00:00.000Z' }
  expect(ports.pending?.nullable).toBe(false)
  expect(matchesSchema(pending, ports.pending!.jsonSchema)).toBe(true)
  expect(matchesSchema(null, ports.pending!.jsonSchema)).toBe(false)
  expect(matchesSchema({ ...pending, inputs: { orderId: 'missing amount' } }, ports.pending!.jsonSchema)).toBe(false)
  expect(matchesSchema({ ...pending, inputs: { ...inputs, extra: 1 } }, ports.pending!.jsonSchema)).toBe(false)
  expect(matchesSchema({ ...pending, actions: [] }, ports.pending!.jsonSchema)).toBe(false)
  for (const action of kind == 'wait' ? ['continue'] : ['approve', 'reject']) {
    const port = ports[action]!
    expect(port.nullable).toBe(false)
    const output = { inputs, action, resolvedAt: '2026-09-18T08:30:00.000Z', comment: null }
    expect(matchesSchema(output, port.jsonSchema)).toBe(true)
    expect(matchesSchema({ ...output, comment: 'Reviewed' }, port.jsonSchema)).toBe(true)
    expect(matchesSchema({ ...output, action: 'other' }, port.jsonSchema)).toBe(false)
  }
})

it('supports no configured inputs', () => {
  const ports = resolutionOutputPorts({ kind: 'wait', inputs: {}, inputDefinitions: [], prompt: 'Continue?' })
  expect(matchesSchema({ inputs: {}, action: 'continue', resolvedAt: '2026-09-18T08:30:00.000Z', comment: null }, ports.continue!.jsonSchema)).toBe(true)
})

it('normalizes comments and counts Unicode code points', () => {
  expect(normalizeWaitComment()).toBeNull()
  expect(normalizeWaitComment(' \n ')).toBeNull()
  expect(normalizeWaitComment('  Reviewed\nThanks  ')).toBe('Reviewed\nThanks')
  expect(normalizeWaitComment('🙂'.repeat(2000))).toHaveLength(4000)
  expect(() => normalizeWaitComment('🙂'.repeat(2001))).toThrow('2,000')
})
