import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { dedupeTask, stateConformanceCases } from '@oomol-lab/open-flow/flow-state'
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
async function createService(stateLimits?: import('../node/application/service-options.ts').ServerRuntime['stateLimits']) {
  const directory = await mkdtemp(path.join(tmpdir(), 'flow-state-'))
  directories.push(directory)
  const service = await openService(path.join(directory, 'state.sqlite'), { runtime: { stateLimits } })
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
  expect(host.control.state.read('test', stored.flowId, { scope: 'draft', values: true }).values[0]?.value).toEqual({ value: 2 })
  expect(() => host.control.state.read('another', stored.flowId, { scope: 'draft' })).toThrow()
  host.control.state.clear('test', stored.flowId, { scope: 'draft' })
  expect(host.control.state.read('test', stored.flowId, { scope: 'draft' }).values).toEqual([])
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
            task: dedupeTask({ field: 'id', mode: 'new', space: 'node' }),
          },
        },
      },
    },
  }
  const stored = await storeRevision(host, revision, 'dedupe')
  for (const index of [1, 2]) {
    const accepted = await acceptRun(host, { flowId: stored.flowId, revision, revisionId: 'dedupe', idempotencyKey: `node-${index}` })
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
  expect(host.control.state.read('test', stored.flowId, { scope: 'draft', values: true }).values.map(({ key, value }) => ({ key, value }))).toEqual([
    { key: 'retained', value: 42 },
  ])
})

for (const scenario of stateConformanceCases)
  it(scenario.name, async () => {
    const host = await createService()
    let identity = 0
    let dedupeRevision: { flowId: string; revisionId: string } | undefined
    let previousTask = dedupeTask()
    let previousItems: import('@oomol-lab/open-flow/flow-change').JsonValue[] = []
    await scenario.verify({
      maxIdentities: 10000,
      dedupe: async (config, items) => {
        const task = dedupeTask(config)
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
            'watermarks',
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
          `watermark-${identity++}`,
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
  expect((await client.getFlowState(stored.flowId, 'draft', true)).values[0]?.value).toBe(2)
  expect((await client.getFlowState(stored.flowId, 'live', true)).values[0]?.value).toBe(1)
  expect((await client.getFlowState(stored.flowId, 'live')).values[0]).not.toHaveProperty('value')
  for (const route of ['state', 'dedupe?space=flow', 'state?scope=invalid', 'state?scope=draft&values=invalid']) {
    expect((await app.request(`/v1/flows/${stored.flowId}/${route}`, { method: route.startsWith('dedupe') ? 'DELETE' : 'GET' })).status).toBe(400)
  }
  expect((await app.request(`/v1/flows/${stored.flowId}/state`, { method: 'DELETE' })).status).toBe(400)
  await client.clearFlowState(stored.flowId, 'draft', 'count')
  await client.clearFlowDedupe(stored.flowId, 'draft', 'flow')
  expect((await client.getFlowState(stored.flowId, 'draft')).values).toEqual([])
  expect((await client.getFlowState(stored.flowId, 'draft')).spaces).toEqual([])
  expect((await client.getFlowState(stored.flowId, 'live', true)).values[0]?.value).toBe(1)
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
  expect(host.control.state.read('test', stored.flowId, { scope: 'draft', values: true }).values[0]?.value).toBe(maxRunWrites == null ? 2 : 1)
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
            task: dedupeTask(),
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
