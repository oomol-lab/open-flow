import type { SchedulerEvent, WaitRequest } from '../src/execution/common/scheduler.ts'
import type { WaitAction, RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { afterEach, expect, it, vi } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function fixture(notify = true) {
  const content: RevisionContent = {
    modelVersion: 2,
    modules: {},
    document: {
      bindings: {},
      subflows: {},
      tasks: {
        send: { name: 'Send', inputs: [], outputs: [], executor: { kind: 'connector', action: 'test.send' } },
        after: { name: 'After', inputs: [], outputs: [], executor: { kind: 'connector', action: 'test.after' } },
      },
      graph: {
        nodes: {
          start: { kind: 'manual', name: 'Start' },
          wait: {
            kind: 'wait',
            actions: ['approve', 'reject'],
            prompt: 'Ready?',
            inputs: {},
            input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
          },
          ...(notify ? { send: { kind: 'task' as const, taskId: 'send', inputs: {} } } : {}),
          after: { kind: 'task', taskId: 'after', inputs: {} },
        },
        edges: [
          { source: 'start', target: 'wait' },
          ...(notify ? [{ source: 'wait', sourceHandle: 'notification', target: 'send' }] : []),
          { source: 'wait', sourceHandle: 'approve', target: 'after' },
        ],
      },
    },
  }
  const prepared = await prepareFlow(content, currentEngineContract)
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  const requests: WaitRequest[] = []
  const decisions: Record<string, WaitAction> = {}
  let changed = deferred<void>()
  const events: SchedulerEvent[] = []
  let nextId = 0
  return {
    prepared: prepared.flow,
    requests,
    events,
    wake() {
      const pending = changed
      changed = deferred()
      pending.resolve()
    },
    approve() {
      decisions[requests[0]!.waitId] = 'approve'
      const pending = changed
      changed = deferred()
      pending.resolve()
    },
    options: {
      createId: () => `job-${++nextId}`,
      flowId: 'main',
      runId: 'run',
      trigger: { nodeId: 'start', outputs: {} },
      remainingMs: 1000,
      emit: (event: SchedulerEvent) =>
        Effect.sync(() => {
          events.push(event)
        }),
      waits: {
        create: (wait: WaitRequest) =>
          Effect.sync(() => {
            requests.push(wait)
            return wait.notify
              ? {
                  value: wait.value,
                  prompt: wait.prompt,
                  actions: wait.actions.map((action) => ({ action, url: `https://example.com/${action}` })),
                  expiresAt: '2030-01-01T00:00:00.000Z',
                }
              : undefined
          }),
        resolutions: (ids: readonly string[], block: boolean) =>
          Effect.tryPromise(async () => {
            if (block && !ids.some((id) => decisions[id] != null)) await changed.promise
            return Object.fromEntries(ids.filter((id) => decisions[id] != null).map((id) => [id, decisions[id]!]))
          }),
      },
    },
  }
}

afterEach(() => vi.useRealTimers())

it('applies approval while notification is still running in the same graph', async () => {
  const f = await fixture()
  const sending = deferred<void>()
  const sent = deferred<Record<string, never>>()
  const approved = deferred<void>()
  const run = Effect.runPromise(
    runFlow(f.prepared, {
      ...f.options,
      invokeTask: (call) =>
        Effect.tryPromise(async () => {
          if (call.nodeId == 'send') {
            sending.resolve()
            return await sent.promise
          }
          approved.resolve()
          return {}
        }),
    }),
  )
  await sending.promise
  f.approve()
  await approved.promise
  expect(f.events.some((event) => event.type == 'node.completed' && event.nodeId == 'send')).toBe(false)
  sent.resolve({})
  expect((await run).kind).toBe('node-results')
  expect(f.requests).toHaveLength(1)
  expect(f.events.filter((event) => event.type == 'node.completed' && event.nodeId == 'wait')).toHaveLength(1)
})

it('retains a quiet graph for two minutes without consuming its execution budget', async () => {
  const f = await fixture(false)
  vi.useFakeTimers()
  const run = Effect.runPromise(runFlow(f.prepared, { ...f.options, invokeTask: () => Effect.succeed({}) }))
  let finished = false
  void run.then(() => {
    finished = true
  })
  await vi.advanceTimersByTimeAsync(119_999)
  expect(finished).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  const outcome = await run
  expect(outcome.kind).toBe('waiting')
  if (outcome.kind != 'waiting') throw new Error('Expected waiting')
  expect(outcome.remainingMs).toBe(1000)
  expect(outcome.checkpoint.waits).toHaveLength(1)
})

it('continues a quiet graph in its original session before the retention deadline', async () => {
  const f = await fixture(false)
  vi.useFakeTimers()
  const run = Effect.runPromise(runFlow(f.prepared, { ...f.options, invokeTask: () => Effect.succeed({}) }))
  await vi.advanceTimersByTimeAsync(119_999)
  f.approve()
  await vi.advanceTimersByTimeAsync(0)
  expect((await run).kind).toBe('node-results')
  expect(f.requests).toHaveLength(1)
})

it('executes the merge separately for notification and action arrivals', async () => {
  const f = await fixture()
  const prepared = {
    ...f.prepared,
    graph: {
      ...f.prepared.graph,
      nodes: { ...f.prepared.graph.nodes, join: { kind: 'value' as const, inputs: {}, values: [] } },
      edges: [...f.prepared.graph.edges, { source: 'send', target: 'join' }, { source: 'after', target: 'join' }],
    },
  }
  const sending = deferred<void>()
  const sent = deferred<Record<string, never>>()
  const approved = deferred<void>()
  const run = Effect.runPromise(
    runFlow(prepared, {
      ...f.options,
      invokeTask: (call) =>
        Effect.tryPromise(async () => {
          if (call.nodeId == 'send') {
            sending.resolve()
            return await sent.promise
          }
          approved.resolve()
          return {}
        }),
    }),
  )
  await sending.promise
  f.approve()
  await approved.promise
  expect(f.events.some((event) => event.type == 'node.started' && event.nodeId == 'join')).toBe(false)
  sent.resolve({})
  await run
  expect(f.events.filter((event) => event.type == 'node.completed' && event.nodeId == 'join')).toHaveLength(2)
})

it('does not extend the retention window after a wake without a decision', async () => {
  const f = await fixture(false)
  vi.useFakeTimers()
  const run = Effect.runPromise(runFlow(f.prepared, { ...f.options, invokeTask: () => Effect.succeed({}) }))
  await vi.advanceTimersByTimeAsync(110_000)
  f.wake()
  await vi.advanceTimersByTimeAsync(10_000)
  expect((await run).kind).toBe('waiting')
})

it('starts a fresh retention window after a decision advances the graph to another wait', async () => {
  const f = await fixture(false)
  const prepared = {
    ...f.prepared,
    graph: {
      ...f.prepared.graph,
      nodes: { ...f.prepared.graph.nodes, second: f.prepared.graph.nodes.wait! },
      edges: [...f.prepared.graph.edges, { source: 'after', target: 'second' }],
    },
  }
  vi.useFakeTimers()
  const run = Effect.runPromise(runFlow(prepared, { ...f.options, invokeTask: () => Effect.succeed({}) }))
  let finished = false
  void run.then(() => {
    finished = true
  })
  await vi.advanceTimersByTimeAsync(110_000)
  f.approve()
  await vi.advanceTimersByTimeAsync(0)
  expect(f.requests).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(119_999)
  expect(finished).toBe(false)
  await vi.advanceTimersByTimeAsync(1)
  const outcome = await run
  expect(outcome.kind).toBe('waiting')
  if (outcome.kind != 'waiting') throw new Error('Expected waiting')
  expect(outcome.checkpoint.waits.map((wait) => wait.nodeId)).toEqual(['second'])
})
