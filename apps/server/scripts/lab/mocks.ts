import type { ConnectorActionMetadata, ConnectorConnection } from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorHost } from '../../node/deployment/connector.ts'

import { Hono } from 'hono'

export const action: ConnectorActionMetadata = {
  actionId: 'lab-notifications.send',
  name: 'Send notification',
  description: 'Send a notification to the local Lab recorder.',
  authenticated: true,
  serviceId: 'lab-notifications',
  serviceName: 'Lab Notifications',
  inputs: { text: { jsonSchema: { type: 'string' }, nullable: false } },
  outputs: { receipt: { jsonSchema: { type: 'string' }, nullable: false } },
}
export const account: ConnectorConnection = {
  connectionId: 'lab-account',
  displayName: 'Lab account',
  serviceId: action.serviceId,
  status: 'active',
  isDefault: true,
}
function unknown(): never {
  throw new Error('Unsupported Lab external request; no live fallback is configured.')
}

export function createMocks() {
  const calls: { action: string; input: Readonly<Record<string, JsonValue>>; invocationId: string }[] = []
  const modelCalls: unknown[] = []
  const connector: ConnectorHost = {
    ready: async () => true,
    listProviders: async () => [{ serviceId: action.serviceId, serviceName: action.serviceName }],
    listActions: async (service) => (service == null || service == action.serviceId ? [action] : []),
    searchActions: async (query) => (`${action.name} ${action.description} ${action.actionId}`.toLowerCase().includes(query.toLowerCase()) ? [action] : []),
    getAction: async (id) => (id == action.actionId ? action : unknown()),
    listConnections: async (id) => (id == action.serviceId ? [account] : []),
    listAllConnections: async () => [account],
    execute: async (id, connection, input, invocationId) => {
      if (id != action.actionId || connection != account.connectionId || typeof input.text != 'string') return unknown()
      calls.push({ action: id, input, invocationId })
      return { receipt: 'recorded' }
    },
    proxy: async () => unknown(),
    trigger: async () => unknown(),
  }
  const model = new Hono()
  model.get('/v1/providers', (context) =>
    context.json({ success: true, data: [{ service: action.serviceId, displayName: action.serviceName, authTypes: ['oauth'] }] }),
  )
  model.get('/v1/actions', (context) =>
    context.json({
      success: true,
      data:
        context.req.query('service') != null && context.req.query('service') != action.serviceId
          ? []
          : [
              {
                id: action.actionId,
                service: action.serviceId,
                name: action.name,
                description: action.description,
                authenticated: true,
                inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
                outputSchema: { type: 'object', properties: { receipt: { type: 'string' } }, required: ['receipt'] },
              },
            ],
    }),
  )
  model.get('/v1/apps', (context) => context.json({ success: true, data: [] }))
  model.post('/v1/chat/completions', async (context) => {
    const body = await context.req.json()
    if (body.model != 'lab-model') return context.json({ error: { message: 'Unknown Lab model' } }, 400)
    modelCalls.push(body)
    const text = 'Lab summary: 3 updates.'
    if (body.stream) {
      const chunks = [
        {
          id: 'lab-completion',
          object: 'chat.completion.chunk',
          created: 0,
          model: 'lab-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }],
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
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    })
  })
  return { connector, calls, modelCalls, model }
}
