import type { RunEvent } from '@oomol-lab/open-flow/control-api'
import type { createMocks } from './mocks.ts'
import type { Sample } from './scenarios.ts'

import { isDeepStrictEqual } from 'node:util'
type Calls = ReturnType<typeof createMocks>['calls']
/** Runtime expectations are independent of the reference program and editing strategy. */
export function runtimeAssertions(id: string, sample: Sample, status: string, calls: Calls, modelCalls: unknown[], events: readonly RunEvent[]): string[] {
  const errors: string[] = []
  if (sample.failure) {
    if (
      status != 'failed' ||
      !events.some((e) => e.kind == 'node.failed' && e.payload.nodeId == 'format' && e.payload.error.message.includes('Order list is required'))
    )
      errors.push('Missing orders must fail at the formatter with the original missing-list error.')
    return errors
  }
  if (status != 'completed') return [`Run ${sample.name} ended ${status}.`]
  if (id == 'order-alert') {
    const orders = calls.filter((c) => c.action == 'lab-orders.list'),
      notifications = calls.filter((c) => c.action == 'lab-notifications.send')
    if (orders.length != 1 || orders[0]?.connection != 'orders-test') errors.push('Query orders exactly once using Orders test account.')
    if (
      sample.notification == null
        ? notifications.length != 0
        : notifications.length != 1 || notifications[0]?.input.text != sample.notification || notifications[0]?.connection != 'notifications-test'
    )
      errors.push(`Wrong notification for ${sample.name}.`)
    if (calls.length != orders.length + notifications.length) errors.push('Unexpected external actions.')
  }
  if (id == 'customer-redaction') {
    const notifications = calls.filter((c) => c.action == 'lab-notifications.send-json'),
      archives = calls.filter((c) => c.action == 'lab-archive.save')
    if (
      notifications.length != 1 ||
      notifications[0]?.connection != 'notifications-test' ||
      !isDeepStrictEqual(notifications[0]?.input.payload, { orderId: 'O-17', total: 125 })
    )
      errors.push('Customer data was not correctly redacted.')
    if (archives.length != 1 || archives[0]?.connection != 'archive-test' || !isDeepStrictEqual(archives[0]?.input.payload, sample.order))
      errors.push('The original internal archive changed.')
    if (calls.length != 3) errors.push('Unexpected external calls.')
  }
  if (id.startsWith('specialize-summary')) {
    const customer = modelCalls.filter((c) => JSON.stringify(c).includes('Customer audience:')),
      internal = modelCalls.filter((c) => JSON.stringify(c).includes('Internal audience:'))
    if (customer.length != 1 || !JSON.stringify(customer[0]).includes('Exclude internal cost breakdown.'))
      errors.push('Customer model request has the wrong instruction.')
    if (internal.length != 1 || !JSON.stringify(internal[0]).includes('Include internal cost breakdown.')) errors.push('Internal model request changed.')
  }
  if (id == 'repair-amount' && !events.some((e) => e.kind == 'node.completed' && e.payload.nodeId == 'format' && e.payload.outputs.text == sample.formatted))
    errors.push(`Wrong formatted amount for ${sample.name}.`)
  if (id == 'concurrent-edit' && (calls.length != 1 || calls[0]?.input.text != 'Order received' || calls[0]?.connection != 'notifications-test'))
    errors.push('Wrong notification after conflict recovery.')
  return errors
}
