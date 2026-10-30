import type { FlowRunOptions, SchedulerEvent } from '../src/execution/common/scheduler.ts'
import type { RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { expect, it, vi } from 'vitest'
import { decodeFlowRunCheckpoint, runFlow } from '../src/execution/common/scheduler.ts'
import { currentFlowModelVersion } from '../src/flow/common/change.ts'
import { decodeRevisionContent, decodeRevision, encodeRevision } from '../src/flow/common/encoding.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'
import { currentEngineContract } from '../src/runtime/common/engineContract.ts'
import { advanceWaiting, waitHost } from './waitHost.ts'

function content(onError?: 'error', inputInvalid = false): RevisionContent {
  const port = { handle: 'error', jsonSchema: { type: 'string' }, nullable: false }
  return {
    modelVersion: currentFlowModelVersion,
    modules: { code: { name: 'Code', imports: [], source: 'export default () => ({error: "business"})' } },
    document: {
      bindings: {},
      graph: {
        nodes: {
          start: { kind: 'manual', name: 'Start' },
          task: {
            kind: 'task',
            name: 'Task',
            onError,
            inputs: inputInvalid ? { value: { kind: 'value', value: 'wrong' } } : {},
            task: {
              moduleId: 'code',
              name: 'Code',
              inputs: inputInvalid ? [{ handle: 'value', jsonSchema: { type: 'number' }, nullable: false }] : [],
              outputs: [port],
            },
          },
          out: {
            kind: 'outputs',
            name: 'Outputs',
            outputDefs: [
              { handle: 'business', jsonSchema: {}, nullable: true },
              { handle: 'failure', jsonSchema: {}, nullable: true },
              { handle: 'message', jsonSchema: {}, nullable: true },
            ],
            outputMappings: {
              business: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'task', output: 'error' }] },
              failure: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'task', output: 'error', system: true }] },
              message: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'task', output: 'error', system: true, field: 'message' }] },
            },
          },
        },
        edges: [
          { source: 'start', target: 'task' },
          { source: 'task', target: 'out' },
        ],
      },
    },
  }
}
function taskAt(source: RevisionContent) {
  const node = source.document.graph.nodes.task!
  if (node.kind != 'task') throw new Error('Expected task')
  return node
}
async function prepared(source = content('error')) {
  const result = await prepareFlow(source, currentEngineContract)
  if (result.kind != 'prepared') throw new Error(JSON.stringify(result))
  return result.flow
}
function options(invokeTask: FlowRunOptions['invokeTask'], events: SchedulerEvent[] = []) {
  let id = 0
  return {
    flowId: 'flow',
    runId: 'run',
    createId: () => `execution-${++id}`,
    trigger: { nodeId: 'start', outputs: {} },
    invokeTask,
    projectFailure: (error: unknown) => ({ code: 'example.failure', message: String(error), catchable: error instanceof BusinessError }),
    emit: (event: SchedulerEvent) =>
      Effect.sync(() => {
        events.push(event)
      }),
  }
}
class BusinessError extends Error {}
it('keeps system and same-named business outputs independent on success', async () => {
  const result = await Effect.runPromise(
    runFlow(
      await prepared(),
      options(() => Effect.succeed({ error: 'business' })),
    ),
  )
  expect(result).toMatchObject({ kind: 'node-results', outputs: { business: 'business', failure: null, message: null } })
})
it('continues along existing connections after a handled failure without business outputs', async () => {
  const events: SchedulerEvent[] = []
  const result = await Effect.runPromise(
    runFlow(
      await prepared(),
      options(() => Effect.fail(new BusinessError('broken')), events),
    ),
  )
  expect(result).toMatchObject({
    kind: 'node-results',
    outputs: {
      business: null,
      failure: {
        code: 'example.failure',
        message: 'Error: broken',
        nodeId: 'task',
        nodeName: 'Task',
        runId: 'run',
        executionId: expect.stringMatching(/^execution_/),
      },
      message: 'Error: broken',
    },
  })
  expect(events.filter((event) => event.type == 'node.failed')).toMatchObject([{ handled: true }])
  expect(events.some((event) => event.type == 'run.failed' || (event.type == 'node.completed' && event.nodeId == 'task'))).toBe(false)
})
it.each(['input', 'output'] as const)('handles %s validation failures without retrying the task', async (phase) => {
  const invoke = vi.fn(() => Effect.succeed({ error: 42 }))
  const result = await Effect.runPromise(runFlow(await prepared(content('error', phase == 'input')), options(invoke)))
  expect(result).toMatchObject({ kind: 'node-results', outputs: { failure: { code: `node.${phase}-invalid` } } })
  expect(invoke).toHaveBeenCalledTimes(phase == 'input' ? 0 : 1)
})
it('does not handle unclassified fatal failures', async () => {
  await expect(
    Effect.runPromise(
      runFlow(
        await prepared(),
        options(() => Effect.fail(new Error('fatal'))),
      ),
    ),
  ).rejects.toThrow('fatal')
})
it.each(['success', 'handled'] as const)('does not retry or release downstream when persisting %s fails', async (outcome) => {
  const events: SchedulerEvent[] = []
  const invoke = vi.fn(() => (outcome == 'handled' ? Effect.fail(new BusinessError('broken')) : Effect.succeed({ error: 'business' })))
  const configured = options(invoke)
  await expect(
    Effect.runPromise(
      runFlow(await prepared(), {
        ...configured,
        emit: (event: SchedulerEvent) =>
          Effect.gen(function* () {
            events.push(event)
            if ((event.type == 'node.completed' || event.type == 'node.failed') && event.nodeId == 'task') yield* Effect.fail(new Error('storage'))
          }),
      }),
    ),
  ).rejects.toThrow('storage')
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(events.some((event) => event.type == 'node.started' && event.nodeId == 'out')).toBe(false)
})
it.each(['success', 'handled'] as const)('finishes persisting %s when cancellation arrives during commit', async (outcome) => {
  const cancellation = new AbortController()
  let persisted = false
  const configured = options(() => (outcome == 'handled' ? Effect.fail(new BusinessError('broken')) : Effect.succeed({ error: 'business' })))
  await expect(
    Effect.runPromise(
      runFlow(await prepared(), {
        ...configured,
        emit: (event: SchedulerEvent) =>
          Effect.gen(function* () {
            if ((event.type == 'node.completed' || event.type == 'node.failed') && event.nodeId == 'task') {
              cancellation.abort()
              yield* Effect.yieldNow
              persisted = true
            }
          }),
      }),
      { signal: cancellation.signal },
    ),
  ).rejects.toThrow()
  expect(persisted).toBe(true)
})
it('persists and resumes a handled failure through a Wait without replaying the task', async () => {
  const source = content('error')
  const graph = source.document.graph
  const run = await prepared({
    ...source,
    document: {
      ...source.document,
      graph: {
        ...graph,
        nodes: { ...graph.nodes, pause: { kind: 'wait', name: 'Pause', inputs: {}, inputDefinitions: [], prompt: 'Continue' } },
        edges: [
          { source: 'start', target: 'task' },
          { source: 'task', target: 'pause' },
          { source: 'pause', sourceHandle: 'continue', target: 'out' },
        ],
      },
    },
  })
  const invoke = vi.fn(() => Effect.fail(new BusinessError('broken')))
  const first = await advanceWaiting(runFlow(run, { ...options(invoke), waits: waitHost() }))
  if (first.kind != 'waiting') throw new Error('Expected Wait')
  const { trigger: _trigger, ...base } = options(invoke)
  const saved = first.checkpoint.results.task!
  for (const handled of [false, null, 'true']) {
    expect(() =>
      decodeFlowRunCheckpoint({
        ...first.checkpoint,
        results: { ...first.checkpoint.results, task: { ...saved, handled } },
      }),
    ).toThrow('Checkpoint handled flag is invalid.')
  }
  await expect(
    Effect.runPromise(
      runFlow(run, {
        ...base,
        resume: {
          checkpoint: { ...first.checkpoint, results: { ...first.checkpoint.results, task: { jobId: saved.jobId, outputs: saved.outputs, handled: true } } },
        },
        waits: waitHost(),
      }),
    ),
  ).rejects.toThrow('Checkpoint system output is missing.')
  await expect(
    Effect.runPromise(
      runFlow(run, {
        ...base,
        resume: { checkpoint: { ...first.checkpoint, counts: { '': {} } } },
        waits: waitHost(),
      }),
    ),
  ).rejects.toThrow('Checkpoint execution count is missing.')
  const outcome = await Effect.runPromise(
    runFlow(run, {
      ...base,
      resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
      waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
    }),
  )
  expect(outcome).toMatchObject({ kind: 'node-results', outputs: { failure: { nodeId: 'task' } } })
  expect(invoke).toHaveBeenCalledTimes(1)
})

it('stops by default and can finish a handled terminal node without downstream connections', async () => {
  const source = content('error')
  const { out: _out, ...nodes } = source.document.graph.nodes
  const graph = { ...source.document.graph, nodes, edges: [{ source: 'start', target: 'task' }] }
  const run = await prepared({ ...source, document: { ...source.document, graph } })
  expect(
    await Effect.runPromise(
      runFlow(
        run,
        options(() => Effect.fail(new BusinessError('broken'))),
      ),
    ),
  ).toMatchObject({ kind: 'node-results', nodes: [{ nodeId: 'task', status: 'error-handled', outputs: {}, systemOutputs: { error: { nodeId: 'task' } } }] })
  const task = nodes.task!
  const defaultRun = await prepared({
    ...source,
    document: { ...source.document, graph: { ...graph, nodes: { ...nodes, task: { ...task, onError: undefined } } } },
  })
  await expect(
    Effect.runPromise(
      runFlow(
        defaultRun,
        options(() => Effect.fail(new BusinessError('broken'))),
      ),
    ),
  ).rejects.toThrow('broken')
})
it('exhausts retries before emitting one handled error and executing downstream once', async () => {
  const source = content('error')
  const run = await prepared({
    ...source,
    document: {
      ...source.document,
      graph: { ...source.document.graph, nodes: { ...source.document.graph.nodes, task: { ...taskAt(source), retry: { maxRetries: 2, intervalMs: 1000 } } } },
    },
  })
  const events: SchedulerEvent[] = []
  const invoke = vi.fn(() => Effect.fail(new BusinessError('broken')))
  const result = await advanceWaiting(
    runFlow(run, {
      ...options(invoke, events),
      projectFailure: (error: unknown) => ({ code: 'example.failure', message: String(error), retryable: true, catchable: true }),
    }),
  )
  expect(result).toMatchObject({ kind: 'node-results', outputs: { failure: { code: 'example.failure' } } })
  expect(invoke).toHaveBeenCalledTimes(3)
  expect(events.filter((event) => event.type == 'node.log')).toHaveLength(2)
  expect(events.filter((event) => event.type == 'node.failed')).toHaveLength(1)
  expect(events.filter((event) => event.type == 'node.completed' && event.nodeId == 'out')).toHaveLength(1)
})
it.each(['node', 'run'])('does not catch a %s timeout', async (budget) => {
  const source = content('error')
  const run = await prepared({
    ...source,
    document: {
      ...source.document,
      graph: {
        ...source.document.graph,
        nodes: { ...source.document.graph.nodes, task: { ...taskAt(source), ...(budget == 'node' ? { timeoutMs: 10 } : {}) } },
      },
    },
  })
  await expect(advanceWaiting(runFlow(run, { ...options(() => Effect.never), ...(budget == 'run' ? { remainingMs: 10 } : {}) }))).rejects.toThrow(
    budget == 'node' ? 'timed out' : 'deadline',
  )
})
it('resets system errors on the next loop iteration and preserves earlier snapshots through recovery', async () => {
  const source = content('error')
  const run = await prepared({
    ...source,
    document: {
      ...source.document,
      graph: {
        nodes: {
          ...source.document.graph.nodes,
          gate: {
            kind: 'condition',
            name: 'Again',
            inputs: {},
            matchMode: 'first',
            cases: [
              {
                output: 'again',
                groups: [
                  {
                    expressions: [{ left: { kind: 'source', source: { kind: 'node', nodeId: 'task', output: 'error', system: true } }, operator: 'isNotNull' }],
                  },
                ],
              },
            ],
          },
          pause: { kind: 'wait', name: 'Pause', inputs: {}, inputDefinitions: [], prompt: 'Continue' },
        },
        edges: [
          { source: 'start', target: 'task' },
          { source: 'task', target: 'gate' },
          { source: 'gate', sourceHandle: 'again', target: 'task' },
          { source: 'gate', sourceHandle: 'otherwise', target: 'pause' },
          { source: 'pause', sourceHandle: 'continue', target: 'out' },
        ],
      },
    },
  })
  const invoke = vi.fn(() => (invoke.mock.calls.length == 1 ? Effect.fail(new BusinessError('first attempt')) : Effect.succeed({ error: 'business' })))
  const first = await advanceWaiting(runFlow(run, { ...options(invoke), waits: waitHost() }))
  if (first.kind != 'waiting') throw new Error('Expected Wait')
  const { trigger: _trigger, ...base } = options(invoke)
  const result = await Effect.runPromise(
    runFlow(run, { ...base, resume: { checkpoint: first.checkpoint }, waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }) }),
  )
  expect(result).toMatchObject({ kind: 'node-results', outputs: { business: 'business', failure: null, message: null } })
  expect(invoke).toHaveBeenCalledTimes(2)
})

it('round trips the namespace and rejects it in older Flow models', () => {
  const source = content('error')
  expect(decodeRevision(encodeRevision(source))).toEqual(source)
  expect(() => decodeRevisionContent({ ...content(), modelVersion: 8 })).toThrow('Node error handling requires Flow model version 9.')
})
