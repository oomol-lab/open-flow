import type { ChangeOperation, JsonValue, ManagedTaskDefinition, RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { applyFlowChanges, currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { isDeepStrictEqual } from 'node:util'
import { fulfillmentSamples, fulfillmentStages } from './fulfillment.ts'

export const scenarios = [
  {
    id: 'fulfillment-ops',
    entry: { kind: 'manual' },
    name: 'Evolve a fulfillment operations workflow',
    version: 1,
    task: fulfillmentStages[0]!.task,
  },
  {
    id: 'order-alert',
    entry: { kind: 'manual' },
    name: 'Build an order alert',
    version: 1,
    task: 'Build a workflow with a Manual trigger. Find the action that lists orders and use Orders test account. Sum their amounts. If the total is greater than 100, send its decimal total as a notification using Notifications test account. Empty orders produce zero and no notification.',
  },
  {
    id: 'customer-redaction',
    entry: { node: 'start' },
    name: 'Add customer data redaction',
    version: 1,
    task: 'Customer notification must contain JSON with only orderId and total. Insert a processing step on its execution path. Internal archive must continue receiving the complete original order. Keep the existing accounts, other settings and behavior.',
  },
  {
    id: 'specialize-summary',
    entry: { node: 'start' },
    name: 'Specialize one independent summary',
    version: 2,
    task: 'Find Customer summary and replace only the prompt rule "Include internal cost breakdown." with "Exclude internal cost breakdown." Keep all other prompt content and configuration. Internal summary and the other nodes must remain unchanged.',
  },
  {
    id: 'specialize-summary-large',
    entry: { node: 'start' },
    name: 'Specialize one independent summary in a larger flow',
    version: 2,
    task: 'Find Customer summary and replace only the prompt rule "Include internal cost breakdown." with "Exclude internal cost breakdown." Keep all other prompt content and configuration. Internal summary and the other nodes must remain unchanged.',
  },
  {
    id: 'repair-amount',
    entry: { node: 'start' },
    name: 'Repair a failed amount formatter',
    version: 1,
    task: 'Inspect the existing failed Run and fix the amount formatter. Null amounts must format as zero, while zero and ordinary amounts keep two decimal places. A missing order list must still fail. Preserve schemas, unrelated code and workflow behavior.',
  },
  {
    id: 'concurrent-edit',
    entry: { node: 'start' },
    name: 'Recover from a concurrent edit',
    version: 1,
    task: 'Change Customer notification to send "Order received". Another operator may edit the workflow while you work; preserve their changes and all other settings. Do not create duplicate nodes or run the workflow unnecessarily.',
  },
] as const
export type Scenario = Omit<(typeof scenarios)[number], 'name' | 'task'> & { name: string; task: string }
export function scenario(id: string, stage = 0): Scenario {
  const found = scenarios.find((s) => s.id == id)
  if (found == null) throw new Error(`Unknown scenario ${id}`)
  if (id != 'fulfillment-ops') return found
  const current = fulfillmentStages[stage]
  if (current == null) throw new Error('Unknown fulfillment stage')
  return { ...found, name: `${found.name} (${stage + 1}/${fulfillmentStages.length}: ${current.name})`, task: current.task }
}
export function stageCount(id: string) {
  return id == 'fulfillment-ops' ? fulfillmentStages.length : 1
}
const string = { jsonSchema: { type: 'string' }, nullable: false } as const
const any = { jsonSchema: {}, nullable: true } as const
const order = { orderId: 'O-17', total: 125, email: 'buyer@example.test', phone: '555-0100', internalCost: 47 }
const summaryPrompt =
  'Summarize the order for the selected audience.\nAudience: {{input}}\nInclude internal cost breakdown.\nPreserve order identifiers and currency.\nReport missing information explicitly.\nDo not invent shipment dates.\nSeparate confirmed facts from estimates.\n\nAudience handling\nAddress the selected audience directly. Use a professional tone and explain any abbreviation on first use. Keep customer-facing information actionable and do not promise dates not present in the order.\n\nOrder facts\nStart with the order identifier and total. Distinguish the order status from its payment status. If fulfillment details are available, describe shipped, pending and canceled items separately. Preserve the original currency and do not infer exchange rates.\n\nExceptions\nReport discrepancies between line items and the total without changing the supplied figures. Mention missing contact or shipping details when they prevent the next action. Refunds and negative adjustments must keep their original sign.\n\nOutput\nWrite a concise summary followed by outstanding actions. Each action should identify its owner when the data supplies one. If no action is required, say that explicitly. Never invent an owner, account, approval or shipment tracking number.'
export const amountSource = `function formatAmount(amount) { return amount.toFixed(2) }
export default function ({orders}) {
  if (!Array.isArray(orders)) throw new Error('Order list is required')
  return {text: orders.map(order => formatAmount(order.amount)).join(', ')}
}`
function node(nodeId: string, value: Extract<ChangeOperation, { kind: 'graph.node.create' }>['node']): ChangeOperation {
  return { kind: 'graph.node.create', nodeId, node: value }
}
function edge(sourceNode: string, targetNode: string): ChangeOperation {
  return { kind: 'graph.edge.connect', edge: { source: sourceNode, target: targetNode } }
}
function connector(
  nodeId: string,
  name: string,
  action: string,
  connectionId: string,
  inputs: ManagedTaskDefinition['inputs'],
  outputs: ManagedTaskDefinition['outputs'],
  values: Record<string, JsonValue> = {},
): ChangeOperation[] {
  return [
    node(nodeId, {
      kind: 'task',
      name,
      task: { name, inputs, outputs, executor: { kind: 'connector', action, connectionId } },
      inputs: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { kind: 'value', value }])),
    }),
  ]
}
function source(nodeId: string, handle: string, from: string, output: string): ChangeOperation {
  return { kind: 'graph.node.input.set', nodeId, handle, value: { kind: 'sources', sources: [{ kind: 'node', nodeId: from, output }] } }
}
export function initialOperations(id: string): ChangeOperation[] {
  if (id == 'order-alert' || id == 'fulfillment-ops') return []
  const start = node('start', { kind: 'manual', name: 'Manual trigger' })
  if (id.startsWith('specialize-summary')) {
    const task: ManagedTaskDefinition = {
      name: 'Order summary',
      inputs: [{ handle: 'input', ...string }],
      outputs: [{ handle: 'output', ...string }],
      executor: {
        kind: 'agent',
        model: 'lab-model',
        prompt: summaryPrompt,
        maxRounds: 3,
        tools: [
          {
            id: 'lookup',
            name: 'lookup_orders',
            description: 'Read current order details when the summary needs additional facts.',
            action: 'lab-orders.list',
            connectionId: 'orders-test',
            approval: false,
            inputs: [],
          },
        ],
        code: false,
      },
    }
    const operations: ChangeOperation[] = [
      start,
      node('customer', {
        kind: 'task',
        name: 'Customer summary',
        task: structuredClone(task),
        inputs: { input: { kind: 'value', value: 'Customer audience: order O-17' } },
      }),
      node('internal', {
        kind: 'task',
        name: 'Internal summary',
        task: structuredClone(task),
        inputs: { input: { kind: 'value', value: 'Internal audience: order O-17' } },
      }),
      edge('start', 'customer'),
      edge('start', 'internal'),
    ]
    const departments = [
      'Shipping',
      'Inventory',
      'Returns',
      'Billing',
      'Tax',
      'Support',
      'Fulfillment',
      'Fraud',
      'Wholesale',
      'Retail',
      'Export',
      'Warranty',
      'Procurement',
      'Finance',
      'Packaging',
      'Routing',
      'Reconciliation',
      'Settlement',
      'Customer care',
      'Logistics',
      'Compliance',
      'Quality',
      'Forecasting',
      'Analytics',
    ]
    for (const [index, name] of departments.slice(0, id.endsWith('large') ? 24 : 4).entries()) {
      operations.push(
        node(`metric-${index}`, {
          kind: 'value',
          name: `${name} summary settings`,
          inputs: {},
          values: [
            {
              handle: 'settings',
              ...any,
              value: {
                department: name,
                period: 'weekly',
                report: `Summarize ${name.toLowerCase()} order activity, exceptions and outstanding work.`,
                threshold: index + 1,
              },
            },
          ],
        }),
        edge('start', `metric-${index}`),
      )
    }
    return operations
  }
  if (id == 'concurrent-edit')
    return [
      start,
      ...connector('notify', 'Customer notification', 'lab-notifications.send', 'notifications-test', [{ handle: 'text', ...string }], [], { text: 'Pending' }),
      node('notes', { kind: 'value', name: 'Operator notes', description: 'Initial note', inputs: {}, values: [] }),
      edge('start', 'notify'),
    ]
  const operations: ChangeOperation[] = [
    start,
    ...connector(
      'orders',
      'Read orders',
      'lab-orders.list',
      'orders-test',
      [],
      [
        { handle: 'orders', ...any },
        { handle: 'order', ...any },
      ],
    ),
    edge('start', 'orders'),
  ]
  if (id == 'repair-amount')
    return [
      ...operations,
      { kind: 'module.create', moduleId: 'amount-code', module: { name: 'Format amounts', imports: [], source: amountSource } },
      node('format', {
        kind: 'task',
        name: 'Format amounts',
        inputs: {},
        task: {
          name: 'Format amounts',
          moduleId: 'amount-code',
          inputs: [{ handle: 'orders', ...any }],
          outputs: [{ handle: 'text', ...string }],
          capabilities: [],
        },
      }),
      source('format', 'orders', 'orders', 'orders'),
      edge('orders', 'format'),
    ]
  return [
    ...operations,
    ...connector('notify', 'Customer notification', 'lab-notifications.send-json', 'notifications-test', [{ handle: 'payload', ...any }], []),
    ...connector('archive', 'Internal archive', 'lab-archive.save', 'archive-test', [{ handle: 'payload', ...any }], []),
    source('notify', 'payload', 'orders', 'order'),
    source('archive', 'payload', 'orders', 'order'),
    edge('orders', 'notify'),
    edge('orders', 'archive'),
  ]
}
export const emptyContent: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { graph: { nodes: {}, edges: [] }, bindings: {} },
}
export function initialContent(id: string) {
  return applyFlowChanges(emptyContent, initialOperations(id))
}
export interface Sample {
  name: string
  orders: JsonValue
  order: JsonValue
  failure?: boolean
  notification?: JsonValue
  formatted?: string
  outputs?: Record<string, JsonValue>
  parameters?: Record<string, JsonValue>
}
export function samples(id: string, stage = 0): Sample[] {
  if (id == 'fulfillment-ops') return fulfillmentSamples(stage)
  if (id == 'order-alert')
    return [[], [{ amount: 99 }], [{ amount: 60 }, { amount: 40 }], [{ amount: 60 }, { amount: 65 }]].map((orders, index) => ({
      name: ['empty', 'below', 'equal', 'above'][index]!,
      orders,
      order,
      notification: index == 3 ? '125' : undefined,
    }))
  if (id == 'repair-amount')
    return [
      { name: 'null', orders: [{ amount: null }], order, formatted: '0.00' },
      { name: 'zero', orders: [{ amount: 0 }], order, formatted: '0.00' },
      { name: 'ordinary', orders: [{ amount: 12.5 }, { amount: -2 }], order, formatted: '12.50, -2.00' },
      { name: 'missing', orders: null, order, failure: true },
    ]
  return [{ name: 'default', orders: [], order }]
}
function effectiveNode(content: RevisionContent, id: string): unknown {
  const n = content.document.graph.nodes[id]
  if (n?.kind != 'task') return n
  const { task, ...instance } = n
  if ('moduleId' in task) {
    const { moduleId: _moduleId, ...definition } = task
    return { ...instance, task: definition, code: content.modules[task.moduleId] }
  }
  const { name: _taskName, ...configuration } = task
  if (configuration.executor.kind == 'agent') {
    const { notification, tools, ...executor } = configuration.executor
    return {
      ...instance,
      task: {
        ...configuration,
        executor: {
          ...executor,
          tools: tools.map((tool) => {
            const { id: _toolId, ...settings } = tool
            return settings
          }),
          ...(notification == null ? {} : { notification }),
        },
      },
    }
  }
  return { ...instance, task: configuration }
}
/** Independent assertions: compare behavior and preserved effective configurations, not generated IDs. */
export function assertions(id: string, base: RevisionContent, current: RevisionContent): string[] {
  if (id == 'fulfillment-ops') return []
  const errors: string[] = []
  const allowed = new Set(
    id.startsWith('specialize-summary') ? ['customer'] : id == 'customer-redaction' ? ['notify'] : id == 'repair-amount' ? ['format'] : ['notify', 'notes'],
  )
  for (const nodeId of Object.keys(base.document.graph.nodes)) {
    if (!allowed.has(nodeId) && !isDeepStrictEqual(effectiveNode(base, nodeId), effectiveNode(current, nodeId)))
      errors.push(`Unrelated node ${nodeId} changed.`)
  }
  if (id.startsWith('specialize-summary')) {
    if (!isDeepStrictEqual(Object.keys(base.document.graph.nodes).toSorted(), Object.keys(current.document.graph.nodes).toSorted()))
      errors.push('Unexpected node set changes.')
    const before = effectiveNode(base, 'customer') as { task: ManagedTaskDefinition },
      after = effectiveNode(current, 'customer') as { task?: ManagedTaskDefinition }
    const expected = {
      ...before,
      task: {
        ...before.task,
        executor: { ...before.task.executor, prompt: summaryPrompt.replace('Include internal cost breakdown.', 'Exclude internal cost breakdown.') },
      },
    }
    if (!isDeepStrictEqual(expected, after)) errors.push('Only the requested customer prompt rule may change.')
  }
  if (id == 'repair-amount') {
    const before = effectiveNode(base, 'format') as Record<string, unknown>,
      after = effectiveNode(current, 'format') as Record<string, unknown>
    if (after == null || !isDeepStrictEqual({ ...before, code: undefined }, { ...after, code: undefined }))
      errors.push('Formatter configuration and schemas must remain unchanged.')
  }
  if (id == 'concurrent-edit') {
    if (current.document.graph.nodes.notes?.description != 'Operator reviewed') errors.push('Concurrent operator note was lost.')
    const n = current.document.graph.nodes.notify
    if (n?.kind != 'task' || !isDeepStrictEqual(n.inputs.text, { kind: 'value', value: 'Order received' })) errors.push('Notification text is incorrect.')
    const before = effectiveNode(base, 'notify') as Record<string, unknown>
    const after = effectiveNode(current, 'notify') as Record<string, unknown>
    if (!isDeepStrictEqual({ ...after, inputs: before.inputs }, before)) errors.push('Other notification settings changed.')
    if (
      !isDeepStrictEqual({ ...current.document.graph.nodes.notes, description: base.document.graph.nodes.notes?.description }, base.document.graph.nodes.notes)
    )
      errors.push('Other operator note settings changed.')
    if (Object.keys(current.document.graph.nodes).length != Object.keys(base.document.graph.nodes).length) errors.push('Unexpected nodes were created.')
  }
  if (id == 'customer-redaction') {
    const notify = effectiveNode(current, 'notify') as Record<string, unknown>,
      before = effectiveNode(base, 'notify') as Record<string, unknown>
    if (!isDeepStrictEqual({ ...notify, inputs: before.inputs }, before)) errors.push('Notification settings changed.')
    const incoming = current.document.graph.edges.filter((e) => e.target == 'notify')
    if (incoming.length != 1 || incoming[0]!.source == 'orders') errors.push('Insert a processing step before Customer notification.')
    if (!current.document.graph.edges.some((e) => e.source == 'orders' && e.target == incoming[0]?.source))
      errors.push('Processing step is not on the order execution path.')
  } else if (id != 'order-alert' && !isDeepStrictEqual(base.document.graph.edges, current.document.graph.edges)) errors.push('Execution relationships changed.')
  return errors
}
