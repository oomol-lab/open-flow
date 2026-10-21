import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { createLlmTask } from '@oomol-lab/open-flow/flow-authoring'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { acceptRun } from './runFixture.ts'
import { closeOpenServices, openService, startService } from './serviceFixture.ts'

const directories: string[] = []
afterEach(async () => {
  await closeOpenServices()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})
async function file() {
  const directory = await mkdtemp(join(tmpdir(), 'node-errors-'))
  directories.push(directory)
  return join(directory, 'database.sqlite')
}
function flow(code: string): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: { code: { name: 'Code', imports: [], source: code } },
    document: {
      bindings: {},
      graph: {
        nodes: {
          task: {
            kind: 'task',
            name: 'Task',
            onError: 'error',
            inputs: {},
            task: { moduleId: 'code', name: 'Code', inputs: [], outputs: [{ handle: 'error', jsonSchema: { type: 'string' }, nullable: false }] },
          },
          out: {
            kind: 'outputs',
            name: 'Outputs',
            outputDefs: [
              { handle: 'business', jsonSchema: {}, nullable: true },
              { handle: 'failure', jsonSchema: {}, nullable: true },
            ],
            outputMappings: {
              business: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'task', output: 'error' }] },
              failure: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'task', output: 'error', system: true }] },
            },
          },
        },
        edges: [{ source: 'task', target: 'out' }],
      },
    },
  }
}
it.each([
  ['export default () => ({error: "business"})', false],
  ['export default () => { throw new Error("broken") }', true],
  ['export default () => ({error: 42})', true],
  ['export default () => ({error: NaN})', true],
] as const)('persists ordinary and handled Code outcomes across the real isolate: %s', async (code, handled) => {
  const service = await openService(await file(), { clock: Date.now })
  await startService(service)
  const accepted = await acceptRun(service, { flowId: 'flow', revisionId: 'revision', revision: flow(code), idempotencyKey: 'run' })
  if (accepted.kind != 'accepted') throw new Error('Run not accepted')
  await service.waitForIdle()
  expect(service.run(accepted.runId)?.status).toBe('completed')
  const events = service.control.runs.getRunEvents(accepted.runId, 0, 100).events
  const terminal = events.filter((event) => event.kind == 'node.failed' || event.kind == 'node.completed').find((event) => event.payload.nodeId == 'task')
  expect(terminal).toMatchObject({
    kind: handled ? 'node.failed' : 'node.completed',
    payload: {
      systemOutputs: { error: handled ? { nodeId: 'task', runId: accepted.runId, executionId: terminal?.payload.executionId } : null },
      ...(handled ? { handled: true } : {}),
    },
  })
  const completed = events.find((event) => event.kind == 'node.completed' && event.payload.nodeId == 'out')
  expect(completed).toMatchObject({
    payload: { outputs: { business: handled ? null : 'business', failure: handled ? expect.objectContaining({ nodeId: 'task' }) : null } },
  })
})
it('does not handle an isolate resource limit', async () => {
  const service = await openService(await file(), { clock: Date.now })
  await startService(service)
  const accepted = await acceptRun(service, {
    flowId: 'flow',
    revisionId: 'revision',
    revision: flow('export default () => { while(true) {} }'),
    idempotencyKey: 'limit',
  })
  if (accepted.kind != 'accepted') throw new Error('Run not accepted')
  await service.waitForIdle()
  expect(service.run(accepted.runId)?.status).toBe('failed')
  expect(service.events(accepted.runId).some((event) => event.kind == 'node.failed' && event.payload.handled)).toBe(false)
})
it('handles a permanent model failure without retrying it through the Host bridge', async () => {
  let calls = 0
  const service = await openService(await file(), {
    clock: Date.now,
    capabilities: {
      llm: () => async () => {
        calls++
        return { kind: 'failed', code: 'llm.unavailable', message: 'Request rejected', retryable: false, version: 1 }
      },
    },
  })
  const created = createLlmTask({ nodeId: 'task' }, 'Model', 'chat', 'A response.')
  const change = created.find((operation) => operation.kind == 'graph.node.create')
  if (change?.kind != 'graph.node.create' || change.node.kind != 'task') throw new Error('Missing task')
  const revision: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: { bindings: {}, graph: { nodes: { task: { ...change.node, onError: 'error', retry: { maxRetries: 2, intervalMs: 1000 } } }, edges: [] } },
  }
  await startService(service)
  const accepted = await acceptRun(service, { flowId: 'flow', revisionId: 'revision', revision, idempotencyKey: 'model' })
  if (accepted.kind != 'accepted') throw new Error('Run not accepted')
  await service.waitForIdle()
  expect(service.run(accepted.runId)?.status).toBe('completed')
  expect(calls).toBe(1)
  expect(service.events(accepted.runId)).toContainEqual(
    expect.objectContaining({
      kind: 'node.failed',
      payload: expect.objectContaining({ handled: true, error: { code: 'llm.unavailable', message: 'Request rejected' } }),
    }),
  )
})
