import type { AuthoringEdit } from '@oomol-lab/open-flow/control-requests'
import type { ToolCall } from './driver.ts'

import { randomUUID } from 'node:crypto'

const data = { schema: {}, nullable: true }
const text = { schema: { type: 'string' }, nullable: false }
const number = { schema: { type: 'number' }, nullable: false }
const initialCode = `function amount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid amount');
  return value;
}
export default function ({orders, batchName}) {
  if (!Array.isArray(orders)) throw new Error('Order list is required');
  const normalized = orders.map(order => ({...order, amount: amount(order.amount)}));
  const paidTotal = normalized.filter(order => order.status === 'paid').reduce((sum, order) => sum + order.amount, 0);
  return {archive: {batch: batchName, orderCount: orders.length, paidTotal: paidTotal.toFixed(2)}};
}`

/** A public-tool-only solution. Stages discover and read the persisted previous result. */
export async function referenceFulfillment(call: ToolCall, flowId: string, stage: number) {
  async function find(name: string) {
    const result = await call('flow_search', { flowId, query: name })
    const matches = (result.data as { matches: { node: string; field: string; excerpt: string }[] }).matches.filter(
      (match) => match.field == 'name' && match.excerpt == name,
    )
    if (matches.length != 1) throw new Error(`Expected one node named ${name}`)
    return matches[0]!.node
  }
  async function action(name: string, account: string) {
    const result = await call('connector_search', { flowId, query: name })
    const selected = (result.actions as { name: string; actionId: string; serviceId: string }[]).find((item) => item.name == name)
    if (selected == null) throw new Error(`Action not found: ${name}`)
    const accounts = await call('connector_connections', { flowId, serviceId: selected.serviceId })
    const connection = (accounts.connections as { displayName: string; connectionId: string }[]).find((item) => item.displayName == account)
    if (connection == null) throw new Error(`Account not found: ${account}`)
    await call('flow_schema', { flowId, action: selected.actionId })
    return { action: selected.actionId, connectionId: connection.connectionId }
  }
  async function read(nodes?: string[]) {
    return call('flow_read', { flowId, ...(nodes == null ? {} : { nodes }) })
  }
  async function readCode(node: string, revision: unknown) {
    let start = 1
    const parts: string[] = []
    while (true) {
      const result = await call('flow_read', { flowId, revision, text: { node, field: 'code', start } })
      const view = (result.data as { text: { content: string; nextStart?: number; truncated: boolean } }).text
      parts.push(view.content)
      if (!view.truncated) return parts.join('\n')
      if (view.nextStart == null) throw new Error('Truncated source has no continuation')
      start = view.nextStart
    }
  }
  let revision: unknown
  async function submit(baseRevision: unknown, edits: AuthoringEdit[]) {
    const saved = await call('flow_edit', { flowId, baseRevision, requestId: randomUUID(), edits })
    revision = saved.revision
  }
  if (stage == 0) {
    const query = await action('List fulfillment batch', 'Orders test account')
    const archive = await action('Archive order', 'Archive test account')
    for (const type of ['manual', 'code']) await call('flow_schema', { type })
    const before = await read()
    await submit(before.revision, [
      { op: 'node.add', as: 'start', type: 'manual', name: 'Start fulfillment review' },
      { op: 'node.add', as: 'orders', type: 'connector', name: 'Read fulfillment batch', config: query },
      {
        op: 'node.add',
        as: 'calculate',
        type: 'code',
        name: 'Prepare fulfillment report',
        config: {
          inputs: { orders: data, batchName: text },
          outputs: { archive: data },
        },
        code: initialCode,
      },
      { op: 'node.add', as: 'archive', type: 'connector', name: 'Archive batch report', config: archive },
      { op: 'input.set', node: '$calculate', input: 'orders', source: { kind: 'output', node: '$orders', port: 'orders' } },
      { op: 'input.set', node: '$calculate', input: 'batchName', source: { kind: 'output', node: '$orders', port: 'batch' } },
      { op: 'input.set', node: '$archive', input: 'payload', source: { kind: 'output', node: '$calculate', port: 'archive' } },
      { op: 'edge.connect', source: '$start', target: '$orders' },
      { op: 'edge.connect', source: '$orders', target: '$calculate' },
      { op: 'edge.connect', source: '$calculate', target: '$archive' },
    ])
  } else if (stage == 1) {
    const calculate = await find('Prepare fulfillment report')
    const notification = await action('Send JSON notification', 'Notifications test account')
    await call('flow_schema', { type: 'condition' })
    const before = await read([calculate])
    const source = await readCode(calculate, before.revision)
    const updated = source.replace('({orders, batchName})', '({orders, batchName, slaHours})').replace(
      '  return {archive:',
      `  const overdue = normalized.filter(order => order.status === 'paid' && order.fulfillment === 'pending' && order.ageHours >= slaHours);
  const summary = {count: overdue.length, orderIds: overdue.map(order => order.orderId), total: overdue.reduce((sum, order) => sum + order.amount, 0).toFixed(2)};
  return {summary, count: overdue.length, archive:`,
    )
    await submit(before.revision, [
      {
        op: 'node.update',
        node: calculate,
        set: {
          config: {
            inputs: { slaHours: number },
            outputs: { summary: data, count: number },
          },
        },
      },
      { op: 'text.set', node: calculate, field: 'code', text: updated },
      {
        op: 'node.add',
        as: 'overdue',
        type: 'condition',
        name: 'Overdue orders exist',
        config: {
          match: 'first',
          branches: [
            {
              name: 'yes',
              when: {
                left: { kind: 'output', node: calculate, port: 'count' },
                operator: '>',
                right: { kind: 'value', value: 0 },
              },
            },
          ],
        },
      },
      { op: 'node.add', as: 'notify', type: 'connector', name: 'Notify operations', config: notification },
      { op: 'input.set', node: '$notify', input: 'payload', source: { kind: 'output', node: calculate, port: 'summary' } },
      { op: 'edge.connect', source: calculate, target: '$overdue' },
      { op: 'edge.connect', source: '$overdue', target: '$notify', branch: 'yes' },
    ])
  } else if (stage == 2) {
    const calculate = await find('Prepare fulfillment report'),
      gate = await find('Overdue orders exist'),
      notify = await find('Notify operations')
    const notification = await action('Send notification', 'Notifications test account')
    const supplier = await action('Request supplier fulfillment', 'Supplier test account')
    await call('flow_schema', { type: 'agent' })
    const before = await read([calculate, gate, notify])
    const source = await readCode(calculate, before.revision)
    const updated = source.replace(
      'return {summary, count:',
      'return {summary, supplier: overdue.map(({orderId, sku, quantity}) => ({orderId, sku, quantity})), count:',
    )
    await submit(before.revision, [
      {
        op: 'node.update',
        node: calculate,
        set: {
          config: {
            outputs: { supplier: data },
          },
        },
      },
      { op: 'text.set', node: calculate, field: 'code', text: updated },
      {
        op: 'node.add',
        as: 'summary',
        type: 'agent',
        name: 'Summarize overdue orders',
        config: { model: 'lab-model', tools: [], code: false, maxRounds: 1 },
        inputs: { orders: { kind: 'output', node: calculate, port: 'summary' } },
        prompt: 'Summarize these overdue orders for the operations team. Do not promise delivery dates.\n{{orders}}',
      },
      { op: 'input.set', node: notify, input: 'payload', source: { kind: 'default' } },
      { op: 'node.update', node: notify, set: { config: notification } },
      { op: 'input.set', node: notify, input: 'text', source: { kind: 'output', node: '$summary' } },
      { op: 'edge.disconnect', source: gate, target: notify, branch: 'yes' },
      { op: 'edge.connect', source: gate, target: '$summary', branch: 'yes' },
      { op: 'edge.connect', source: '$summary', target: notify },
      { op: 'node.add', as: 'supplier', type: 'connector', name: 'Request overdue fulfillment', config: supplier },
      { op: 'input.set', node: '$supplier', input: 'payload', source: { kind: 'output', node: calculate, port: 'supplier' } },
      { op: 'edge.connect', source: gate, target: '$supplier', branch: 'yes' },
    ])
  } else if (stage == 3) {
    const calculate = await find('Prepare fulfillment report')
    const before = await read([calculate])
    await readCode(calculate, before.revision)
    await submit(before.revision, [
      { op: 'text.edit', node: calculate, field: 'code', oldText: 'order.ageHours >= slaHours', newText: 'order.ageHours > slaHours' },
      {
        op: 'text.edit',
        node: calculate,
        field: 'code',
        oldText: "function amount(value) {\n  if (typeof value !== 'number'",
        newText: `function amount(value) {
  if (value === null) return 0;
  if (typeof value === 'string' && /^[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)$/.test(value)) value = Number(value);
  if (typeof value !== 'number'`,
      },
    ])
  } else throw new Error(`Unknown fulfillment stage ${stage}`)
  await call('flow_check', { flowId, revisionId: revision })
}
