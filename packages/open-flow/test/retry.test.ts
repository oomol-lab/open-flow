import type { FlowRunOptions, SchedulerEvent, TaskInvocation } from '../src/execution/common/scheduler.ts'
import type { RetryConfiguration } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import { TestClock } from 'effect/testing'
import { describe, expect, it, vi } from 'vitest'
import { currentEngineContract } from '../src/execution/common/engineContract.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { currentFlowModelVersion } from '../src/flow/common/change.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'

const retry = { maxRetries: 2, intervalMs: 1000 }
async function fixture(policy?: RetryConfiguration, timeoutMs?: number) {
  const port = { handle: 'value', jsonSchema: { type: 'number' }, nullable: false }
  const prepared = await prepareFlow(
    {
      modelVersion: currentFlowModelVersion,
      modules: { code: { name: 'Code', imports: [], source: 'export default () => ({value: 1})' } },
      document: {
        bindings: {},
        graph: {
          nodes: {
            start: { kind: 'manual', name: 'Start' },
            task: { kind: 'task', name: 'Task', inputs: {}, task: { moduleId: 'code', name: 'Task', inputs: [], outputs: [port] }, retry: policy, timeoutMs },
            sink: {
              kind: 'outputs',
              name: 'Outputs',
              outputDefs: [port],
              outputMappings: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'task', output: 'value' }] } },
            },
          },
          edges: [
            { source: 'start', target: 'task' },
            { source: 'task', target: 'sink' },
          ],
        },
      },
    },
    currentEngineContract,
  )
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  return prepared.flow
}
function options(
  invokeTask: FlowRunOptions['invokeTask'],
  events: SchedulerEvent[] = [],
  extra: Partial<Pick<FlowRunOptions, 'emit' | 'remainingMs'>> = {},
): FlowRunOptions {
  let id = 0
  return {
    flowId: 'flow',
    runId: 'run',
    createId: () => String(++id),
    trigger: { nodeId: 'start', outputs: {} },
    invokeTask,
    emit: (event) =>
      Effect.sync(() => {
        events.push(event)
      }),
    projectFailure: (error) => ({ code: 'test.failure', message: String(error), retryable: error instanceof BusinessError }),
    ...extra,
  }
}
class BusinessError extends Error {}
const withClock = <A, E>(program: Effect.Effect<A, E, TestClock.TestClock>) => Effect.runPromise(Effect.provide(program, TestClock.layer()))

describe('node retries', () => {
  it.each([undefined, { maxRetries: 0, intervalMs: 1000 }])('does not retry by default or with zero retries (%j)', async (policy) => {
    const prepared = await fixture(policy)
    const invoke = vi.fn(() => Effect.fail(new BusinessError('failed')))
    await expect(Effect.runPromise(runFlow(prepared, options(invoke)))).rejects.toThrow('failed')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('waits the configured interval, preserves inputs and identity, and commits downstream once', async () => {
    const prepared = await fixture(retry)
    const calls: TaskInvocation[] = []
    const events: SchedulerEvent[] = []
    await withClock(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          runFlow(
            prepared,
            options((invocation) => {
              calls.push(invocation)
              return calls.length < 3 ? Effect.fail(new BusinessError('temporary')) : Effect.succeed({ value: 42 })
            }, events),
          ),
        )
        yield* TestClock.adjust(0)
        expect(calls).toHaveLength(1)
        yield* TestClock.adjust(999)
        expect(calls).toHaveLength(1)
        yield* TestClock.adjust(1)
        expect(calls).toHaveLength(2)
        yield* TestClock.adjust(1000)
        expect(yield* Fiber.join(fiber)).toMatchObject({ kind: 'node-results', outputs: { value: 42 } })
      }),
    )
    expect(new Set(calls.map((call) => call.jobId)).size).toBe(1)
    expect(new Set(calls.map((call) => call.invocationId)).size).toBe(3)
    expect(calls.map((call) => call.input)).toEqual([{}, {}, {}])
    expect(events.filter((event) => event.type == 'node.started' && event.nodeId == 'task')).toHaveLength(1)
    expect(events.filter((event) => event.type == 'node.log')).toHaveLength(2)
    expect(events.filter((event) => event.type == 'node.failed')).toHaveLength(0)
    expect(events.filter((event) => event.type == 'node.completed' && event.nodeId == 'sink')).toHaveLength(1)
  })
  it('exhausts additional attempts before failing once', async () => {
    const prepared = await fixture(retry)
    const events: SchedulerEvent[] = []
    const invoke = vi.fn(() => Effect.fail(new BusinessError('failed')))
    await withClock(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(runFlow(prepared, options(invoke, events)))
        yield* TestClock.adjust(2000)
        expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
      }),
    )
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(events.filter((event) => event.type == 'node.failed')).toHaveLength(1)
    expect(events.filter((event) => event.type == 'run.failed')).toHaveLength(1)
  })
  it('does not retry unclassified or permanent failures', async () => {
    const prepared = await fixture(retry)
    const invoke = vi.fn(() => Effect.fail(new Error('permanent')))
    await expect(Effect.runPromise(runFlow(prepared, options(invoke)))).rejects.toThrow('permanent')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('does not retry output validation or completion persistence', async () => {
    const prepared = await fixture(retry)
    const invalid = vi.fn(() => Effect.succeed({ value: 'invalid' }))
    await expect(Effect.runPromise(runFlow(prepared, options(invalid)))).rejects.toThrow('declaration')
    expect(invalid).toHaveBeenCalledTimes(1)
    const invoke = vi.fn(() => Effect.succeed({ value: 1 }))
    await expect(
      Effect.runPromise(
        runFlow(
          prepared,
          options(invoke, [], {
            emit: (event) => (event.type == 'node.completed' ? Effect.fail(new BusinessError('storage')) : Effect.void),
          }),
        ),
      ),
    ).rejects.toThrow('storage')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it.each(['node', 'run'])('does not reset the %s deadline between attempts', async (budget) => {
    const prepared = await fixture(retry, budget == 'node' ? 1500 : undefined)
    const invoke = vi.fn(() => Effect.fail(new BusinessError('temporary')))
    await withClock(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(runFlow(prepared, options(invoke, [], budget == 'run' ? { remainingMs: 1500 } : {})))
        yield* TestClock.adjust(2000)
        expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
      }),
    )
    expect(invoke).toHaveBeenCalledTimes(2)
  })
  it('cancels during the interval without another attempt', async () => {
    const prepared = await fixture(retry)
    const invoke = vi.fn(() => Effect.fail(new BusinessError('temporary')))
    await withClock(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(runFlow(prepared, options(invoke)))
        yield* TestClock.adjust(0)
        yield* Fiber.interrupt(fiber)
        yield* TestClock.adjust(5000)
      }),
    )
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('does not retry when recording a warning fails', async () => {
    const prepared = await fixture(retry)
    const invoke = vi.fn(() => Effect.fail(new BusinessError('temporary')))
    await expect(
      Effect.runPromise(
        runFlow(
          prepared,
          options(invoke, [], {
            emit: (event) => (event.type == 'node.log' ? Effect.fail(new BusinessError('event storage')) : Effect.void),
          }),
        ),
      ),
    ).rejects.toThrow('event storage')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

it('resets the retry allowance per loop invocation without consuming another loop execution', async () => {
  const prepared = await fixture(retry)
  const task = prepared.graph.nodes.task!
  if (task.kind != 'task') throw new Error('Expected Task')
  const looping = {
    ...prepared,
    graph: {
      ...prepared.graph,
      nodes: { ...prepared.graph.nodes, task: { ...task, maxExecutions: 2 } },
      edges: [...prepared.graph.edges, { source: 'task', target: 'task' }],
    },
  }
  const events: SchedulerEvent[] = []
  let calls = 0
  await withClock(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        runFlow(
          looping,
          options(() => (++calls % 2 == 1 ? Effect.fail(new BusinessError('temporary')) : Effect.succeed({ value: calls })), events),
        ),
      )
      yield* TestClock.adjust(2000)
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true)
    }),
  )
  expect(calls).toBe(4)
  expect(events.filter((event) => event.type == 'node.log')).toHaveLength(2)
  expect(events.filter((event) => event.type == 'node.started' && event.nodeId == 'task')).toHaveLength(2)
  expect(events.filter((event) => event.type == 'node.failed')).toEqual([
    expect.objectContaining({ message: expect.stringContaining('maximum execution count') }),
  ])
})
