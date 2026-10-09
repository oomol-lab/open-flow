import type { ConnectorActionMetadata, ConnectorConnection } from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorHost } from '../../node/deployment/connector.ts'

import { Hono } from 'hono'
import { createHash } from 'node:crypto'
import { fulfillmentBatches } from './fulfillment.ts'

const data = { jsonSchema: {}, nullable: true } as const
const text = { jsonSchema: { type: 'string' }, nullable: false } as const
export const actions: ConnectorActionMetadata[] = [
  {
    actionId: 'lab-orders.batch',
    name: 'List fulfillment batch',
    description:
      'Retrieve a named fulfillment batch. Input batch is a string (daily, empty, fresh, boundary, migrated, invalid-amount, missing-orders). Output orders contains records with orderId:string, status:paid|cancelled|refunded, fulfillment:pending|shipped, ageHours:number, amount:number|decimal-string|null, sku:string, quantity:number, email:string and internalCost:number. Invalid upstream batches can contain invalid amounts or omit orders; consumers must validate them before external writes.',
    serviceId: 'lab-orders',
    serviceName: 'Lab Orders',
    authenticated: true,
    inputs: { batch: text },
    outputs: { orders: data, batch: text },
  },
  {
    actionId: 'lab-orders.list',
    name: 'List orders',
    description: 'List orders with amounts and original order details.',
    serviceId: 'lab-orders',
    serviceName: 'Lab Orders',
    authenticated: true,
    inputs: {},
    outputs: { orders: data, order: data },
  },
  {
    actionId: 'lab-orders.customers',
    name: 'List customers',
    description: 'Customer directory; does not list orders.',
    serviceId: 'lab-orders',
    serviceName: 'Lab Orders',
    authenticated: true,
    inputs: {},
    outputs: { customers: data },
  },
  {
    actionId: 'lab-notifications.send',
    name: 'Send notification',
    description: 'Send text to a notification account.',
    serviceId: 'lab-notifications',
    serviceName: 'Lab Notifications',
    authenticated: true,
    inputs: { text },
    outputs: {},
  },
  {
    actionId: 'lab-notifications.send-json',
    name: 'Send JSON notification',
    description: 'Send structured data to a notification account.',
    serviceId: 'lab-notifications',
    serviceName: 'Lab Notifications',
    authenticated: true,
    inputs: { payload: data },
    outputs: {},
  },
  {
    actionId: 'lab-archive.save',
    name: 'Archive order',
    description: 'Store original order data internally.',
    serviceId: 'lab-archive',
    serviceName: 'Lab Archive',
    authenticated: true,
    inputs: { payload: data },
    outputs: {},
  },
  {
    actionId: 'lab-supplier.expedite',
    name: 'Request supplier fulfillment',
    description: 'Send a supplier fulfillment request. Payload is an array of {orderId,sku,quantity}; no customer or internal financial data is required.',
    serviceId: 'lab-supplier',
    serviceName: 'Lab Supplier',
    authenticated: true,
    inputs: { payload: data },
    outputs: {},
  },
]
export const accounts: ConnectorConnection[] = [
  { connectionId: 'orders-test', displayName: 'Orders test account', serviceId: 'lab-orders', status: 'active', isDefault: false },
  { connectionId: 'orders-production', displayName: 'Orders production account', serviceId: 'lab-orders', status: 'active', isDefault: true },
  { connectionId: 'notifications-test', displayName: 'Notifications test account', serviceId: 'lab-notifications', status: 'active', isDefault: false },
  {
    connectionId: 'notifications-production',
    displayName: 'Notifications production account',
    serviceId: 'lab-notifications',
    status: 'active',
    isDefault: true,
  },
  { connectionId: 'archive-test', displayName: 'Archive test account', serviceId: 'lab-archive', status: 'active', isDefault: true },
  { connectionId: 'supplier-test', displayName: 'Supplier test account', serviceId: 'lab-supplier', status: 'active', isDefault: false },
  { connectionId: 'supplier-production', displayName: 'Supplier production account', serviceId: 'lab-supplier', status: 'active', isDefault: true },
]
function unknown(): never {
  throw new Error('Unsupported Lab external request; no live fallback is configured.')
}
export type MockModelCall = {
  request: { model?: unknown; messages?: unknown; tools?: { function?: { name?: string } }[] }
  response: { text: string }
}
export function createMocks() {
  const calls: { action: string; connection: string | undefined; input: Readonly<Record<string, JsonValue>>; invocationId: string }[] = []
  const modelCalls: MockModelCall[] = []
  const sample: { orders: JsonValue; order: JsonValue } = {
    orders: [{ amount: null }],
    order: { orderId: 'O-17', total: 125, email: 'buyer@example.test', phone: '555-0100', internalCost: 47 },
  }
  const providers = [...new Map(actions.map((a) => [a.serviceId, { serviceId: a.serviceId, serviceName: a.serviceName }])).values()]
  const connector: ConnectorHost = {
    ready: async () => true,
    listProviders: async () => providers,
    listActions: async (service) => actions.filter((a) => service == null || a.serviceId == service),
    searchActions: async (query) => actions.filter((a) => `${a.name} ${a.description}`.toLowerCase().includes(query.toLowerCase())),
    getAction: async (id) => actions.find((a) => a.actionId == id) ?? unknown(),
    listConnections: async (id) => accounts.filter((a) => a.serviceId == id),
    listAllConnections: async () => accounts,
    execute: async (id, connection, input, invocationId): Promise<JsonValue> => {
      const action = actions.find((a) => a.actionId == id)
      if (action == null || !accounts.some((a) => a.connectionId == connection && a.serviceId == action.serviceId)) return unknown()
      calls.push({ action: id, connection, input, invocationId })
      if (id == 'lab-orders.batch') {
        if (typeof input.batch != 'string' || !Object.hasOwn(fulfillmentBatches, input.batch)) throw new Error('Unknown fulfillment batch.')
        const orders = fulfillmentBatches[input.batch]!
        return orders == null ? { batch: input.batch } : { orders: structuredClone(orders), batch: input.batch }
      }
      if (id == 'lab-orders.list') return { ...sample }
      if (id == 'lab-orders.customers') return { customers: [] }
      return {}
    },
    proxy: async () => unknown(),
    trigger: async () => unknown(),
  }
  const model = new Hono()
  model.get('/v1/providers', (c) =>
    c.json({ success: true, data: providers.map((p) => ({ service: p.serviceId, displayName: p.serviceName, authTypes: ['oauth'] })) }),
  )
  model.get('/v1/actions', (c) =>
    c.json({
      success: true,
      data: actions
        .filter((a) => c.req.query('service') == null || c.req.query('service') == a.serviceId)
        .map((a) => ({
          id: a.actionId,
          service: a.serviceId,
          name: a.name,
          description: a.description,
          authenticated: true,
          inputSchema: {
            type: 'object',
            properties: Object.fromEntries(Object.entries(a.inputs).map(([key, port]) => [key, port.jsonSchema])),
            required: Object.keys(a.inputs),
          },
          outputSchema: {
            type: 'object',
            properties: Object.fromEntries(Object.entries(a.outputs).map(([key, port]) => [key, port.jsonSchema])),
            required: Object.keys(a.outputs),
          },
        })),
    }),
  )
  model.get('/v1/apps', (c) => c.json({ success: true, data: [] }))
  model.post('/v1/chat/completions', async (context) => {
    const body = await context.req.json()
    if (body.model != 'lab-model') return context.json({ error: { message: 'Unknown Lab model' } }, 400)
    const completion = `Lab summary ${createHash('sha256')
      .update(JSON.stringify(body.messages ?? []))
      .digest('hex')
      .slice(0, 16)}.`
    modelCalls.push({ request: body, response: { text: completion } })
    if (body.stream) {
      const chunks = [
        {
          id: 'lab-completion',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'lab-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: completion }, finish_reason: null }],
        },
        {
          id: 'lab-completion',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'lab-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
      ]
      return context.body(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', 200, {
        'content-type': 'text/event-stream',
      })
    }
    return context.json({
      id: 'lab-completion',
      object: 'chat.completion',
      created: 0,
      model: 'lab-model',
      choices: [{ index: 0, message: { role: 'assistant', content: completion }, finish_reason: 'stop' }],
    })
  })
  return { connector, calls, modelCalls, model, sample }
}
