import type { RunEvent } from '@oomol-lab/open-flow/control-api'
import type { createMocks, MockModelCall } from '../scripts/lab/mocks.ts'

import { describe, expect, it } from 'vitest'
import { fulfillmentSamples } from '../scripts/lab/fulfillment.ts'
import { fulfillmentRuntimeAssertions } from '../scripts/lab/fulfillmentAcceptance.ts'

type Calls = ReturnType<typeof createMocks>['calls']
const summary = { count: 2, orderIds: ['F-101', 'F-102'], total: '160.50' }
function managerRun() {
  const sample = fulfillmentSamples(2).find((item) => item.name == 'daily')!
  const modelCalls: MockModelCall[] = [
    {
      request: { model: 'lab-model', messages: [{ role: 'user', content: `Do not promise delivery dates.\n${JSON.stringify(summary)}` }], tools: [] },
      response: { text: 'A distinct model response for this request.' },
    },
  ]
  const calls: Calls = [
    { action: 'lab-orders.batch', connection: 'orders-test', input: { batch: 'daily' }, invocationId: 'query' },
    {
      action: 'lab-archive.save',
      connection: 'archive-test',
      input: { payload: { batch: 'daily', orderCount: 5, paidTotal: '260.50' } },
      invocationId: 'archive',
    },
    { action: 'lab-notifications.send', connection: 'notifications-test', input: { text: modelCalls[0]!.response.text }, invocationId: 'notify' },
    {
      action: 'lab-supplier.expedite',
      connection: 'supplier-test',
      input: {
        payload: [
          { orderId: 'F-101', sku: 'DESK-LAMP', quantity: 2 },
          { orderId: 'F-102', sku: 'USB-HUB', quantity: 1 },
        ],
      },
      invocationId: 'supplier',
    },
  ]
  return { sample, calls, modelCalls, verify: () => fulfillmentRuntimeAssertions(2, sample, 'completed', calls, modelCalls, []) }
}

describe('fulfillment journey independent acceptance', () => {
  it('accepts a manager summary forwarded from the recorded model response', () => {
    expect(managerRun().verify()).toEqual([])
  })

  it.each([0, 1, 2, 3])('rejects a wrong account for external call %i', (index) => {
    const run = managerRun()
    run.calls[index]!.connection = 'production-account'
    expect(run.verify().length).toBeGreaterThan(0)
  })

  it('rejects source customer fields sent alongside the correct summary to the model', () => {
    const run = managerRun()
    run.modelCalls[0]!.request.messages = [
      { role: 'user', content: `Do not promise delivery dates.\n${JSON.stringify(summary)}\n{"email":"ada@example.test"}` },
    ]
    expect(run.verify()).toContain('Private order fields reached the model request.')
  })

  it('rejects a supplier payload containing private fields', () => {
    const run = managerRun()
    run.calls[3]!.input = {
      payload: [
        { orderId: 'F-101', sku: 'DESK-LAMP', quantity: 2, email: 'ada@example.test' },
        { orderId: 'F-102', sku: 'USB-HUB', quantity: 1 },
      ],
    }
    expect(run.verify().some((error) => error.includes('Supplier test account'))).toBe(true)
  })

  it('rejects a canned notification even when a valid model request was made', () => {
    const run = managerRun()
    run.calls[2]!.input = { text: 'Lab summary: 3 updates.' }
    expect(run.verify().some((error) => error.includes('actual model response'))).toBe(true)
  })

  it('rejects a model request that omits the prompt rule or exposes an external tool', () => {
    const run = managerRun()
    run.modelCalls[0]!.request.messages = [{ role: 'user', content: JSON.stringify(summary) }]
    run.modelCalls[0]!.request.tools = [{ function: { name: 'send_notification' } }]
    expect(run.verify()).toEqual(
      expect.arrayContaining([
        'The actual lab-model request must contain the correct redacted summary and the required delivery-date instruction.',
        'The manager summary must not expose external tools to the model.',
      ]),
    )
  })

  it('rejects filtering out paid shipped orders from the archive', () => {
    const run = managerRun()
    run.calls[1]!.input = { payload: { batch: 'daily', orderCount: 5, paidTotal: '160.50' } }
    expect(run.verify().some((error) => error.includes('paid shipped orders'))).toBe(true)
  })

  it('requires a failed malformed-data run with no write or model request', () => {
    const sample = fulfillmentSamples(3).find((item) => item.name == 'invalid-amount')!
    const calls: Calls = [{ action: 'lab-orders.batch', connection: 'orders-test', input: { batch: 'invalid-amount' }, invocationId: 'query' }]
    const events: RunEvent[] = [
      {
        sequence: 1,
        createdAt: 'now',
        kind: 'node.failed',
        payload: {
          executionId: 'e',
          flowId: 'f',
          nodeId: 'arbitrary-validation-node',
          scopeId: 's',
          error: { code: 'task.failed', message: 'Invalid amount' },
        },
      },
    ]
    expect(fulfillmentRuntimeAssertions(3, sample, 'failed', calls, [], events)).toEqual([])
    expect(fulfillmentRuntimeAssertions(3, sample, 'completed', calls, [], events).length).toBeGreaterThan(0)
    calls.push(managerRun().calls[1]!)
    expect(fulfillmentRuntimeAssertions(3, sample, 'failed', calls, [], events)).toContain(
      'Reject invalid upstream data before every external write and model request.',
    )
    calls.pop()
    expect(fulfillmentRuntimeAssertions(3, sample, 'failed', calls, managerRun().modelCalls, events)).toContain(
      'Reject invalid upstream data before every external write and model request.',
    )
  })

  it('rejects an obsolete inclusive-SLA notification at the final stage boundary', () => {
    const sample = fulfillmentSamples(3).find((item) => item.name == 'boundary')!
    const calls: Calls = [
      { action: 'lab-orders.batch', connection: 'orders-test', input: { batch: 'boundary' }, invocationId: 'q' },
      {
        action: 'lab-archive.save',
        connection: 'archive-test',
        input: { payload: { batch: 'boundary', orderCount: 1, paidTotal: '12.50' } },
        invocationId: 'a',
      },
    ]
    expect(fulfillmentRuntimeAssertions(3, sample, 'completed', calls, [], [])).toEqual([])
    calls.push(managerRun().calls[2]!)
    expect(fulfillmentRuntimeAssertions(3, sample, 'completed', calls, [], []).length).toBeGreaterThan(0)
  })
})
