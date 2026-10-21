import type { AuthoringEdit } from '@oomol-lab/open-flow/control-requests'
import type { ToolCall } from './driver.ts'

import { randomUUID } from 'node:crypto'
import { referenceFulfillment } from './fulfillmentReference.ts'
import { referenceEarlyResponse, referenceLive } from './liveReference.ts'
const account = (result: Record<string, unknown>, name: string) =>
  (result.connections as { displayName: string; connectionId: string }[]).find((a) => a.displayName == name)!.connectionId
/** Uses only caller-visible tools. No fixture, service, database or expected-result imports. */
export async function reference(call: ToolCall, id: string, flowId: string, stage = 0) {
  if (id === 'webhook-response-node') return referenceEarlyResponse(call, flowId)
  if (id == 'webhook-response') return referenceLive(call, flowId, true)
  if (id == 'webhook-live') return referenceLive(call, flowId)
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
  if (id == 'wait-auto-continue') {
    await call('flow_schema', { type: 'wait' })
    const before = await read()
    const created = await submit(before.revision, [
      { op: 'node.add', type: 'start', as: 'start', name: 'Start' },
      {
        op: 'node.add',
        type: 'wait',
        as: 'relative',
        name: 'Relative wait',
        config: { autoContinue: { kind: 'after', durationMs: 100 } },
        inputs: { order: { kind: 'value', value: 42 } },
      },
      { op: 'node.add', type: 'wait', as: 'date', name: 'Date wait', config: { autoContinue: { kind: 'at', at: '1970-01-01T00:00:00Z', timezone: 'UTC' } } },
      { op: 'node.add', type: 'wait', as: 'manual', name: 'Manual wait', config: { autoContinue: { kind: 'after', durationMs: 1000 } } },
      {
        op: 'node.add',
        type: 'outputs',
        as: 'out',
        name: 'Outputs',
        config: { outputDefs: { done: { schema: { type: 'boolean' }, nullable: false } } },
        inputs: { done: { kind: 'value', value: true } },
      },
      { op: 'edge.connect', source: '$start', target: '$relative' },
      { op: 'edge.connect', source: '$relative', branch: 'continue', target: '$date' },
      { op: 'edge.connect', source: '$date', branch: 'continue', target: '$out' },
    ])
    const refs = created.nodes as Record<string, string>
    await submit(created.revision, [
      { op: 'node.update', node: refs.relative!, set: { name: 'Relative wait updated' } },
      { op: 'node.update', node: refs.manual!, clear: [['config', 'autoContinue']] },
    ])
    await read([refs.relative!, refs.date!, refs.manual!])
    await call('flow_check', { flowId, revisionId: savedRevision })
    return
  }
  if (id == 'node-errors') {
    await call('flow_schema', { type: 'code' })
    const before = await read()
    const created = await submit(before.revision, [
      { op: 'node.add', as: 'start', type: 'start', name: 'Start' },
      {
        op: 'node.add',
        as: 'success',
        type: 'code',
        name: 'Successful task',
        onError: 'error',
        config: { outputs: { error: stringPort } },
        code: 'export default () => ({error: "business"})',
      },
      {
        op: 'node.add',
        as: 'failure',
        type: 'code',
        name: 'Failed task',
        onError: 'error',
        config: { outputs: {} },
        code: 'export default () => {throw new Error("Expected failure")}',
      },
      {
        op: 'node.add',
        as: 'out',
        type: 'outputs',
        name: 'Outputs',
        config: { outputDefs: { business: dataPort, successError: dataPort, failure: dataPort } },
        inputs: {
          business: { kind: 'output', node: '$success', port: 'error' },
          successError: { kind: 'system', node: '$success', port: 'error' },
          failure: { kind: 'system', node: '$failure', port: 'error' },
        },
      },
      { op: 'edge.connect', source: '$start', target: '$success' },
      { op: 'edge.connect', source: '$start', target: '$failure' },
      { op: 'edge.connect', source: '$success', target: '$out' },
      { op: 'edge.connect', source: '$failure', target: '$out' },
    ])
    const refs = created.nodes as Record<string, string>
    await submit(created.revision, [{ op: 'node.update', node: refs.success!, set: { name: 'Successful task updated', onError: 'stop' } }])
    await submit(savedRevision, [{ op: 'node.update', node: refs.success!, set: { onError: 'error' } }])
    await read([refs.success!, refs.failure!, refs.out!])
    await call('flow_check', { flowId, revisionId: savedRevision })
    return
  }
  if (id == 'node-retries') {
    await call('flow_schema', { type: 'code' })
    const before = await read()
    const created = await submit(before.revision, [
      { op: 'node.add', as: 'start', type: 'start', name: 'Start' },
      {
        op: 'node.add',
        as: 'retry',
        type: 'code',
        name: 'Retried task',
        retry: { maxRetries: 2, intervalMs: 2000 },
        config: { outputs: { value: { schema: { type: 'number' }, nullable: false } } },
        code: 'export default () => ({value: 42})',
      },
      {
        op: 'node.add',
        as: 'clear',
        type: 'code',
        name: 'Cleared task',
        retry: { maxRetries: 1, intervalMs: 1000 },
        config: { outputs: { value: { schema: { type: 'number' }, nullable: false } } },
        code: 'export default () => ({value: 42})',
      },
      { op: 'edge.connect', source: '$start', target: '$retry' },
      { op: 'edge.connect', source: '$start', target: '$clear' },
    ])
    const refs = created.nodes as Record<string, string>
    const details = await read([refs.retry!, refs.clear!])
    await submit(details.revision, [
      { op: 'node.update', node: refs.retry!, set: { name: 'Retried task updated', retry: { intervalMs: 3000 } } },
      { op: 'node.update', node: refs.clear!, clear: [['retry']] },
    ])
    await read([refs.retry!, refs.clear!])
    await call('flow_check', { flowId, revisionId: savedRevision })
    return
  }
  if (id == 'workflow-call') {
    await call('flow_schema', { type: 'workflow' })
    const catalog = await call('flow_list', {})
    const target = (catalog.flows as { flowId: string; name: string }[]).find((flow) => flow.name == 'Lab double')
    if (target == null) throw new Error('Published target not found')
    const before = await read()
    await submit(before.revision, [
      { op: 'node.add', as: 'start', type: 'start', name: 'Start', config: { inputDefs: { amount: { schema: { type: 'number' }, nullable: false } } } },
      {
        op: 'node.add',
        as: 'call',
        type: 'workflow',
        name: 'Double',
        config: { flowId: target.flowId },
        inputs: { amount: { kind: 'output', node: '$start', port: 'amount' } },
      },
      {
        op: 'node.add',
        as: 'outputs',
        type: 'outputs',
        name: 'Outputs',
        inputs: { total: { kind: 'output', node: '$call', port: 'total' } },
        config: { outputDefs: { total: { schema: { type: 'number' }, nullable: false } } },
      },
      { op: 'edge.connect', source: '$start', target: '$call' },
      { op: 'edge.connect', source: '$call', target: '$outputs' },
    ])
    const ref = await find('Double')
    const saved = await read()
    await submit(saved.revision, [
      { op: 'node.update', node: ref, set: { name: 'Called double' } },
      { op: 'node.refresh', node: ref },
    ])
    await call('flow_check', { flowId, revisionId: savedRevision })
    return
  }
  if (id == 'workflow-outputs') {
    await call('flow_schema', { type: 'outputs' })
    const before = await read()
    await submit(before.revision, [
      {
        op: 'node.add',
        as: 'start',
        type: 'start',
        name: 'Start',
        config: {
          inputDefs: { amount: { schema: { type: 'number' }, nullable: false }, message: stringPort, note: { schema: { type: 'string' }, nullable: true } },
        },
      },
      {
        op: 'node.add',
        as: 'double',
        type: 'code',
        name: 'Double amount',
        config: { outputs: { value: { schema: { type: 'number' }, nullable: false } } },
        code: 'export default ({amount}) => ({value: amount * 2})',
        inputs: { amount: { kind: 'output', node: '$start', port: 'amount' } },
      },
      {
        op: 'node.add',
        as: 'message',
        type: 'code',
        name: 'Forward message',
        config: { outputs: { value: stringPort } },
        code: 'export default ({message}) => ({value: message})',
        inputs: { message: { kind: 'output', node: '$start', port: 'message' } },
      },
      {
        op: 'node.add',
        as: 'log',
        type: 'code',
        name: 'Independent result',
        config: { outputs: { logged: { schema: { type: 'boolean' }, nullable: false } } },
        code: 'export default () => ({logged: true})',
      },
      {
        op: 'node.add',
        as: 'outputs',
        type: 'outputs',
        name: 'Outputs',
        inputs: {
          total: { kind: 'output', node: '$double' },
          message: { kind: 'output', node: '$message' },
          note: { kind: 'output', node: '$start', port: 'note' },
        },
        config: {
          outputDefs: { total: { schema: { type: 'number' }, nullable: false }, message: stringPort, note: { schema: { type: 'string' }, nullable: true } },
        },
      },
      { op: 'edge.connect', source: '$start', target: '$double' },
      { op: 'edge.connect', source: '$start', target: '$message' },
      { op: 'edge.connect', source: '$start', target: '$log' },
      { op: 'edge.connect', source: '$double', target: '$outputs' },
      { op: 'edge.connect', source: '$message', target: '$outputs' },
    ])
    const saved = await read()
    await submit(saved.revision, [
      { op: 'node.update', node: await find('Outputs'), set: { config: { outputDefs: { total: { description: 'Invoice total' } } } } },
    ])
    await call('flow_check', { flowId, revisionId: savedRevision })
    return
  }
  if (id == 'start-parameters') {
    await call('flow_schema', { type: 'start' })
    const catalog = await call('connector_search', { flowId, query: 'Archive order' })
    const archive = (catalog.actions as { actionId: string; serviceId: string }[])[0]!
    const accounts = await call('connector_connections', { flowId, serviceId: archive.serviceId })
    await call('flow_schema', { flowId, action: archive.actionId })
    const before = await read()
    await submit(before.revision, [
      {
        op: 'node.add',
        as: 'start',
        type: 'start',
        name: 'Start',
        config: {
          inputDefs: {
            message: stringPort,
            amount: { schema: { type: 'number' }, nullable: false, description: 'Amount' },
            note: { schema: { type: 'string' }, nullable: true },
          },
        },
      },
      {
        op: 'node.add',
        as: 'combine',
        type: 'code',
        name: 'Invoice parameters',
        config: { outputs: { payload: dataPort } },
        code: 'export default ({message,amount,note}) => ({payload:{message,amount,note}})',
        inputs: {
          message: { kind: 'output', node: '$start', port: 'message' },
          amount: { kind: 'output', node: '$start', port: 'amount' },
          note: { kind: 'output', node: '$start', port: 'note' },
        },
      },
      {
        op: 'node.add',
        as: 'archive',
        type: 'connector',
        name: 'Archive invoice',
        config: { action: archive.actionId, connectionId: account(accounts, 'Archive test account') },
        inputs: { payload: { kind: 'output', node: '$combine' } },
      },
      { op: 'edge.connect', source: '$start', target: '$combine' },
      { op: 'edge.connect', source: '$combine', target: '$archive' },
    ])
    const details = await read()
    await submit(details.revision, [
      { op: 'node.update', node: await find('Start'), set: { config: { inputDefs: { amount: { description: 'Invoice total' } } } } },
    ])
  } else if (id == 'connector-responses') {
    const catalog = await call('connector_search', { flowId, query: 'Read' })
    const available = catalog.actions as { actionId: string; name: string; serviceId: string }[]
    const dynamic = available.find((action) => action.name == 'Read dynamic response')!
    const cells = available.find((action) => action.name == 'Read spreadsheet cells')!
    const archiveCatalog = await call('connector_search', { flowId, query: 'Archive order' })
    const archive = (archiveCatalog.actions as typeof available)[0]!
    const dataAccounts = await call('connector_connections', { flowId, serviceId: dynamic.serviceId })
    const archiveAccounts = await call('connector_connections', { flowId, serviceId: archive.serviceId })
    for (const action of [dynamic, cells, archive]) await call('flow_schema', { flowId, action: action.actionId })
    const before = await read()
    await submit(before.revision, [
      { op: 'node.add', as: 'start', type: 'start', name: 'Start' },
      {
        op: 'node.add',
        as: 'dynamic',
        type: 'connector',
        name: 'Dynamic response',
        config: { action: dynamic.actionId, connectionId: '' },
      },
      {
        op: 'node.add',
        as: 'cells',
        type: 'connector',
        name: 'Spreadsheet cells',
        config: { action: cells.actionId, connectionId: account(dataAccounts, 'Data test account') },
      },
      {
        op: 'node.add',
        as: 'combine',
        type: 'code',
        name: 'Combine responses',
        code: 'export default ({dynamic, values}) => ({payload: {dynamic, values}})',
        config: { outputs: { payload: dataPort } },
        inputs: { dynamic: { kind: 'output', node: '$dynamic' }, values: { kind: 'output', node: '$cells', port: 'values' } },
      },
      {
        op: 'node.add',
        as: 'archive',
        type: 'connector',
        name: 'Archive responses',
        config: { action: archive.actionId, connectionId: account(archiveAccounts, 'Archive test account') },
        inputs: { payload: { kind: 'output', node: '$combine' } },
      },
      { op: 'edge.connect', source: '$start', target: '$dynamic' },
      { op: 'edge.connect', source: '$dynamic', target: '$cells' },
      { op: 'edge.connect', source: '$cells', target: '$combine' },
      { op: 'edge.connect', source: '$combine', target: '$archive' },
    ])
    const dynamicNode = await find('Dynamic response')
    const deferred = await read([dynamicNode])
    const detail = (deferred.data as { nodes: { config: { connectionId?: string } }[] }).nodes[0]!
    if (detail.config.connectionId !== '') throw new Error('Deferred account selection was not preserved.')
    const checked = await call('flow_check', { flowId, revisionId: savedRevision })
    if (!checked.valid) throw new Error('Explicitly deferred accounts must pass readiness checks.')
    await submit(deferred.revision, [{ op: 'node.update', node: dynamicNode, set: { config: { connectionId: account(dataAccounts, 'Data test account') } } }])
  } else if (id == 'order-alert') {
    const catalog = await call('connector_search', { flowId, query: 'orders' }),
      notifyCatalog = await call('connector_search', { flowId, query: 'Send notification' })
    const orderAction = (catalog.actions as { actionId: string; name: string; serviceId: string }[]).find((a) => a.name == 'List orders')!
    const notification = (notifyCatalog.actions as { actionId: string; name: string; serviceId: string }[]).find((a) => a.name == 'Send notification')!
    const ordersAccounts = await call('connector_connections', { flowId, serviceId: orderAction.serviceId }),
      notifyAccounts = await call('connector_connections', { flowId, serviceId: notification.serviceId })
    await call('flow_schema', { flowId, action: orderAction.actionId })
    await call('flow_schema', { flowId, action: notification.actionId })
    for (const type of ['start', 'code', 'condition']) await call('flow_schema', { type })
    const before = await read()
    await submit(before.revision, [
      { op: 'node.add', as: 'start', type: 'start', name: 'Start' },
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
