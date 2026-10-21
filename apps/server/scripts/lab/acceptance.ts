import type { RunEvent } from '@oomol-lab/open-flow/control-api'
import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'
import type { createMocks } from './mocks.ts'
import type { Sample } from './scenarios.ts'

import { isDeepStrictEqual } from 'node:util'
type Calls = ReturnType<typeof createMocks>['calls']
/** Runtime expectations are independent of the reference program and editing strategy. */
export function runtimeAssertions(
  id: string,
  sample: Sample,
  status: string,
  calls: Calls,
  modelCalls: unknown[],
  events: readonly RunEvent[],
  content: RevisionContent,
): string[] {
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
  if (id == 'node-errors') {
    const terminal = events.findLast((event) => event.kind == 'run.completed')
    const result = terminal?.kind == 'run.completed' ? terminal.payload.result : undefined
    const output = result != null && typeof result == 'object' && 'outputs' in result ? result.outputs : undefined
    const failure = output != null && typeof output == 'object' && 'failure' in output ? output.failure : undefined
    const failedId = Object.entries(content.document.graph.nodes).find(([, node]) => node.name == 'Failed task')?.[0]
    if (
      output == null ||
      typeof output != 'object' ||
      !('business' in output) ||
      !('successError' in output) ||
      output.business != 'business' ||
      output.successError !== null ||
      failure == null ||
      typeof failure != 'object' ||
      Array.isArray(failure) ||
      !('code' in failure) ||
      !('message' in failure) ||
      !('nodeId' in failure) ||
      !('nodeName' in failure) ||
      !('runId' in failure) ||
      !('executionId' in failure) ||
      failure.code != 'node.failed' ||
      failure.message != 'Expected failure' ||
      failure.nodeId != failedId ||
      typeof failure.nodeName != 'string' ||
      typeof failure.runId != 'string' ||
      typeof failure.executionId != 'string' ||
      events.filter((event) => event.kind == 'node.failed' && event.payload.nodeId == failedId && event.payload.handled === true).length != 1 ||
      calls.length ||
      modelCalls.length
    )
      errors.push('Preserve the business error field, output null on success and handle the failed task once with a complete system error.')
  }
  if (id == 'node-retries') {
    const tasks = ['Retried task updated', 'Cleared task'].map(
      (name) => Object.entries(content.document.graph.nodes).find(([, node]) => node.kind == 'task' && 'moduleId' in node.task && node.name == name)?.[0],
    )
    const completions = events.filter((event) => event.kind == 'node.completed')
    if (
      tasks.some((nodeId) => {
        const completed = completions.filter((event) => event.payload.nodeId == nodeId)
        return nodeId == null || completed.length != 1 || !isDeepStrictEqual(completed[0]!.payload.outputs, { value: 42 })
      }) ||
      calls.length ||
      modelCalls.length
    )
      errors.push('Execute both configured tasks once without external calls.')
  }
  if (id == 'workflow-call') {
    const terminal = events.findLast((event) => event.kind == 'run.completed')
    const result = terminal?.kind == 'run.completed' ? terminal.payload.result : undefined
    if (
      result == null ||
      typeof result != 'object' ||
      Array.isArray(result) ||
      !('outputs' in result) ||
      !isDeepStrictEqual(result.outputs, { total: Number(sample.outputs?.amount) * 2 })
    )
      errors.push('Return the called workflow business output.')
    if (events.some((event) => event.kind == 'node.log')) errors.push('Child logs must remain in the child Run.')
    if (!events.some((event) => event.kind == 'node.started' && event.payload.nodeKind == 'workflow')) errors.push('Execute the workflow call node.')
  }
  if (id == 'workflow-outputs') {
    const terminal = events.findLast((event) => event.kind == 'run.completed')
    const result = terminal?.kind == 'run.completed' ? terminal.payload.result : undefined
    const expected = { total: Number(sample.outputs?.amount) * 2, message: sample.outputs?.message, note: sample.outputs?.note ?? null }
    if (result == null || typeof result != 'object' || Array.isArray(result) || !('outputs' in result) || !isDeepStrictEqual(result.outputs, expected))
      errors.push('Return the computed workflow business outputs.')
    if (!events.some((event) => event.kind == 'node.completed' && isDeepStrictEqual(event.payload.outputs, { logged: true })))
      errors.push('Preserve the independent branch result.')
    if (!events.some((event) => event.kind == 'node.started' && event.payload.nodeKind == 'outputs')) errors.push('Execute Outputs as an ordinary node.')
    if (calls.length || modelCalls.length) errors.push('No external calls are needed.')
  }
  if (id == 'start-parameters') {
    const archived = calls.find((call) => call.action == 'lab-archive.save')
    if (
      calls.length !== 1 ||
      archived?.connection !== 'archive-test' ||
      !isDeepStrictEqual(archived?.input.payload, { ...sample.outputs, note: sample.outputs?.note ?? null })
    )
      errors.push('Archive the supplied Start parameters unchanged, with omitted notes normalized to null.')
  }
  if (id == 'connector-responses') {
    const archives = calls.filter((call) => call.action == 'lab-archive.save')
    if (
      calls.length != 3 ||
      calls.filter((call) => call.action == 'lab-data.dynamic' && call.connection == 'marketplace:oomol:lab-data').length != 1 ||
      calls.filter((call) => call.action == 'lab-data.cells' && call.connection == 'marketplace:oomol:lab-data').length != 1
    )
      errors.push('Read both Connector responses exactly once using Data test account.')
    if (
      archives.length != 1 ||
      archives[0]?.connection != 'archive-test' ||
      !isDeepStrictEqual(archives[0]?.input.payload, { dynamic: { output: 'preserved', rows: sample.orders }, values: sample.orders })
    )
      errors.push('Archive the complete dynamic response and unchanged spreadsheet cells.')
  }
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
