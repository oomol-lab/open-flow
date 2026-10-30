import type { SchedulerEvent, TaskInvocation } from '../src/execution/common/scheduler.ts'
import type { Graph, GraphNode, InputMapping } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { currentFlowModelVersion } from '../src/flow/common/change.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'
import { currentEngineContract } from '../src/runtime/common/engineContract.ts'
import { advanceWaiting, waitHost } from './waitHost.ts'

const port = { nullable: true, jsonSchema: {} }
const start: GraphNode = { kind: 'manual', name: 'Start' }
const source = (nodeId: string, output = 'value'): InputMapping => ({ kind: 'sources', sources: [{ kind: 'node', nodeId, output }] })
const task = (inputs: Record<string, InputMapping> = {}, outputs = ['value']): GraphNode => ({
  kind: 'task',
  inputs,
  task: {
    moduleId: 'code',
    name: 'Code',
    inputs: Object.keys(inputs).map((handle) => Object.assign({ handle }, port)),
    outputs: outputs.map((handle) => Object.assign({ handle }, port)),
  },
})
const condition = (nodeId: string, limit: number): GraphNode => ({
  kind: 'condition',
  inputs: {},
  matchMode: 'first',
  cases: [
    {
      output: 'again',
      groups: [
        {
          expressions: [
            {
              left: { kind: 'source', source: { kind: 'node', nodeId, output: 'value' } },
              operator: '<',
              right: { kind: 'value', value: limit },
            },
          ],
        },
      ],
    },
  ],
})
const edge = (sourceId: string, target: string, sourceHandle?: string) => ({ source: sourceId, target, ...(sourceHandle == null ? {} : { sourceHandle }) })
async function prepared(graph: Graph) {
  const result = await prepareFlow(
    {
      modelVersion: currentFlowModelVersion,
      document: { bindings: {}, graph },
      modules: { code: { name: 'Code', imports: [], source: 'export default () => ({})' } },
    },
    currentEngineContract,
  )
  if (result.kind != 'prepared') throw new Error(JSON.stringify(result))
  return result.flow
}
function config(invoke: (call: TaskInvocation) => Effect.Effect<unknown, Error>, events: SchedulerEvent[] = []) {
  let id = 0
  return {
    flowId: 'flow',
    runId: 'run',
    trigger: { nodeId: 'start', outputs: {} },
    createId: () => `job-${++id}`,
    invokeTask: invoke,
    emit: (event: SchedulerEvent) =>
      Effect.sync(() => {
        events.push(event)
      }),
  }
}

it('merges branches in every loop iteration, keeps outer ancestors, and exits once', async () => {
  const flow = await prepared({
    nodes: {
      start,
      ancestor: task(),
      count: task({ previous: source('count') }),
      a: task({ n: source('count') }),
      b: task({ n: source('count') }),
      join: task({ a: source('a'), b: source('b'), ancestor: source('ancestor') }),
      choose: condition('count', 3),
      end: task({ value: source('join') }),
    },
    edges: [
      edge('start', 'ancestor'),
      edge('ancestor', 'count'),
      edge('count', 'a'),
      edge('count', 'b'),
      edge('a', 'join'),
      edge('b', 'join'),
      edge('join', 'choose'),
      edge('choose', 'count', 'again'),
      edge('choose', 'end', 'otherwise'),
    ],
  })
  const predecessors: Array<Extract<TaskInvocation, { moduleId: string }>['getPrevious']> = []
  const joined: unknown[] = []
  const endings: unknown[] = []
  await Effect.runPromise(
    runFlow(
      flow,
      config((call) =>
        Effect.gen(function* () {
          if (call.nodeId == 'ancestor') return { value: 42 }
          if (call.nodeId == 'count') {
            if (!('moduleId' in call)) throw new Error('Expected Code')
            predecessors.push(call.getPrevious)
            return { value: Number(call.input.previous ?? 0) + 1 }
          }
          if (call.nodeId == 'a' || call.nodeId == 'b') {
            if (call.nodeId == 'a') yield* Effect.sleep(1)
            return { value: call.input.n }
          }
          if (call.nodeId == 'join') {
            joined.push(call.input)
            return { value: call.input.a }
          }
          endings.push(call.input)
          return { value: call.input.value }
        }),
      ),
    ),
  )
  expect(joined).toEqual([1, 2, 3].map((n) => ({ a: n, b: n, ancestor: 42 })))
  expect(endings).toEqual([{ value: 3 }])
  expect(predecessors.map((read) => read().map((node) => node.id))).toEqual([['ancestor'], ['choose'], ['choose']])
})

it('does not leak a skipped branch from the preceding loop iteration', async () => {
  const flow = await prepared({
    nodes: {
      start,
      count: task({ previous: source('count') }),
      branch: condition('count', 2),
      a: task(),
      b: task(),
      join: task({
        value: {
          kind: 'sources',
          sources: [
            { kind: 'node', nodeId: 'a', output: 'value' },
            { kind: 'node', nodeId: 'b', output: 'value' },
          ],
        },
      }),
      choose: condition('count', 3),
      end: task({ value: source('join') }),
    },
    edges: [
      edge('start', 'count'),
      edge('count', 'branch'),
      edge('branch', 'a', 'again'),
      edge('branch', 'b', 'otherwise'),
      edge('a', 'join'),
      edge('b', 'join'),
      edge('join', 'choose'),
      edge('choose', 'count', 'again'),
      edge('choose', 'end', 'otherwise'),
    ],
  })
  const values: unknown[] = []
  await Effect.runPromise(
    runFlow(
      flow,
      config((call) =>
        Effect.sync(() => {
          if (call.nodeId == 'count') return { value: Number(call.input.previous ?? 0) + 1 }
          if (call.nodeId == 'join') values.push(call.input.value)
          return { value: call.input.value ?? call.nodeId }
        }),
      ),
    ),
  )
  expect(values).toEqual(['a', 'b', 'b'])
})

it('restarts a nested loop for each outer iteration', async () => {
  const flow = await prepared({
    nodes: {
      start,
      outer: task({ previous: source('outer') }),
      inner: task({ previous: source('inner'), outer: source('outer') }),
      innerChoose: condition('inner', 2),
      outerChoose: condition('outer', 2),
      end: task(),
    },
    edges: [
      edge('start', 'outer'),
      edge('outer', 'inner'),
      edge('inner', 'innerChoose'),
      edge('innerChoose', 'inner', 'again'),
      edge('innerChoose', 'outerChoose', 'otherwise'),
      edge('outerChoose', 'outer', 'again'),
      edge('outerChoose', 'end', 'otherwise'),
    ],
  })
  const turns: unknown[] = []
  await Effect.runPromise(
    runFlow(
      flow,
      config((call) =>
        Effect.sync(() => {
          const value = Number(call.input.previous ?? 0) + 1
          if (call.nodeId == 'inner') turns.push([call.input.outer, value])
          return { value }
        }),
      ),
    ),
  )
  expect(turns).toEqual([
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ])
})

it('restores a partial join without replaying its finished branch and preserves predecessor lists', async () => {
  const flow = await prepared({
    nodes: {
      start,
      a: task(),
      wait: { kind: 'wait', inputs: {}, inputDefinitions: [], prompt: 'Continue' },
      join: task({ a: source('a'), b: source('wait', 'continue') }),
    },
    edges: [edge('start', 'a'), edge('start', 'wait'), edge('a', 'join'), edge('wait', 'join', 'continue')],
  })
  const calls: string[] = []
  const options = config((call) =>
    Effect.sync(() => {
      calls.push(call.nodeId)
      if (call.nodeId == 'join') {
        expect(call.input.a).toBe('saved')
        expect(call.input.b).toMatchObject({ action: 'continue' })
        if (!('moduleId' in call)) throw new Error('Expected Code')
        expect(call.getPrevious().map((previous) => previous.id)).toEqual(['a', 'wait'])
      }
      return { value: 'saved' }
    }),
  )
  const first = await advanceWaiting(runFlow(flow, { ...options, waits: waitHost() }))
  if (first.kind != 'waiting') throw new Error('Expected waiting')
  expect(calls).toEqual(['a'])
  const { trigger: _, ...resume } = options
  await Effect.runPromise(
    runFlow(flow, {
      ...resume,
      resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
      waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
    }),
  )
  expect(calls).toEqual(['a', 'join'])
  for (const mutate of [
    (value: typeof first.checkpoint) => {
      delete value.dependencies.nodes.a
    },
    (value: typeof first.checkpoint) => {
      value.dependencies.nodes.wait!.jobId = 'wrong'
    },
    (value: typeof first.checkpoint) => {
      value.dependencies.nodes.a!.input.start = { execution: 100000, outputs: {} }
    },
  ]) {
    const checkpoint = structuredClone(first.checkpoint)
    mutate(checkpoint)
    await expect(Effect.runPromise(runFlow(flow, { ...resume, resume: { checkpoint }, waits: waitHost() }))).rejects.toThrow('Checkpoint')
  }
})

it('joins all selected Condition branches once and skips a wholly unselected continuation', async () => {
  const choice = {
    kind: 'condition' as const,
    inputs: {},
    matchMode: 'all' as const,
    cases: ['a', 'b'].map((output) => ({
      output,
      groups: [{ expressions: [{ left: { kind: 'value' as const, value: true }, operator: 'isTrue' as const }] }],
    })),
  }
  const flow = await prepared({
    nodes: { start, choice, a: task(), b: task(), join: task({ a: source('a'), b: source('b') }), no: task(), skipped: task() },
    edges: [
      edge('start', 'choice'),
      edge('choice', 'a', 'a'),
      edge('choice', 'b', 'b'),
      edge('choice', 'no', 'otherwise'),
      edge('no', 'skipped'),
      edge('a', 'join'),
      edge('b', 'join'),
    ],
  })
  const calls: string[] = []
  await Effect.runPromise(
    runFlow(
      flow,
      config((call) =>
        Effect.sync(() => {
          calls.push(call.nodeId)
          if (call.nodeId == 'join') expect(call.input).toEqual({ a: 'a', b: 'b' })
          return { value: call.nodeId }
        }),
      ),
    ),
  )
  expect(calls.toSorted()).toEqual(['a', 'b', 'join'])
})

it('executes selected loop exits even when another Condition branch continues the loop', async () => {
  const choose = condition('count', 3)
  if (choose.kind != 'condition') throw new Error('Expected condition')
  const flow = await prepared({
    nodes: {
      start,
      count: task({ previous: source('count') }),
      choose: {
        ...choose,
        matchMode: 'all',
        cases: [...choose.cases, { output: 'emit', groups: [{ expressions: [{ left: { kind: 'value', value: true }, operator: 'isTrue' }] }] }],
      },
      end: task({ value: source('count') }),
    },
    edges: [edge('start', 'count'), edge('count', 'choose'), edge('choose', 'count', 'again'), edge('choose', 'end', 'emit')],
  })
  const values: unknown[] = []
  await Effect.runPromise(
    runFlow(
      flow,
      config((call) =>
        Effect.sync(() => {
          if (call.nodeId == 'count') return { value: Number(call.input.previous ?? 0) + 1 }
          values.push(call.input.value)
          return { value: call.input.value }
        }),
      ),
    ),
  )
  expect(values).toEqual([1, 2, 3])
})

it('does not make a loop wait for a join that depends on its final exit', async () => {
  const flow = await prepared({
    nodes: {
      start,
      count: task({ previous: source('count') }),
      side: task({ value: source('count') }),
      choose: condition('count', 3),
      join: task({ value: source('side') }),
    },
    edges: [
      edge('start', 'count'),
      edge('count', 'side'),
      edge('count', 'choose'),
      edge('side', 'join'),
      edge('choose', 'count', 'again'),
      edge('choose', 'join', 'otherwise'),
    ],
  })
  const calls: unknown[] = []
  await Effect.runPromise(
    runFlow(
      flow,
      config((call) =>
        Effect.sync(() => {
          if (call.nodeId == 'count') return { value: Number(call.input.previous ?? 0) + 1 }
          if (call.nodeId == 'join') calls.push(call.input)
          return { value: call.input.value }
        }),
      ),
    ),
  )
  expect(calls).toEqual([{ value: 3 }])
})

it('restores a loop side wait and finishes the exit join without replaying completed work', async () => {
  const flow = await prepared({
    nodes: {
      start,
      count: task({ previous: source('count') }),
      pause: { kind: 'wait', inputs: { value: source('count') }, inputDefinitions: [{ ...port, handle: 'value' }], prompt: 'Continue' },
      side: task({ value: source('count') }),
      choose: condition('count', 2),
      join: task({ value: source('side') }),
    },
    edges: [
      edge('start', 'count'),
      edge('count', 'pause'),
      edge('pause', 'side', 'continue'),
      edge('count', 'choose'),
      edge('side', 'join'),
      edge('choose', 'count', 'again'),
      edge('choose', 'join', 'otherwise'),
    ],
  })
  const calls: unknown[] = []
  const events: SchedulerEvent[] = []
  const options = config(
    (call) =>
      Effect.sync(() => {
        if (call.nodeId == 'count') return { value: Number(call.input.previous ?? 0) + 1 }
        calls.push([call.nodeId, call.input.value])
        return { value: call.input.value }
      }),
    events,
  )
  const first = await advanceWaiting(runFlow(flow, { ...options, waits: waitHost() }))
  if (first.kind != 'waiting') throw new Error('Expected waiting')
  const { trigger: _, ...resume } = options
  const second = await advanceWaiting(
    runFlow(flow, {
      ...resume,
      resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
      waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
    }),
  )
  if (second.kind != 'waiting') throw new Error('Expected second wait')
  expect(second.checkpoint.waits[0]!.value).toEqual({ value: 2 })
  expect(calls).toEqual([['side', 1]])
  await Effect.runPromise(
    runFlow(flow, {
      ...resume,
      resume: { checkpoint: JSON.parse(JSON.stringify(second.checkpoint)) },
      waits: waitHost({ [second.checkpoint.waits[0]!.waitId]: 'continue' }),
    }),
  )
  expect(calls).toEqual([
    ['side', 1],
    ['side', 2],
    ['join', 2],
  ])
  expect(events.filter((event) => event.type == 'node.started' && event.nodeId == 'count')).toHaveLength(2)
})
