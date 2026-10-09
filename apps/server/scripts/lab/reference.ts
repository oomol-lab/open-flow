import type { AuthoringEdit } from '@oomol-lab/open-flow/control-requests'
import type { ToolCall } from './driver.ts'

import { randomUUID } from 'node:crypto'
import { referenceFulfillment } from './fulfillmentReference.ts'
const account = (result: Record<string, unknown>, name: string) =>
  (result.connections as { displayName: string; connectionId: string }[]).find((a) => a.displayName == name)!.connectionId
/** Uses only caller-visible tools. No fixture, service, database or expected-result imports. */
export async function reference(call: ToolCall, id: string, flowId: string, stage = 0) {
  if (id == 'fulfillment-ops') return referenceFulfillment(call, flowId, stage)
  async function find(name: string) {
    const result = await call('flow_search', { flowId, query: name })
    const matches = (result.data as { matches: { node: string; field: string; excerpt: string }[] }).matches.filter(
      (m) => m.field == 'name' && m.excerpt == name,
    )
    if (matches.length != 1) throw new Error(`Expected one node named ${name}`)
    return matches[0]!.node
  }
  async function read(nodes?: string[]) {
    return call('flow_read', { flowId, ...(nodes == null ? {} : { nodes }) })
  }
  let savedRevision: unknown
  async function submit(baseRevision: unknown, edits: AuthoringEdit[]) {
    const result = await call('flow_edit', { flowId, baseRevision, requestId: randomUUID(), edits })
    savedRevision = result.revision
    return result
  }
  const dataPort = { schema: {}, nullable: true },
    stringPort = { schema: { type: 'string' }, nullable: false }
  if (id == 'order-alert') {
    const catalog = await call('connector_search', { flowId, query: 'orders' }),
      notifyCatalog = await call('connector_search', { flowId, query: 'Send notification' })
    const orderAction = (catalog.actions as { actionId: string; name: string; serviceId: string }[]).find((a) => a.name == 'List orders')!
    const notification = (notifyCatalog.actions as { actionId: string; name: string; serviceId: string }[]).find((a) => a.name == 'Send notification')!
    const ordersAccounts = await call('connector_connections', { flowId, serviceId: orderAction.serviceId }),
      notifyAccounts = await call('connector_connections', { flowId, serviceId: notification.serviceId })
    await call('flow_schema', { flowId, action: orderAction.actionId })
    await call('flow_schema', { flowId, action: notification.actionId })
    for (const type of ['manual', 'code', 'condition']) await call('flow_schema', { type })
    const before = await read()
    await submit(before.revision, [
      { op: 'node.add', as: 'start', type: 'manual', name: 'Manual trigger' },
      {
        op: 'node.add',
        as: 'orders',
        type: 'connector',
        name: 'Read orders',
        config: { action: orderAction.actionId, connectionId: account(ordersAccounts, 'Orders test account') },
      },
      {
        op: 'node.add',
        as: 'sum',
        type: 'code',
        name: 'Sum amounts',
        config: {
          inputs: { orders: dataPort },
          outputs: { total: { schema: { type: 'number' }, nullable: false }, text: stringPort },
        },
        code: 'export default ({orders}) => { const total = orders.reduce((sum, order) => sum + order.amount, 0); return {total, text:String(total)} }',
      },
      {
        op: 'node.add',
        as: 'threshold',
        type: 'condition',
        name: 'Above threshold',
        config: {
          match: 'first',
          branches: [
            {
              name: 'above',
              when: { left: { kind: 'output', node: '$sum', port: 'total' }, operator: '>', right: { kind: 'value', value: 100 } },
            },
          ],
        },
      },
      {
        op: 'node.add',
        as: 'notify',
        type: 'connector',
        name: 'Customer notification',
        config: { action: notification.actionId, connectionId: account(notifyAccounts, 'Notifications test account') },
      },
      { op: 'edge.connect', source: '$start', target: '$orders' },
      { op: 'edge.connect', source: '$orders', target: '$sum' },
      { op: 'edge.connect', source: '$sum', target: '$threshold' },
      { op: 'edge.connect', source: '$threshold', target: '$notify', branch: 'above' },
      { op: 'input.set', node: '$sum', input: 'orders', source: { kind: 'output', node: '$orders', port: 'orders' } },
      { op: 'input.set', node: '$notify', input: 'text', source: { kind: 'output', node: '$sum', port: 'text' } },
    ])
  } else if (id == 'customer-redaction') {
    const notify = await find('Customer notification'),
      orders = await find('Read orders'),
      before = await read([notify, orders])
    await call('flow_schema', { type: 'code' })
    await submit(before.revision, [
      {
        op: 'node.add',
        as: 'redact',
        type: 'code',
        name: 'Customer order fields',
        config: { outputs: { payload: dataPort } },
        inputs: { order: { kind: 'output', node: orders, port: 'order' } },
        code: 'export default ({order}) => ({payload:{orderId:order.orderId,total:order.total}})',
      },
      { op: 'edge.disconnect', source: orders, target: notify },
      { op: 'edge.connect', source: orders, target: '$redact' },
      { op: 'edge.connect', source: '$redact', target: notify },
      { op: 'input.set', node: notify, input: 'payload', source: { kind: 'output', node: '$redact' } },
    ])
  } else if (id.startsWith('specialize-summary')) {
    const customer = await find('Customer summary'),
      before = await read([customer])
    await call('flow_read', { flowId, revision: before.revision, text: { node: customer, field: 'prompt' } })
    await submit(before.revision, [
      { op: 'text.edit', node: customer, field: 'prompt', oldText: 'Include internal cost breakdown.', newText: 'Exclude internal cost breakdown.' },
    ])
  } else if (id == 'repair-amount') {
    const runs = await call('run_list', { flowId }),
      run = (runs.runs as { runId: string; status: string }[]).find((r) => r.status == 'failed')!
    if (run == null) throw new Error('Expected a failed run to inspect.')
    const evidence = await call('run_events', { runId: run.runId })
    const formatter = (evidence.events as { kind: string; payload: { nodeId?: string } }[]).find((event) => event.kind == 'node.failed')?.payload.nodeId
    if (formatter == null) throw new Error('Failed Run must identify a node.')
    const before = await read([formatter])
    await call('flow_read', { flowId, revision: before.revision, text: { node: formatter, field: 'code' } })
    await submit(before.revision, [{ op: 'text.edit', node: formatter, field: 'code', oldText: 'amount.toFixed(2)', newText: '(amount ?? 0).toFixed(2)' }])
  } else if (id == 'concurrent-edit') {
    const notify = await find('Customer notification'),
      before = await read([notify]),
      edits: AuthoringEdit[] = [{ op: 'input.set', node: notify, input: 'text', source: { kind: 'value', value: 'Order received' } }]
    try {
      await submit(before.revision, edits)
      throw new Error('Expected a revision conflict.')
    } catch (error) {
      if (!String(error).includes('flow.revision-conflict')) throw error
    }
    const refreshed = await read([notify])
    await submit(refreshed.revision, edits)
  }
  await call('flow_check', { flowId, revisionId: savedRevision })
}
