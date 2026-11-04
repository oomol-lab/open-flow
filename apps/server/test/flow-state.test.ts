import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { skipDuplicatesTask, stateConformanceCases } from '@oomol-lab/open-flow/flow-state'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createServerApp } from '../node/transport/http.ts'
import { acceptRun, storeRevision } from './runFixture.ts'
import { closeOpenServices, openService, startService } from './serviceFixture.ts'

const directories: string[] = []
afterEach(async () => {
  await closeOpenServices()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function createService(stateLimits?: import('../node/application/service-options.ts').ServerRuntime['stateLimits'], runTimeoutMs?: number) {
  const directory = await mkdtemp(path.join(tmpdir(), 'flow-state-'))
  directories.push(directory)
  const service = await openService(path.join(directory, 'state.sqlite'), { runtime: { stateLimits, runTimeoutMs } })
  await startService(service)
  return service
}
function codeFlow(source: string, onError?: 'error'): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: { code: { imports: [], name: 'State', source } },
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          code: {
            kind: 'task',
            onError,
            name: 'State',
            inputs: {},
            task: { name: 'State', inputs: [], outputs: [{ handle: 'result', jsonSchema: {}, nullable: false }], moduleId: 'code' },
          },
        },
      },
    },
  }
}

it('bounds named management reads, preserves request order and enforces Flow access', async () => {
  const host = await createService({ maxValueBytes: 1024 * 1024 })
  const app = createServerApp(host, { resolveControlActor: () => 'test' })
  const client = new ControlClient(async (url, init) => app.request(url, init))
  const flow = await client.createFlow('Named State reads')
  const store = host.control.state.store
  store.set(flow.flowId, 'draft', 'seed', 'zero', 0)
  store.set(flow.flowId, 'draft', 'seed', 'false', false)
  store.set(flow.flowId, 'live', 'seed', 'zero', 42)
  expect(await client.getFlowStateValues(flow.flowId, 'draft', ['false', 'missing', 'zero'])).toEqual({
    version: 1,
    scope: 'draft',
    values: [
      { key: 'false', value: false },
      { key: 'missing', value: null },
      { key: 'zero', value: 0 },
    ],
  })
  expect((await client.getFlowStateValues(flow.flowId, 'live', ['zero'])).values).toEqual([{ key: 'zero', value: 42 }])
  const read = (body: unknown) =>
    app.request(`/v1/flows/${flow.flowId}/state/read`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const response = await read({ version: 1, scope: 'draft', keys: ['zero'] })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  for (const body of [
    { version: 1, scope: 'draft' },
    { version: 1, keys: ['zero'] },
    { scope: 'draft', keys: ['zero'] },
    { version: 1, scope: 'draft', keys: [] },
    { version: 1, scope: 'draft', keys: ['zero', 'zero'] },
    { version: 1, scope: 'draft', keys: Array.from({ length: 17 }, (_, index) => String(index)) },
    { version: 1, scope: 'draft', keys: ['zero'], values: true },
  ])
    expect((await read(body)).status).toBe(400)
  store.set(flow.flowId, 'draft', 'seed', 'large-a', '汉'.repeat(200000))
  store.set(flow.flowId, 'draft', 'seed', 'large-b', '汉'.repeat(200000))
  await expect(client.getFlowStateValues(flow.flowId, 'draft', ['zero', 'large-a', 'large-b'])).rejects.toMatchObject({ code: 'flow.invalid' })
  const denied = createServerApp(host, { resolveControlActor: () => 'another' })
  expect(
    (
      await denied.request(`/v1/flows/${flow.flowId}/state/read`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: 1, scope: 'draft', keys: ['zero'] }),
      })
    ).status,
  ).toBe(404)
})

it('persists Code state across Runs, returns independent reads, and isolates Live', async () => {
  const host = await createService()
  const revision = codeFlow(`export default async (_, context) => {
    const initial = await context.state.insert('counter', { value: 0 });
    const current = await context.state.get('counter');
    current.value += 1;
    const unchanged = await context.state.get('counter');
    await context.state.set('counter', current);
    const inserted = await context.dedupe.insert(['a', 'b', 'a', 1, '1']);
    return { result: { initial, current, unchanged, inserted, keys: await context.state.list() } };
  }`)
  const stored = await storeRevision(host, revision, 'state')
  for (const index of [1, 2]) {
    const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'state', idempotencyKey: `run-${index}` })
    if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
    await host.waitForIdle()
    const completed = host.events(accepted.runId).find((event) => event.kind === 'node.completed' && event.payload.nodeId === 'code')
    expect(completed?.value).toEqual({
      result: {
        initial: index === 1,
        current: { value: index },
        unchanged: { value: index - 1 },
        inserted: index === 1 ? [true, true, false, true, true] : [false, false, false, false, false],
        keys: ['counter'],
      },
    })
  }
  expect(host.control.state.read('test', stored.flowId, { scope: 'live' }).values).toEqual([])
  expect(host.control.state.readValues('test', stored.flowId, { scope: 'draft', keys: ['counter'] }).values[0]?.value).toEqual({ value: 2 })
  expect(() => host.control.state.read('another', stored.flowId, { scope: 'draft' })).toThrow()
  host.control.state.clear('test', stored.flowId, { scope: 'draft' })
  expect(host.control.state.read('test', stored.flowId, { scope: 'draft' }).values).toEqual([])
})

it('reads 16 values at the byte limit without consuming the Run write allowance', async () => {
  const host = await createService({ maxRunWrites: 1 })
  const revision = codeFlow(`export default async (_, context) => {
    const values = await context.state.get(Array.from({length: 16}, (_, index) => String(index)));
    await context.state.set('proof', true);
    return {result: {lengths: values.map(value => value.length), proof: await context.state.get('proof')}};
  }`)
  const stored = await storeRevision(host, revision, 'batch-limit')
  for (const index of Array.from({ length: 16 }, (_, value) => value))
    host.control.state.store.set(stored.flowId, 'draft', 'seed', String(index), 'x'.repeat(64 * 1024 - 2))
  const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'batch-limit', idempotencyKey: 'batch-limit' })
  if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
  await host.waitForIdle()
  expect(host.run(accepted.runId)?.status, JSON.stringify(host.events(accepted.runId))).toBe('completed')
  expect(host.events(accepted.runId).find((event) => event.kind === 'node.completed' && event.payload.nodeId === 'code')?.value).toEqual({
    result: { lengths: Array.from({ length: 16 }, () => 64 * 1024 - 2), proof: true },
  })
})

it('preserves non-catchable limit failures for oversized State batch reads', async () => {
  const host = await createService({ maxValueBytes: 1024 * 1024 })
  const revision = codeFlow(
    `export default async (_, context) => {
    try { await context.state.get(['large-a', 'large-b']); } catch {}
    return {result: 'caught'};
  }`,
    'error',
  )
  const stored = await storeRevision(host, revision, 'batch-oversize')
  for (const key of ['large-a', 'large-b']) host.control.state.store.set(stored.flowId, 'draft', 'seed', key, '汉'.repeat(200000))
  const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'batch-oversize', idempotencyKey: 'batch-oversize' })
  if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
  await host.waitForIdle()
  expect(host.run(accepted.runId)?.status, JSON.stringify(host.events(accepted.runId))).toBe('failed')
  expect(host.events(accepted.runId).find((event) => event.kind === 'node.failed')?.payload).toMatchObject({ error: { code: 'limit-exceeded' } })
})

it('records node history across Runs and separates node and shared Flow spaces', async () => {
  const host = await createService()
  const revision: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          filter: {
            kind: 'task',
            name: 'Filter',
            inputs: { items: { kind: 'value', value: [{ id: 1 }, { id: 1 }, { id: 2 }] } },
            task: skipDuplicatesTask({ fields: ['id'] }),
          },
        },
      },
    },
  }
  const stored = await storeRevision(host, revision, 'skip-duplicates')
  for (const index of [1, 2]) {
    const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'skip-duplicates', idempotencyKey: `node-${index}` })
    if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
    await host.waitForIdle()
    expect(host.events(accepted.runId).find((event) => event.kind === 'node.completed' && event.payload.nodeId === 'filter')?.value).toEqual(
      index === 1 ? { items: [{ id: 1 }, { id: 2 }], duplicates: [{ id: 1 }] } : { items: [], duplicates: [{ id: 1 }, { id: 1 }, { id: 2 }] },
    )
  }
  expect(host.control.state.read('test', stored.flowId, { scope: 'draft' }).spaces).toMatchObject([{ space: 'node:filter', count: 2 }])
})

it('rejects non-JSON guest values and keeps writes made before a Task failure', async () => {
  const host = await createService()
  const revision = codeFlow(`export default async (_, context) => {
    for (const value of [undefined, NaN, new Date(), { nested: undefined }, { nested: () => 1 }]) {
      try { await context.state.set('invalid', value); throw new Error('accepted invalid'); }
      catch (error) { if (error.code !== 'capability.invalid') throw error; }
    }
    await context.state.set('retained', 42);
    throw new Error('after write');
  }`)
  const stored = await storeRevision(host, revision, 'failed-state')
  const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'failed-state', idempotencyKey: 'failed' })
  if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
  await host.waitForIdle()
  expect(host.control.state.read('test', stored.flowId, { scope: 'draft' }).values.map((item) => item.key)).toEqual(['retained'])
  expect(host.control.state.readValues('test', stored.flowId, { scope: 'draft', keys: ['retained'] }).values).toEqual([{ key: 'retained', value: 42 }])
})

for (const scenario of stateConformanceCases)
  it(scenario.name, async () => {
    const host = await createService()
    let identity = 0
    let dedupeRevision: { flowId: string; revisionId: string } | undefined
    let previousTask = skipDuplicatesTask()
    let previousItems: import('@oomol-lab/open-flow/flow-change').JsonValue[] = []
    await scenario.verify({
      maxIdentities: 10000,
      skipDuplicates: async (config, items) => {
        const task = skipDuplicatesTask(config)
        if (dedupeRevision == null) {
          dedupeRevision = await storeRevision(
            host,
            {
              modelVersion: currentFlowModelVersion,
              modules: {},
              document: {
                bindings: {},
                graph: { edges: [], nodes: { filter: { kind: 'task', name: 'Filter', inputs: { items: { kind: 'value', value: items } }, task } } },
              },
            },
            'identity-fields',
          )
        } else {
          const changed = await host.control.drafts.changeDraft('test', dedupeRevision.flowId, dedupeRevision.revisionId, [
            { kind: 'graph.node.task.set', nodeId: 'filter', before: previousTask, value: task },
            {
              kind: 'graph.node.input.set',
              nodeId: 'filter',
              handle: 'items',
              before: { kind: 'value', value: previousItems },
              value: { kind: 'value', value: items },
            },
          ])
          dedupeRevision = { ...dedupeRevision, revisionId: changed.revision.revisionId }
        }
        previousTask = task
        previousItems = items
        const accepted = await host.control.runs.createDraftRun(
          'test',
          dedupeRevision.flowId,
          dedupeRevision.revisionId,
          currentEngineContract,
          {},
          `identity-${identity++}`,
          { nodeId: 'start', outputs: {} },
        )
        await host.waitForIdle()
        const completed = host.events(accepted.run.runId).find((event) => event.kind === 'node.completed' && event.payload.nodeId === 'filter')
        if (completed == null) throw new Error(JSON.stringify(host.events(accepted.run.runId)))
        return completed.value as {
          items: import('@oomol-lab/open-flow/flow-change').JsonValue[]
          duplicates: import('@oomol-lab/open-flow/flow-change').JsonValue[]
        }
      },
      run: async (source) => {
        const revision = codeFlow(source)
        const accepted = await acceptRun(host, { flowId: 'conformance', revision, revisionId: 'conformance', idempotencyKey: `run-${identity++}` })
        if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
        await host.waitForIdle()
        const completed = host.events(accepted.runId).find((event) => event.kind === 'node.completed' && event.payload.nodeId === 'code')
        if (completed == null) throw new Error(JSON.stringify(host.events(accepted.runId)))
        return (completed.value as { result: import('@oomol-lab/open-flow/flow-change').JsonValue }).result
      },
    })
  })

it.each([
  ['dedupe.full', { maxIdentities: 1 }, "await context.dedupe.insert(['a', 'b'])", true],
  ['limit-exceeded', { maxRunWrites: 1 }, "await context.state.set('one', 1); await context.state.set('two', 2)", false],
  ['limit-exceeded', { maxValueBytes: 1 }, "await context.state.set('large', 'value')", false],
  ['limit-exceeded', { maxValueBytes: 1 }, "try { await context.state.set('large', 'value') } catch {}", false],
] as const)('preserves onError semantics for %s with %j', async (code, limits, source, handled) => {
  const host = await createService(limits)
  const revision = codeFlow(`export default async (_, context) => { ${source}; return {result: null}; }`, 'error')
  const accepted = await acceptRun(host, { flowId: 'errors', revision, revisionId: 'errors', idempotencyKey: 'errors' })
  if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
  await host.waitForIdle()
  expect(host.run(accepted.runId)?.status, JSON.stringify(host.events(accepted.runId))).toBe(handled ? 'completed' : 'failed')
  const failed = host.events(accepted.runId).find((event) => event.kind === 'node.failed')
  expect(failed?.payload, JSON.stringify(host.events(accepted.runId))).toMatchObject({ error: { code } })
  expect(failed?.payload.handled === true).toBe(handled)
})

it('isolates actual Live Runs and requires explicit scope at the management boundary', async () => {
  const host = await createService()
  const revision = codeFlow(`export default async (_, context) => {
    const count = (await context.state.get('count') ?? 0) + 1;
    await context.state.set('count', count);
    await context.dedupe.insert(['id']);
    return {result: count};
  }`)
  const stored = await storeRevision(host, revision, 'scopes')
  const app = createServerApp(host, { resolveControlActor: () => 'test' })
  const client = new ControlClient(async (url, init) => app.request(url, init))
  await client.publishFlow(stored.flowId, stored.revisionId, null)
  await host.tickMaintenance()
  const publicationId = (await client.getLive(stored.flowId)).publication!.publicationId
  for (const index of [1, 2]) {
    await client.createDraftRun(stored.flowId, stored.revisionId, { trigger: { nodeId: 'start', outputs: {} }, idempotencyKey: `draft-${index}` })
    await host.waitForIdle()
  }
  await client.createLiveRun(publicationId, { trigger: { nodeId: 'start', outputs: {} }, idempotencyKey: 'live' })
  await host.waitForIdle()
  expect((await client.getFlowStateValues(stored.flowId, 'draft', ['count'])).values[0]?.value).toBe(2)
  expect((await client.getFlowStateValues(stored.flowId, 'live', ['count'])).values[0]?.value).toBe(1)
  expect((await client.getFlowState(stored.flowId, 'live')).values[0]).not.toHaveProperty('value')
  const metadata = await app.request(`/v1/flows/${stored.flowId}/state?scope=draft&values=false`)
  expect(metadata.status).toBe(200)
  expect(metadata.headers.get('Cache-Control')).toBe('no-store')
  for (const route of ['state', 'dedupe?space=flow', 'state?scope=invalid', 'state?scope=draft&values=invalid', 'state?scope=draft&values=true']) {
    expect((await app.request(`/v1/flows/${stored.flowId}/${route}`, { method: route.startsWith('dedupe') ? 'DELETE' : 'GET' })).status).toBe(400)
  }
  expect((await app.request(`/v1/flows/${stored.flowId}/state`, { method: 'DELETE' })).status).toBe(400)
  await client.clearFlowState(stored.flowId, 'draft', 'count')
  await client.clearFlowDedupe(stored.flowId, 'draft', 'flow')
  expect((await client.getFlowState(stored.flowId, 'draft')).values).toEqual([])
  expect((await client.getFlowState(stored.flowId, 'draft')).spaces).toEqual([])
  expect((await client.getFlowStateValues(stored.flowId, 'live', ['count'])).values[0]?.value).toBe(1)
})

it.each([undefined, 1])('shares state and the durable write budget across Tasks (budget %s)', async (maxRunWrites) => {
  const host = await createService({ maxRunWrites })
  const base = codeFlow(`export default async (_, context) => {
    const count = (await context.state.get('count') ?? 0) + 1;
    await context.state.set('count', count);
    return {result: count};
  }`)
  const revision: RevisionContent = {
    ...base,
    document: {
      ...base.document,
      graph: {
        edges: [{ source: 'code', target: 'second' }],
        nodes: { ...base.document.graph.nodes, second: { ...base.document.graph.nodes.code!, name: 'Second' } },
      },
    },
  }
  const stored = await storeRevision(host, revision, 'tasks')
  const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'tasks', idempotencyKey: 'tasks' })
  if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
  await host.waitForIdle()
  expect(host.run(accepted.runId)?.status).toBe(maxRunWrites == null ? 'completed' : 'failed')
  expect(host.control.state.readValues('test', stored.flowId, { scope: 'draft', keys: ['count'] }).values[0]?.value).toBe(maxRunWrites == null ? 2 : 1)
})

it.each([1, 2])('handles managed-node capacity failures and reports usage without identities (limit %s)', async (maxIdentities) => {
  const host = await createService({ maxIdentities })
  const revision: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        edges: [],
        nodes: {
          filter: {
            kind: 'task',
            name: 'Filter',
            onError: 'error',
            inputs: { items: { kind: 'value', value: ['private-a', 'private-b'] } },
            task: skipDuplicatesTask(),
          },
        },
      },
    },
  }
  const stored = await storeRevision(host, revision, 'capacity')
  const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'capacity', idempotencyKey: 'capacity' })
  if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
  await host.waitForIdle()
  expect(host.run(accepted.runId)?.status).toBe('completed')
  const events = host.events(accepted.runId)
  if (maxIdentities === 1) {
    expect(events.find((event) => event.kind === 'node.failed')?.payload).toMatchObject({ handled: true, error: { code: 'dedupe.full' } })
    expect(host.control.state.read('test', stored.flowId, { scope: 'draft' }).spaces).toEqual([])
  } else {
    const logs = JSON.stringify(events.filter((event) => event.kind === 'node.log'))
    expect(logs).toContain('dedupe.near-limit')
    expect(logs).not.toContain('private-')
  }
})

function skipFlow(source: string, onError?: 'error'): RevisionContent {
  const code = codeFlow(source, onError)
  return {
    ...code,
    document: {
      ...code.document,
      graph: {
        edges: [{ source: 'filter', target: 'code' }],
        nodes: {
          ...code.document.graph.nodes,
          filter: {
            kind: 'task',
            name: 'Skip Duplicates',
            inputs: { items: { kind: 'value', value: [{ id: 1 }, { id: 1 }, { id: 2 }] } },
            task: skipDuplicatesTask({ fields: ['id'] }),
          },
        },
      },
    },
  }
}

it.each([false, true])('commits Skip Duplicates only after Run success while Code writes remain immediate (handled=%s)', async (handled) => {
  const host = await createService()
  const revision = skipFlow(
    `export default async (_, context) => {
    await context.state.set('attempts', (await context.state.get('attempts') ?? 0) + 1);
    throw new Error('downstream failed');
  }`,
    handled ? 'error' : undefined,
  )
  const stored = await storeRevision(host, revision, 'downstream')
  for (const index of [1, 2]) {
    const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'downstream', idempotencyKey: `attempt-${index}` })
    if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
    await host.waitForIdle()
    expect(host.run(accepted.runId)?.status).toBe(handled ? 'completed' : 'failed')
    const output = host.events(accepted.runId).find((event) => event.kind === 'node.completed' && event.payload.nodeId === 'filter')?.value
    expect(output).toMatchObject({ items: handled && index === 2 ? [] : [{ id: 1 }, { id: 2 }] })
    const state = host.control.state.read('test', stored.flowId, { scope: 'draft' })
    expect(state.spaces).toEqual(handled ? [expect.objectContaining({ count: 2, pendingCount: 0 })] : [])
    expect(host.control.state.readValues('test', stored.flowId, { scope: 'draft', keys: ['attempts'] }).values[0]?.value).toBe(index)
  }
})

it.each(['cancel', 'timeout'] as const)('releases pending node history on %s', async (outcome) => {
  const host = await createService(undefined, outcome === 'timeout' ? 500 : undefined)
  const revision = skipFlow('export default async () => { await new Promise(() => {}); return {result: null} }')
  const stored = await storeRevision(host, revision, 'pending')
  const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'pending', idempotencyKey: outcome })
  if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
  await expect.poll(() => host.control.state.read('test', stored.flowId, { scope: 'draft' }).spaces[0]?.pendingCount).toBe(2)
  expect(() => host.control.state.clearDedupe('test', stored.flowId, { scope: 'draft', space: 'node:filter' })).toThrow(
    expect.objectContaining({ code: 'flow.conflict' }),
  )
  if (outcome === 'cancel') host.control.runs.cancelRun('test', accepted.runId)
  await host.waitForIdle()
  expect(host.run(accepted.runId)?.status).toBe(outcome === 'cancel' ? 'canceled' : 'failed')
  expect(host.control.state.read('test', stored.flowId, { scope: 'draft' }).spaces).toEqual([])
})

it('rejects the complete invalid identity batch even when the node error is handled', async () => {
  const host = await createService()
  const base = skipFlow('export default () => ({result: true})')
  const revision: RevisionContent = {
    ...base,
    document: {
      ...base.document,
      graph: {
        ...base.document.graph,
        nodes: {
          ...base.document.graph.nodes,
          filter: {
            kind: 'task',
            name: 'Skip Duplicates',
            onError: 'error',
            task: skipDuplicatesTask({ fields: ['id'] }),
            inputs: { items: { kind: 'value', value: [{ id: 1 }, { id: null }] } },
          },
        },
      },
    },
  }
  const stored = await storeRevision(host, revision, 'invalid-batch')
  const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'invalid-batch', idempotencyKey: 'invalid' })
  if (accepted.kind !== 'accepted') throw new Error('Run not accepted')
  await host.waitForIdle()
  expect(host.run(accepted.runId)?.status).toBe('completed')
  expect(host.events(accepted.runId).find((event) => event.kind === 'node.failed')?.payload).toMatchObject({
    handled: true,
    error: { message: expect.stringContaining('Item 2, field "id"') },
  })
  expect(host.control.state.read('test', stored.flowId, { scope: 'draft' }).spaces).toEqual([])
})

it('keeps node history independent between real Draft and Live Runs', async () => {
  const host = await createService()
  const revision = skipFlow('export default () => ({result: true})')
  const stored = await storeRevision(host, revision, 'node-scopes')
  const app = createServerApp(host, { resolveControlActor: () => 'test' })
  const client = new ControlClient(async (url, init) => app.request(url, init))
  await client.publishFlow(stored.flowId, stored.revisionId, null)
  await host.tickMaintenance()
  const publicationId = (await client.getLive(stored.flowId)).publication!.publicationId
  await client.createDraftRun(stored.flowId, stored.revisionId, { trigger: { nodeId: 'start', outputs: {} }, idempotencyKey: 'draft' })
  await host.waitForIdle()
  expect((await client.getFlowState(stored.flowId, 'live')).spaces).toEqual([])
  const live = await client.createLiveRun(publicationId, { trigger: { nodeId: 'start', outputs: {} }, idempotencyKey: 'live' })
  await host.waitForIdle()
  expect(host.events(live.runId).find((event) => event.kind === 'node.completed' && event.payload.nodeId === 'filter')?.value).toMatchObject({
    items: [{ id: 1 }, { id: 2 }],
  })
  expect((await client.getFlowState(stored.flowId, 'draft')).spaces).toMatchObject([{ count: 2, pendingCount: 0 }])
  expect((await client.getFlowState(stored.flowId, 'live')).spaces).toMatchObject([{ count: 2, pendingCount: 0 }])
})
