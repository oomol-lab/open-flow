import type { ChangeOperation, JsonValue, ManagedTaskDefinition, RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { applyFlowChanges, currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { isDeepStrictEqual } from 'node:util'
import { fulfillmentSamples, fulfillmentStages } from './fulfillment.ts'

export const scenarios = [
  {
    id: 'webhook-response',
    entry: { kind: 'webhook' },
    name: 'Return workflow outputs over HTTP',
    version: 2,
    task: 'Create a POST Webhook named Published hook with a required string message field, an Echo code node forwarding the message, and Workflow Outputs declaring message and an integer status with literal value 201. Configure a workflow-output response selecting message with a 30-second timeout, preserving fixed response text accepted and fixed status 202. Bind the status code to output status, then rename status to httpStatus and confirm that reference follows. Rename the output field to reply through public editing and confirm the Webhook follows the rename. Change only its timeout to 15 seconds. Switch to immediate response by explicitly clearing responseBody and responseStatusCodeOutput and read back the preserved fixed text; restore the dynamic reply body and httpStatus status. Check and publish, inspect the online configuration, then change only the Draft hook method to PUT and name to Draft hook. Leave Live enabled; its POST response must return the request message as plain text with HTTP status 201.',
  },
  {
    id: 'node-errors',
    entry: { kind: 'start' },
    name: 'Handle node errors',
    version: 1,
    task: 'Create Start and two Code nodes. Successful task returns {error: "business"}; Failed task throws Error("Expected failure"). Enable system error output on both. Rename Successful task to Successful task updated, change its failure mode to stop and then back to error, preserving its business output. Connect both to Outputs. Return business from the successful ordinary error output, successError from its system error, and failure from the failed system error. Read settings and bindings, check and run. Do not add an error execution branch.',
  },
  {
    id: 'node-retries',
    entry: { kind: 'start' },
    name: 'Configure node retries',
    version: 1,
    task: 'Create Start and two Code nodes returning {value: 42}. Configure Retried task to retry twice with a 2-second interval on creation. Update only its interval to 3 seconds and rename it Retried task updated, preserving its retry count and outputs. Create Cleared task with one retry and a 1-second interval, then explicitly clear its retry policy. Connect Start to both tasks. Read both settings back, check and execute the workflow.',
  },
  {
    id: 'workflow-call',
    entry: { kind: 'start' },
    name: 'Call a published workflow',
    version: 1,
    task: 'Find the published workflow Lab double. Add Start with required number amount, call that workflow using the Start amount, and return its total through Workflow Outputs. Rename the call node without reloading its interface, then explicitly refresh its interface. Preserve the input binding.',
  },
  {
    id: 'workflow-outputs',
    entry: { kind: 'start' },
    name: 'Declare and compute workflow outputs',
    version: 1,
    task: 'Build a workflow with Start parameters: required number amount, required string message, and nullable string note. Create separate Code nodes to double amount and forward message. Join both execution paths at one Outputs node. Define workflow outputs total (required number), message (required string), and note (nullable string). Map total and message from the corresponding Code results and note from Start. Update only the total description to "Invoice total" in a later edit, preserving definitions and mappings. Keep an independent Code branch that returns {logged: true}; workflow outputs and node results must both remain available.',
  },
  {
    id: 'start-parameters',
    entry: { kind: 'start' },
    name: 'Call a Flow with Start parameters',
    version: 1,
    task: 'Build a workflow with one Start node accepting required string message and required number amount parameters plus nullable string note. Describe amount as "Invoice total". Archive exactly {message,amount,note} using Archive test account. These values must come from the Start parameters, including zero amounts and omitted notes becoming null. Preserve the parameter schemas when updating their descriptions.',
  },
  {
    id: 'connector-responses',
    entry: { kind: 'start' },
    name: 'Consume dynamic and spreadsheet Connector responses',
    version: 3,
    task: 'Build a manually triggered workflow. Initially defer the dynamic response account with an empty connectionId, read it back and check the workflow, then select Data test account before the final run. Read the dynamic response and spreadsheet cells from Lab Data using Data test account. Pass both results to a code node, then archive {dynamic, values} using Archive test account. Preserve the complete dynamic response, including its output field, and all spreadsheet cell types, including null. Do not hardcode response data.',
  },
  {
    id: 'webhook-live',
    transport: 'cli',
    entry: { kind: 'webhook' },
    name: 'Publish and discover a Webhook entry',
    version: 2,
    task: 'Create a POST Webhook named Published hook with a required string message field and a code node returning that message. Publish it, inspect its online URL and request contract, then change only the Draft hook to PUT and name it Draft hook. Confirm the online entry still describes the published POST contract. Leave the published workflow enabled for acceptance verification.',
  },
  {
    id: 'fulfillment-ops',
    entry: { kind: 'start' },
    name: 'Evolve a fulfillment operations workflow',
    version: 2,
    task: fulfillmentStages[0]!.task,
  },
  {
    id: 'order-alert',
    entry: { kind: 'start' },
    name: 'Build an order alert',
    version: 2,
    task: 'Build a workflow with a Start node. Find the action that lists orders and use Orders test account. Sum their amounts. If the total is greater than 100, send its decimal total as a notification using Notifications test account. Empty orders produce zero and no notification.',
  },
  {
    id: 'customer-redaction',
    entry: { node: 'start' },
    name: 'Add customer data redaction',
    version: 2,
    task: 'Customer notification must contain JSON with only orderId and total. Insert a processing step on its execution path. Internal archive must continue receiving the complete original order. Keep the existing accounts, other settings and behavior.',
  },
  {
    id: 'specialize-summary',
    entry: { node: 'start' },
    name: 'Specialize one independent summary',
    version: 3,
    task: 'Find Customer summary and replace only the prompt rule "Include internal cost breakdown." with "Exclude internal cost breakdown." Keep all other prompt content and configuration. Internal summary and the other nodes must remain unchanged.',
  },
  {
    id: 'specialize-summary-large',
    entry: { node: 'start' },
    name: 'Specialize one independent summary in a larger flow',
    version: 3,
    task: 'Find Customer summary and replace only the prompt rule "Include internal cost breakdown." with "Exclude internal cost breakdown." Keep all other prompt content and configuration. Internal summary and the other nodes must remain unchanged.',
  },
  {
    id: 'repair-amount',
    entry: { node: 'start' },
    name: 'Repair a failed amount formatter',
    version: 2,
    task: 'Inspect the existing failed Run and fix the amount formatter. Null amounts must format as zero, while zero and ordinary amounts keep two decimal places. A missing order list must still fail. Preserve schemas, unrelated code and workflow behavior.',
  },
  {
    id: 'concurrent-edit',
    entry: { node: 'start' },
    name: 'Recover from a concurrent edit',
    version: 2,
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
/** Reference suites run only scenarios supported by their selected transport. */
export function testScenarios(transport: 'cli' | 'mcp', id?: string): readonly Scenario[] {
  return (id == null ? scenarios : [scenario(id)]).filter((item) => {
    if (!('transport' in item) || item.transport == transport) return true
    if (id != null) throw new Error(`${item.id} supports ${item.transport} only.`)
    return false
  })
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
  if (
    id == 'node-errors' ||
    id == 'node-retries' ||
    id == 'workflow-call' ||
    id == 'workflow-outputs' ||
    id == 'start-parameters' ||
    id == 'connector-responses' ||
    id == 'order-alert' ||
    id == 'fulfillment-ops' ||
    id == 'webhook-response' ||
    id == 'webhook-live'
  )
    return []
  const start = node('start', { inputDefs: [], kind: 'start', name: 'Start' })
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
  if (id == 'node-errors') return [{ name: 'handled-and-successful', orders: [], order }]
  if (id == 'node-retries') return [{ name: 'configured-and-cleared', orders: [], order }]
  if (id == 'workflow-call') return [0, -2.5, 12.5].map((amount) => ({ name: String(amount), orders: [], order, outputs: { amount } }))
  if (id == 'workflow-outputs' || id == 'start-parameters') {
    const cases: Pick<Sample, 'name' | 'outputs'>[] = [
      { name: 'zero-and-omitted', outputs: { message: 'Created', amount: 0 } },
      { name: 'explicit-null', outputs: { message: 'Refunded', amount: -2.5, note: null } },
      { name: 'ordinary', outputs: { message: 'Paid', amount: 12.5, note: 'Invoice A-1' } },
    ]
    return cases.map((sample) => Object.assign({}, sample, { orders: [], order }))
  }
  if (id == 'fulfillment-ops') return fulfillmentSamples(stage)
  if (id == 'connector-responses')
    return [
      [],
      [
        ['term', 7, true, null],
        ['', 0, false, null],
      ],
    ].map((orders, index) => ({ name: index == 0 ? 'empty' : 'mixed-cells', orders, order }))
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
  if (id == 'node-errors') {
    const tasks = Object.values(current.document.graph.nodes).filter((candidate) => candidate.kind == 'task')
    return tasks.length == 2 &&
      tasks.every((candidate) => candidate.onError == 'error') &&
      tasks.some((candidate) => candidate.name == 'Successful task updated')
      ? []
      : ['Enable system error output on both tasks and preserve settings when renaming.']
  }
  if (id == 'node-retries') {
    const tasks = Object.values(current.document.graph.nodes).filter((candidate) => candidate.kind == 'task')
    const configured = tasks.find((candidate) => candidate.name == 'Retried task updated')
    const cleared = tasks.find((candidate) => candidate.name == 'Cleared task')
    return tasks.length == 2 &&
      configured != null &&
      isDeepStrictEqual(configured.retry, { maxRetries: 2, intervalMs: 3000 }) &&
      cleared != null &&
      cleared.retry === undefined
      ? []
      : ['Preserve the configured retry count and explicitly clear the other retry policy.']
  }
  if (id == 'workflow-call')
    return Object.values(current.document.graph.nodes).filter(
      (candidate) => candidate.kind == 'task' && 'executor' in candidate.task && candidate.task.executor.kind == 'workflow',
    ).length == 1
      ? []
      : ['Create one workflow call.']
  if (id == 'workflow-outputs') {
    const outputs = Object.entries(current.document.graph.nodes).filter(([, candidate]) => candidate.kind == 'outputs')
    const definitions = Object.fromEntries((outputs[0]?.[1].kind == 'outputs' ? outputs[0][1].outputDefs : []).map((port) => [port.handle, port]))
    const fields = [
      ['total', 'number', false],
      ['message', 'string', false],
      ['note', 'string', true],
    ] as const
    if (outputs.length != 1 || current.document.graph.edges.some((candidate) => candidate.source == outputs[0]![0])) return ['Create one Outputs sink.']
    if (
      Object.keys(definitions).length != 3 ||
      fields.some(([name, type, nullable]) => !isDeepStrictEqual(definitions[name]?.jsonSchema, { type }) || definitions[name]?.nullable != nullable) ||
      definitions.total?.description != 'Invoice total'
    )
      return ['Preserve the output contract when editing its description.']
    if (current.document.graph.edges.filter((candidate) => candidate.target == outputs[0]![0]).length != 2) return ['Join both Code paths at Outputs.']
    return []
  }

  if (id == 'start-parameters') {
    const starts = Object.values(current.document.graph.nodes).filter((candidate) => candidate.kind == 'start')
    if (starts.length != 1 || starts[0]?.kind != 'start') return ['Create one Start node.']
    const parameters = Object.fromEntries(starts[0].inputDefs.map((port) => [port.handle, port]))
    const amount = parameters.amount
    if (
      parameters.message?.nullable !== false ||
      !isDeepStrictEqual(parameters.message.jsonSchema, { type: 'string' }) ||
      amount?.nullable !== false ||
      !isDeepStrictEqual(amount.jsonSchema, { type: 'number' }) ||
      amount.description !== 'Invoice total' ||
      parameters.note?.nullable !== true ||
      !isDeepStrictEqual(parameters.note.jsonSchema, { type: 'string' }) ||
      Object.keys(parameters).length !== 3
    )
      return ['Declare required message/amount and nullable note parameters while preserving their schemas.']
    return []
  }
  if (id == 'connector-responses' || id == 'fulfillment-ops' || id == 'webhook-live' || id == 'webhook-response') return []
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
