import type { JsonValue, TriggerNode } from '../../src/flow/common/change.ts'
import type { Draft, Flow } from '../../src/workbench/browser/runtime/api.ts'

import snapshots from 'virtual:lab-trigger-snapshots'
import { schemaObject, triggerPayloadSchema } from '../../src/flow/common/schema.ts'

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
  woocommerce: { events: ['order.created'] },
  zendesk: { events: ['zen:event-type:ticket.created'] },
}

export interface TriggerFixture {
  readonly id: string
  readonly trigger: TriggerNode
  readonly payload: JsonValue
}

const builtins: readonly TriggerNode[] = [
  { kind: 'manual', name: 'Manual' },
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
    name: 'Webhook',
    inputsDef: [
      { handle: 'event', jsonSchema: { type: 'string' }, nullable: false },
      { handle: 'orderId', jsonSchema: { type: 'string' }, nullable: false },
    ],
    options: { allowedMethods: ['POST'], responseStatusCode: 202 },
  },
]

export const triggerFixtures: readonly TriggerFixture[] = [
  ...builtins.map(
    (trigger): TriggerFixture => ({ id: trigger.kind, trigger, payload: trigger.kind === 'webhook' ? { event: 'order.created', orderId: 'order_123' } : {} }),
  ),
  ...snapshots.map((definition): TriggerFixture => {
    const properties = schemaObject(schemaObject(definition.configSchema)?.properties as JsonValue) ?? {}
    const examples = Object.fromEntries(Object.entries(configExamples[definition.provider] ?? {}).filter(([key]) => key in properties))
    const config = { ...(sample(definition.configSchema) as Record<string, JsonValue>), ...examples }
    const common = { name: definition.displayName, description: definition.description, bindingId: 'account', config }
    const trigger: TriggerNode =
      definition.type === 'poll'
        ? { ...common, kind: 'poll', definition, pollTimes: [{ type: 'every', unit: 'minute', value: 5 }] }
        : { ...common, kind: 'integration', definition }
    return { id: definition.key.replaceAll('.', '-').replaceAll('_', '-'), trigger, payload: sample(triggerPayloadSchema(trigger)) }
  }),
]

const timestamp = '2026-09-10T00:00:00.000Z'
export function triggerDraft(trigger: TriggerNode, downstream = false): { flow: Flow; draft: Draft } {
  const flow: Flow = {
    createdAt: timestamp,
    updatedAt: timestamp,
    draftRevisionId: 'revision-1',
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
    modelVersion: 1,
    parentRevisionId: null,
    revisionId: flow.draftRevisionId,
    version: 1,
    content: {
      modelVersion: 1,
      modules: {},
      document: {
        bindings: { account: { kind: 'connection', target: 'lab-account' } },
        subflows: {},
        tasks: {},
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
