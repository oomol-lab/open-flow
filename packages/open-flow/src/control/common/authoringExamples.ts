import type { DraftOperation } from './draftOperations.ts'

import {
  createApproval,
  createBuiltinTrigger,
  createCodeTask,
  createCondition,
  createLlmTask,
  createManagedTask,
  createValue,
  createWait,
} from '../../flow/common/nodeChanges.ts'

const target = { kind: 'flow' } as const
const descriptions = {
  'manual': 'A Manual start node.',
  'webhook': 'A Webhook start node.',
  'cron': 'An hourly scheduled start node.',
  'poll': 'Gmail polling by key; replace CONNECTION_ID with an active Gmail connection.',
  'integration': 'Telegram webhook integration by key; replace CONNECTION_ID with an active Telegram connection.',
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
    case 'manual':
      operations = createBuiltinTrigger(target, 'start', { kind: 'manual', name: 'Start' })
      break
    case 'webhook':
      operations = createBuiltinTrigger(target, 'start', { kind: 'webhook', method: 'POST', name: 'Webhook', bodyFields: [] })
      break
    case 'cron':
      operations = createBuiltinTrigger(target, 'start', { kind: 'cron', name: 'Schedule', cronTimes: [{ type: 'every', unit: 'hour', value: 1 }] })
      break
    case 'poll':
      operations = [
        {
          kind: 'graph.trigger.create',
          nodeId: 'mail',
          bindingId: 'mail-account',
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
          bindingId: 'telegram-account',
          key: 'telegram.on_update',
          connectionId: 'CONNECTION_ID',
          config: { updates: ['message'] },
        },
      ]
      break
    case 'agent':
      operations = createManagedTask(
        target,
        { nodeId: 'agent', taskId: 'agent-task' },
        {
          name: 'Agent',
          inputs: [{ handle: 'input', jsonSchema: { type: 'string' }, nullable: false, value: 'Summarize the current input.' }],
          outputs: [{ handle: 'output', jsonSchema: { type: 'string' }, nullable: false }],
          executor: { kind: 'agent', code: true, model: 'deepseek-v4-flash', system: '', prompt: { kind: 'input', input: 'input' }, maxRounds: 10, tools: [] },
        },
      )
      break
    case 'connector':
      operations = createManagedTask(
        target,
        { nodeId: 'notify', taskId: 'notify-task' },
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
        target,
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
        ...createCondition(target, 'condition', 'Condition'),
        { kind: 'graph.node.input.set', target, nodeId: 'condition', handle: '0/0/0/left', value: { kind: 'value', value: 100 } },
        { kind: 'graph.node.input.set', target, nodeId: 'condition', handle: '0/0/0/right', value: { kind: 'value', value: 100 } },
      ]
      break
    case 'value':
      operations = createValue(target, 'value', 'Value')
      break
    case 'approval':
      operations = createApproval(target, 'approval', 'Approve?')
      break
    case 'wait':
      operations = createWait(target, 'wait', 'Continue?')
      break
    case 'llm-chat':
    case 'llm-json':
      operations = createLlmTask(target, { nodeId: 'llm', taskId: 'llm-task' }, 'LLM', name == 'llm-chat' ? 'chat' : 'json', 'Generated response.')
      break
    case 'poll-notification':
      operations = [
        ...authoringExample('poll').operations,
        ...authoringExample('code').operations,
        ...authoringExample('connector').operations,
        { kind: 'graph.edge.connect', target, edge: { source: 'mail', target: 'format' } },
        { kind: 'graph.edge.connect', target, edge: { source: 'format', target: 'notify' } },
        {
          kind: 'graph.node.input.set',
          target,
          nodeId: 'format',
          handle: 'events',
          before: { kind: 'value', value: [] },
          value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'mail', output: 'events' }] },
        },
        {
          kind: 'graph.node.input.set',
          target,
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
