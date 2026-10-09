import type { RunEvent } from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { FulfillmentSample } from './fulfillment.ts'
import type { createMocks, MockModelCall } from './mocks.ts'

import { isDeepStrictEqual } from 'node:util'

type Calls = ReturnType<typeof createMocks>['calls']
type Sample = Pick<FulfillmentSample, 'name' | 'orders' | 'failure'> & { parameters?: Record<string, JsonValue> }
type Expected = {
  archive: { batch: string; orderCount: number; paidTotal: string }
  summary?: { count: number; orderIds: string[]; total: string }
  supplier?: { orderId: string; sku: string; quantity: number }[]
}

// Explicit business expectations; no copy of the workflow or reference solution's transformation.
const dailyArchive = { batch: 'daily', orderCount: 5, paidTotal: '260.50' }
const emptyArchive = { batch: 'empty', orderCount: 0, paidTotal: '0.00' }
const boundaryArchive = { batch: 'boundary', orderCount: 1, paidTotal: '12.50' }
const dailyOverdue = {
  archive: dailyArchive,
  summary: { count: 2, orderIds: ['F-101', 'F-102'], total: '160.50' },
  supplier: [
    { orderId: 'F-101', sku: 'DESK-LAMP', quantity: 2 },
    { orderId: 'F-102', sku: 'USB-HUB', quantity: 1 },
  ],
}
const inclusive: Record<string, Expected> = {
  'daily': dailyOverdue,
  'empty': { archive: emptyArchive },
  'boundary': {
    archive: boundaryArchive,
    summary: { count: 1, orderIds: ['F-201'], total: '12.50' },
    supplier: [{ orderId: 'F-201', sku: 'ADAPTER', quantity: 1 }],
  },
  'longer-sla': {
    archive: dailyArchive,
    summary: { count: 1, orderIds: ['F-101'], total: '120.50' },
    supplier: [{ orderId: 'F-101', sku: 'DESK-LAMP', quantity: 2 }],
  },
}
const expectedStages: Record<string, Expected>[] = [
  {
    daily: { archive: dailyArchive },
    empty: { archive: emptyArchive },
    fresh: { archive: { batch: 'fresh', orderCount: 3, paidTotal: '19.99' } },
  },
  inclusive,
  inclusive,
  {
    daily: {
      archive: dailyArchive,
      summary: { count: 1, orderIds: ['F-101'], total: '120.50' },
      supplier: [{ orderId: 'F-101', sku: 'DESK-LAMP', quantity: 2 }],
    },
    boundary: { archive: boundaryArchive },
    empty: { archive: emptyArchive },
    migrated: {
      archive: { batch: 'migrated', orderCount: 4, paidTotal: '100.00' },
      summary: { count: 3, orderIds: ['F-401', 'F-402', 'F-403'], total: '20.00' },
      supplier: [
        { orderId: 'F-401', sku: 'BAG', quantity: 1 },
        { orderId: 'F-402', sku: 'GIFT', quantity: 1 },
        { orderId: 'F-403', sku: 'PART', quantity: 3 },
      ],
    },
  },
]

function messageTexts(messages: unknown): string[] {
  if (!Array.isArray(messages)) return []
  return messages.flatMap((message: unknown) => {
    if (message == null || typeof message != 'object' || !('content' in message)) return []
    if (typeof message.content == 'string') return [message.content]
    if (!Array.isArray(message.content)) return []
    return message.content.flatMap((part: unknown) =>
      part != null && typeof part == 'object' && 'text' in part && typeof part.text == 'string' ? [part.text] : [],
    )
  })
}

/** Locate JSON supplied in a free-form prompt without prescribing wording, whitespace or key order. */
function containsObject(texts: string[], value: unknown): boolean {
  for (const text of texts) {
    for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
      for (let end = text.indexOf('}', start); end >= 0; end = text.indexOf('}', end + 1)) {
        try {
          if (isDeepStrictEqual(JSON.parse(text.slice(start, end + 1)), value)) return true
        } catch {
          // Instructions and other non-JSON fragments may contain braces.
        }
      }
    }
  }
  return false
}

function privateDataPresent(texts: string[], orders: JsonValue): boolean {
  const text = texts.join('\n')
  if (/"(?:email|internalCost|sku|quantity|ageHours|fulfillment|status|amount|orderId)"\s*:/.test(text)) return true
  if (!Array.isArray(orders)) return false
  return orders.some((order) =>
    order != null && typeof order == 'object' && !Array.isArray(order)
      ? [order.email, order.sku].some((value) => typeof value == 'string' && text.includes(value))
      : false,
  )
}

export function fulfillmentRuntimeAssertions(
  stage: number,
  sample: Sample,
  status: string,
  calls: Calls,
  modelCalls: unknown[],
  events: readonly RunEvent[],
): string[] {
  const errors: string[] = []
  const queries = calls.filter((call) => call.action == 'lab-orders.batch')
  if (queries.length != 1 || queries[0]?.connection != 'orders-test' || !isDeepStrictEqual(queries[0]?.input, { batch: sample.parameters?.batch }))
    errors.push('Query the requested batch exactly once using Orders test account.')
  if (sample.failure) {
    if (status != 'failed' || !events.some((event) => event.kind == 'node.failed')) errors.push(`${sample.name} must fail with a node-level error.`)
    if (calls.length != 1 || modelCalls.length != 0) errors.push('Reject invalid upstream data before every external write and model request.')
    return errors
  }
  const expected = expectedStages[stage]?.[sample.name]
  if (expected == null) return [...errors, `No independent expectation for fulfillment stage ${stage}, sample ${sample.name}.`]
  if (status != 'completed') errors.push(`Run ${sample.name} ended ${status}.`)
  const archives = calls.filter((call) => call.action == 'lab-archive.save')
  if (archives.length != 1 || archives[0]?.connection != 'archive-test' || !isDeepStrictEqual(archives[0]?.input, { payload: expected.archive }))
    errors.push('Archive exactly the complete batch report using Archive test account, including paid shipped orders.')
  const notifications = calls.filter((call) => call.action.startsWith('lab-notifications.'))
  const suppliers = calls.filter((call) => call.action == 'lab-supplier.expedite')
  if (expected.summary == null) {
    if (notifications.length != 0 || suppliers.length != 0 || modelCalls.length != 0)
      errors.push('This batch must not notify, request supplier fulfillment or call a model.')
  } else if (stage == 1) {
    if (
      notifications.length != 1 ||
      notifications[0]?.action != 'lab-notifications.send-json' ||
      notifications[0]?.connection != 'notifications-test' ||
      !isDeepStrictEqual(notifications[0]?.input, { payload: expected.summary })
    )
      errors.push('Send exactly the redacted overdue JSON summary through Notifications test account.')
    if (suppliers.length != 0 || modelCalls.length != 0) errors.push('Supplier and model calls are not requested at this stage.')
  } else {
    if (suppliers.length != 1 || suppliers[0]?.connection != 'supplier-test' || !isDeepStrictEqual(suppliers[0]?.input, { payload: expected.supplier }))
      errors.push('Send exactly the overdue {orderId,sku,quantity} records through Supplier test account in input order.')
    if (modelCalls.length != 1) errors.push('Generate exactly one manager summary for this overdue batch.')
    const call = modelCalls[0] as MockModelCall | undefined
    const request = call?.request
    const texts = messageTexts(request?.messages)
    if (request?.model != 'lab-model' || !texts.some((text) => text.includes('Do not promise delivery dates.')) || !containsObject(texts, expected.summary))
      errors.push('The actual lab-model request must contain the correct redacted summary and the required delivery-date instruction.')
    if (privateDataPresent(texts, sample.orders)) errors.push('Private order fields reached the model request.')
    if (request?.tools?.some((tool) => !['read_result', 'run_code'].includes(tool.function?.name ?? '')))
      errors.push('The manager summary must not expose external tools to the model.')
    const reply = call?.response.text
    if (
      notifications.length != 1 ||
      notifications[0]?.action != 'lab-notifications.send' ||
      notifications[0]?.connection != 'notifications-test' ||
      !isDeepStrictEqual(notifications[0]?.input, { text: reply })
    )
      errors.push('Send the actual model response as one text notification using Notifications test account.')
  }
  if (calls.length != queries.length + archives.length + notifications.length + suppliers.length) errors.push('Unexpected external actions.')
  return errors
}
