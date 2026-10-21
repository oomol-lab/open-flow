import type { JsonValue, TriggerNode } from '../../src/flow/common/change.ts'
import type { Draft, Flow } from '../../src/workbench/browser/runtime/api.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import snapshots from 'virtual:lab-trigger-snapshots'
import { inputValues } from '../../src/flow/common/inputValue.ts'
import { schemaObject } from '../../src/flow/common/schema.ts'
import { triggerOutputDefinitions } from '../../src/trigger/common/contract.ts'

// Sample values only; schemas and validation remain owned by production code.
function sample(schema: JsonValue): JsonValue {
  const object = schemaObject(schema)
  if (!object) return {}
  if (object.default !== undefined) return object.default as JsonValue
  if (Array.isArray(object.enum)) return object.enum[0] as JsonValue
  const type = Array.isArray(object.type) ? object.type[0] : object.type
  if (type === 'object') {
    const properties = schemaObject(object.properties as JsonValue) ?? {}
    const required = Array.isArray(object.required) ? object.required : []
    return Object.fromEntries(required.map((key) => [String(key), sample((properties[String(key)] as JsonValue) ?? {})]))
  }
  if (type === 'array') return [sample((object.items as JsonValue) ?? {})]
  if (type === 'boolean') return false
  if (type === 'integer' || type === 'number') return typeof object.minimum === 'number' ? object.minimum : 1
  if (type === 'null') return null
  return 'sample'
}

const configExamples: Readonly<Record<string, Readonly<Record<string, JsonValue>>>> = {
  feishu_app_bot: { sourceId: 'source_11111111111111111111111111111111', eventTypes: ['im.message.receive_v1'], chatIds: ['oc_demo'] },
  slackbot: { sourceId: 'source_11111111111111111111111111111111', eventTypes: ['app_mention'] },
  intercom: { sourceId: 'source_11111111111111111111111111111111', eventTypes: ['conversation.user.created'] },
  sentry: { sourceId: 'source_11111111111111111111111111111111', eventTypes: ['issue.alert'] },
  zoom: { sourceId: 'source_11111111111111111111111111111111', eventTypes: ['recording.completed'] },
  fireflies: { sourceId: 'source_11111111111111111111111111111111', eventTypes: ['meeting.transcribed'] },
  jira: { sourceId: 'source_11111111111111111111111111111111', eventTypes: ['jira:issue_created'] },
  airtable: { baseId: 'app12345678901234', tableIdOrName: 'Orders', triggerField: 'Last modified' },
  gmail: { sender: 'orders@example.com', readStatus: 'Unread' },
  github: { owner: 'oomol-lab', repo: 'open-flow', events: ['issues', 'push'] },
  gitlab: { project: 'team/project', events: ['push'] },
  googlecalendar: { calendarId: 'primary' },
  googledrive: { folderId: 'folder_sample', changeType: 'created' },
  googlesheets: { spreadsheetId: 'sheet_sample', sheetId: '0' },
  linear: { teamId: '72b2a2dc-6f4f-4423-9d34-24b5bd10634a', stateIds: ['539068e2-ae88-4d09-bd75-22eb4a59612f'] },
  notion: { databaseId: '00000000-0000-4000-8000-000000000001' },
  onedrive: { folderId: 'root' },
  outlook: { folderId: 'inbox' },
  shopify: { topics: ['orders/create'] },
  slack: { channelId: 'C0122KQ70S7E', textContains: 'release' },
  stripe: { events: ['payment_intent.succeeded'] },
  telegram: { updates: ['message'] },
  tally: { formId: 'lead-form' },
  typeform: { formId: 'customer-survey' },
  calendly: { scope: 'user', eventTypes: ['invitee.created', 'invitee.canceled'] },
  pipedrive: { eventType: 'deal.stage_changed' },
  clickup: { workspaceId: '123456', listId: '789012', eventTypes: ['taskStatusUpdated'] },
  resend: { eventTypes: ['email.received'] },
  pandadoc: { completedOnly: true },
  asana: { projectId: '123456', eventTypes: ['task.added', 'task.completed'] },
  vercel: { teamId: 'team_example', projectId: 'prj_example', environment: 'production' },
  woocommerce: { events: ['order.created'] },
  zendesk: { events: ['zen:event-type:ticket.created'] },
}

export interface TriggerFixture {
  readonly id: string
  readonly trigger: TriggerNode
  readonly outputs: Readonly<Record<string, JsonValue>>
}

export const startInputDefs: readonly import('../../src/flow/common/change.ts').Port[] = [
  { handle: 'orderId', jsonSchema: { type: 'string' }, nullable: false, description: 'The order to process.' },
  { handle: 'note', jsonSchema: { type: 'string' }, nullable: true, description: 'An optional note.' },
  { handle: 'options', jsonSchema: { type: 'object', properties: { dryRun: { type: 'boolean' } }, additionalProperties: false }, nullable: true },
]

const builtins: readonly TriggerNode[] = [
  { kind: 'error', name: 'Flow Error' },
  { inputDefs: startInputDefs, kind: 'start', name: 'Start' },
  {
    kind: 'cron',
    name: 'Schedule',
    cronTimes: [
      { type: 'every', unit: 'hour', value: 1 },
      { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' },
    ],
  },
  {
    kind: 'webhook',
    method: 'POST',
    name: 'Webhook',
    bodyFields: [
      { handle: 'event', jsonSchema: { type: 'string' }, nullable: false },
      { handle: 'orderId', jsonSchema: { type: 'string' }, nullable: false },
    ],
    options: { responseStatusCode: 202 },
  },
]

export const triggerFixtures: readonly TriggerFixture[] = [
  ...builtins.map(
    (trigger): TriggerFixture => ({
      id: trigger.kind,
      trigger,
      outputs:
        trigger.kind === 'start'
          ? { orderId: 'order_123', note: 'Review delivery instructions', options: { dryRun: false } }
          : trigger.kind === 'webhook'
            ? { headers: {}, query: {}, body: { event: 'order.created', orderId: 'order_123' }, webhookUrl: 'https://example.com/webhook' }
            : Object.fromEntries(triggerOutputDefinitions(trigger).map((port) => [port.handle, sample(port.jsonSchema)])),
    }),
  ),
  ...snapshots.map((definition): TriggerFixture => {
    const fields = definition.configInputs.filter((input) => 'handle' in input)
    const handles = new Set(fields.map((field) => field.handle))
    const examples = Object.fromEntries(Object.entries(configExamples[definition.provider] ?? {}).filter(([key]) => handles.has(key)))
    const config = {
      ...Object.fromEntries(fields.map((field) => [field.handle, field.value !== undefined ? field.value : field.nullable ? null : sample(field.jsonSchema)])),
      ...examples,
    }
    const common = { name: definition.displayName, description: definition.description, connectionId: 'lab-account', config: inputValues(config) }
    const trigger: TriggerNode =
      definition.type === 'poll'
        ? { ...common, kind: 'poll', definition, pollTimes: [{ type: 'every', unit: 'minute', value: 5 }] }
        : { ...common, kind: 'integration', definition }
    return {
      id: definition.key.replaceAll('.', '-').replaceAll('_', '-'),
      trigger,
      outputs:
        definition.key === 'tally.on_form_response'
          ? {
              response: {
                eventId: 'event-1',
                createdAt: '2026-10-20T00:00:00Z',
                formId: 'lead-form',
                submissionId: 'submission-1',
                responseId: 'response-1',
                fields: [
                  { key: 'name', type: 'INPUT_TEXT', label: 'Name', value: '李明' },
                  { key: 'quantity', type: 'INPUT_NUMBER', label: 'Quantity', value: 3 },
                  { key: 'notes', type: 'TEXTAREA', label: 'Notes', value: null },
                ],
              },
            }
          : Object.fromEntries(triggerOutputDefinitions(trigger).map((port) => [port.handle, sample(port.jsonSchema)])),
    }
  }),
]

const timestamp = '2026-09-10T00:00:00.000Z'
export function triggerDraft(trigger: TriggerNode, downstream = false): { flow: Flow; draft: Draft } {
  const flow: Flow = {
    createdAt: timestamp,
    updatedAt: timestamp,
    draftRevisionId: 'revision-1',
    resourceReferences: {
      draft: { variableNames: [], connections: [], errorSourceFlowIds: [] },
      sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] },
    },
    flowId: 'trigger-lab',
    name: trigger.name,
    status: 'active',
    version: 1,
  }
  const draft: Draft = {
    actorId: 'lab',
    createdAt: timestamp,
    digest: 'lab',
    flowId: flow.flowId,
    modelVersion: currentFlowModelVersion,
    parentRevisionId: null,
    revisionId: flow.draftRevisionId,
    version: 1,
    content: {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: {
        bindings: {},

        graph: {
          nodes: {
            trigger,
            ...(downstream
              ? {
                  task: {
                    kind: 'task' as const,
                    inputs: {},
                    task: {
                      name: 'Message',
                      moduleId: 'message',
                      inputs: [{ handle: 'message', jsonSchema: { type: 'string' }, nullable: false }],
                      outputs: [],
                    },
                  },
                }
              : {}),
          },
          edges: downstream ? [{ source: 'trigger', target: 'task' }] : [],
        },
      },
    },
  }
  return { flow, draft }
}

// Boundary samples use production Webhook definitions and output contract derivation.
export const webhookValueFixtures: readonly TriggerFixture[] = [
  {
    id: 'Empty fixed object',
    trigger: { kind: 'webhook', method: 'POST', name: 'Empty request', bodyFields: [], options: {} },
    outputs: { headers: {}, query: {}, body: {}, webhookUrl: 'https://example.com/webhook' },
  },
  {
    id: 'Nested objects and arrays',
    trigger: {
      kind: 'webhook',
      method: 'POST',
      name: 'Nested request',
      options: {},
      bodyFields: [
        {
          handle: 'data',
          nullable: false,
          jsonSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              empty: { type: 'object', additionalProperties: false },
              fields: { type: 'object', additionalProperties: { type: 'string' } },
              items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false } },
            },
            required: ['empty', 'fields', 'items'],
          },
        },
      ],
    },
    outputs: { headers: {}, query: {}, body: { data: { empty: {}, fields: {}, items: [{ name: 'One' }] } }, webhookUrl: 'https://example.com/webhook' },
  },
]
