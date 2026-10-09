import type { DraftOperation } from './draftOperations.ts'

import {
  createApproval,
  createBuiltinTrigger,
  createCodeTask,
  createCondition,
  createDecisionTask,
  createLlmTask,
  createManagedTask,
  createValue,
  createWait,
} from '../../flow/common/nodeChanges.ts'
import { openApiTask, selectOperation } from '../../openapi/common/openapi.ts'

const descriptions = {
  'manual': 'A Manual start node.',
  'error': 'A Flow Error node. Select upstream Flows, then publish and enable this Flow to listen for failures in their automatic runs.',
  'webhook': 'A Webhook start node.',
  'cron': 'An hourly scheduled start node.',
  'poll': 'Gmail polling by key; replace CONNECTION_ID with an active Gmail connection.',
  'integration': 'Telegram webhook integration by key; replace CONNECTION_ID with an active Telegram connection.',
  'decision': 'AI Decision evaluates named questions against target and returns a complete answer object per output. Configure target before running.',
  'openapi': 'A fixed JSON API operation. Replace the example document and URL before running.',
  'connector': 'A Connector Task and its node. Replace ACTION_ID, CONNECTION_ID and port definitions using connector_get / connector show.',
  'code': 'A JavaScript module and its node. Use Code for custom computation; use Connector Tasks for existing actions.',
  'condition': 'A condition with true and false execution branches.',
  'value': 'A fixed value node.',
  'approval': 'An Approval with approve and reject decision branches and a built-in notification output.',
  'wait': 'A Wait with a continue action and a built-in notification output.',
  'agent': 'An Agent with code computation enabled. Configure a model available in the deployment.',
  'llm-chat': 'An LLM chat Task and its node; configure a model available in the deployment.',
  'llm-json': 'An LLM JSON Task and its node; configure a model available in the deployment.',
  'poll-notification':
    'Gmail events → JavaScript text formatting → Connector notification. Replace connection/action IDs and match the notification input ports.',
} as const

export const authoringExampleNames = Object.keys(descriptions) as (keyof typeof descriptions)[]

export const authoringExamples = authoringExampleNames.map((name) => ({ name, description: descriptions[name] }))

export function authoringExample(name: string): { version: 1; operations: readonly DraftOperation[] } {
  let operations: readonly DraftOperation[]
  switch (name) {
    case 'error':
      operations = createBuiltinTrigger('error', { kind: 'error', name: 'Flow Error' })
      break
    case 'decision':
      operations = createDecisionTask({ nodeId: 'decision' }, 'AI Decision', [
        { name: 'needs_support', type: 'noul', instructions: 'Does the customer need support?' },
      ])
      break
    case 'openapi': {
      const document = {
        openapi: '3.1.0',
        paths: { '/items': { get: { responses: { '200': { content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } } } },
      }
      operations = createManagedTask({ nodeId: 'api' }, openApiTask(selectOperation(document, 'https://api.example.com/openapi.json', '/items', 'get')))
      break
    }
    case 'manual':
      operations = createBuiltinTrigger('start', { kind: 'manual', name: 'Start' })
      break
    case 'webhook':
      operations = createBuiltinTrigger('start', { kind: 'webhook', method: 'POST', name: 'Webhook', bodyFields: [] })
      break
    case 'cron':
      operations = createBuiltinTrigger('start', { kind: 'cron', name: 'Schedule', cronTimes: [{ type: 'every', unit: 'hour', value: 1 }] })
      break
    case 'poll':
      operations = [
        {
          kind: 'graph.trigger.create',
          nodeId: 'mail',

          key: 'gmail.on_message_received',
          connectionId: 'CONNECTION_ID',
          config: {},
          schedule: [{ type: 'every', unit: 'minute', value: 5 }],
        },
      ]
      break
    case 'integration':
      operations = [
        {
          kind: 'graph.trigger.create',
          nodeId: 'telegram',

          key: 'telegram.on_update',
          connectionId: 'CONNECTION_ID',
          config: { updates: ['message'] },
        },
      ]
      break
    case 'agent':
      operations = createManagedTask(
        { nodeId: 'agent' },
        {
          name: 'Agent',
          inputs: [{ handle: 'input', jsonSchema: { type: 'string' }, nullable: false, value: 'Summarize the current input.' }],
          outputs: [{ handle: 'output', jsonSchema: { type: 'string' }, nullable: false }],
          executor: { kind: 'agent', code: true, model: 'deepseek-v4-flash', prompt: '{{input}}', maxRounds: 10, tools: [] },
        },
      )
      break
    case 'connector':
      operations = createManagedTask(
        { nodeId: 'notify' },
        {
          name: 'Notify',
          executor: { kind: 'connector', action: 'ACTION_ID', connectionId: 'CONNECTION_ID' },
          inputs: [{ handle: 'text', jsonSchema: { type: 'string' }, nullable: false, value: 'Hello' }],
          outputs: [],
        },
      )
      break
    case 'code':
      operations = createCodeTask(
        { nodeId: 'format', moduleId: 'format-module' },
        'Format',
        {
          imports: [],
          source: 'export default async function (inputs) { return { text: inputs.events.map(event => `${event.sender}: ${event.subject}`).join("\\n") } }',
        },
        {
          inputs: [
            {
              handle: 'events',
              jsonSchema: { type: 'array', items: { type: 'object' } },
              nullable: false,
              value: [],
            },
          ],
          outputs: [{ handle: 'text', jsonSchema: { type: 'string' }, nullable: false }],
        },
      )
      break
    case 'condition':
      operations = [
        ...createCondition('condition', 'Condition'),
        { kind: 'graph.node.input.set', nodeId: 'condition', handle: '0/0/0/left', value: { kind: 'value', value: 100 } },
        { kind: 'graph.node.input.set', nodeId: 'condition', handle: '0/0/0/right', value: { kind: 'value', value: 100 } },
      ]
      break
    case 'value':
      operations = createValue('value', 'Value')
      break
    case 'approval':
      operations = createApproval('approval', 'Approve?')
      break
    case 'wait':
      operations = createWait('wait', 'Continue?')
      break
    case 'llm-chat':
    case 'llm-json':
      operations = createLlmTask({ nodeId: 'llm' }, 'LLM', name == 'llm-chat' ? 'chat' : 'json', 'Generated response.')
      break
    case 'poll-notification':
      operations = [
        ...authoringExample('poll').operations,
        ...authoringExample('code').operations,
        ...authoringExample('connector').operations,
        { kind: 'graph.edge.connect', edge: { source: 'mail', target: 'format' } },
        { kind: 'graph.edge.connect', edge: { source: 'format', target: 'notify' } },
        {
          kind: 'graph.node.input.set',
          nodeId: 'format',
          handle: 'events',
          before: { kind: 'value', value: [] },
          value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'mail', output: 'events' }] },
        },
        {
          kind: 'graph.node.input.set',
          nodeId: 'notify',
          handle: 'text',
          before: { kind: 'value', value: 'Hello' },
          value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'format', output: 'text' }] },
        },
      ]
      break
    default:
      throw new TypeError(`Unknown authoring example ${JSON.stringify(name)}.`)
  }
  return { version: 1 as const, operations }
}
