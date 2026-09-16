import type { Graph, RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges } from '../src/flow/common/change.ts'
import { availableOutputs } from '../src/flow/common/graph.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'
import { advanceWaiting, waitHost } from './waitHost.ts'

const port = { jsonSchema: {}, nullable: true }
const value = { inputs: {}, kind: 'value' as const, values: [{ ...port, handle: 'value', value: 1 }] }
const task = { inputs: {}, kind: 'task' as const, task: { inputs: [{ ...port, handle: 'input', value: null }], moduleId: 'main', name: 'Task', outputs: [] } }
function revision(graph: Graph): RevisionContent {
  return {
    document: { bindings: {}, graph, subflows: {}, tasks: {} },
    modelVersion: 2,
    modules: { main: { imports: [], name: 'Main', source: 'export default () => ({})' } },
  }
}

describe('Execution graph contract', () => {
  it('stores execution edges independently and preserves bindings on disconnect', () => {
    const edge = { source: 'a', target: 'b' }
    const source = revision({ edges: [], nodes: { a: value, b: task } })
    const connected = applyFlowChanges(source, [{ kind: 'graph.edge.connect', edge, target: { kind: 'flow' } }])
    expect(connected.document.graph.edges).toEqual([edge])
    expect(connected.document.graph.nodes.b).toEqual(task)
    expect(applyFlowChanges(connected, [{ kind: 'graph.edge.disconnect', edge, target: { kind: 'flow' } }])).toEqual(source)
  })

  it('offers transitive ancestors without adding edges from data bindings', async () => {
    const graph: Graph = {
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
      nodes: { a: value, b: task, c: { ...task, inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'a', output: 'value' }] } } } },
    }
    const source = revision(graph)
    expect((await prepareFlow(source, currentEngineContract)).kind).toBe('prepared')
    expect(availableOutputs(source.document, graph, 'c')).toEqual({ a: ['value'] })
    const broken = revision({ ...graph, edges: [] })
    const result = await prepareFlow(broken, currentEngineContract)
    expect(result.kind).toBe('flow-invalid')
    if (result.kind == 'flow-invalid') expect(result.validation.diagnostics.some((item) => item.code == 'graph.source-unavailable')).toBe(true)
  })

  it('offers ancestor outputs even when their branch may be skipped', () => {
    const graph: Graph = {
      edges: [
        { source: 'a', sourceHandle: 'yes', target: 'b' },
        { source: 'a', sourceHandle: 'no', target: 'c' },
        { source: 'b', target: 'd' },
        { source: 'c', target: 'd' },
      ],
      nodes: {
        a: {
          inputs: { input: { kind: 'value', value: true } },
          kind: 'condition',
          input: { ...port, handle: 'input' },
          cases: [{ expressions: [{ input: 'input', operator: 'isTrue' }], output: 'yes', relation: 'all' }],
          defaultOutput: 'no',
        },
        b: value,
        c: value,
        d: task,
      },
    }
    expect(availableOutputs(revision(graph).document, graph, 'd')).toEqual({ a: ['yes', 'no'], b: ['value'], c: ['value'] })
    expect(availableOutputs(revision(graph).document, graph, 'b')).toEqual({ a: ['yes', 'no'] })
    const parallel = {
      ...graph,
      edges: [
        { source: 'b', target: 'd' },
        { source: 'c', target: 'd' },
      ],
    }
    expect(availableOutputs(revision(parallel).document, parallel, 'd')).toEqual({ b: ['value'], c: ['value'] })
  })
})

describe('Execution graph scheduling', () => {
  it.each([true, false])('merges mutually exclusive sources once when the condition is %s', async (input) => {
    const graph: Graph = {
      edges: [
        { source: 'choice', sourceHandle: 'yes', target: 'yes' },
        { source: 'choice', sourceHandle: 'no', target: 'no' },
        { source: 'yes', target: 'join' },
        { source: 'no', target: 'join' },
      ],
      nodes: {
        choice: {
          kind: 'condition',
          inputs: { input: { kind: 'value', value: input } },
          input: { ...port, handle: 'input' },
          cases: [{ output: 'yes', relation: 'all', expressions: [{ input: 'input', operator: 'isTrue' }] }],
          defaultOutput: 'no',
        },
        yes: value,
        no: { ...value, values: [{ ...port, handle: 'value', value: 2 }] },
        join: {
          ...task,
          inputs: {
            input: {
              kind: 'sources',
              sources: [
                { kind: 'node', nodeId: 'yes', output: 'value' },
                { kind: 'node', nodeId: 'no', output: 'value' },
              ],
            },
          },
        },
      },
    }
    const prepared = await prepareFlow(
      revision({
        nodes: { start: { kind: 'manual', name: 'Start' }, ...graph.nodes },
        edges: [
          ...graph.edges,
          ...Object.keys(graph.nodes)
            .filter((id) => !graph.edges.some((edge) => edge.target == id))
            .map((target) => ({ source: 'start', target })),
        ],
      }),
      currentEngineContract,
    )
    expect(prepared.kind).toBe('prepared')
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    const calls: unknown[] = []
    const eventNodes: string[] = []
    let id = 0
    await Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => String(++id),
        flowId: 'main',
        runId: 'run',
        trigger: { nodeId: 'start', outputs: {} },
        emit: (event) =>
          Effect.sync(() => {
            if ('nodeId' in event) eventNodes.push(event.nodeId)
          }),
        invokeTask: (invocation) =>
          Effect.sync(() => {
            calls.push(invocation.input)
            return {}
          }),
      }),
    )
    expect(calls).toEqual([{ input: input ? 1 : 2 }])
    expect(eventNodes).not.toContain(input ? 'no' : 'yes')
    expect(eventNodes).toContain('join')
    const ambiguous = revision({
      ...graph,
      edges: [
        { source: 'yes', target: 'join' },
        { source: 'no', target: 'join' },
      ],
    })
    expect((await prepareFlow(ambiguous, currentEngineContract)).kind).toBe('flow-invalid')
  })

  it('restores transitive ancestor values and refuses incomplete checkpoint dependencies', async () => {
    const graph: Graph = {
      edges: [
        { source: 'before', target: 'pause' },
        { source: 'pause', sourceHandle: 'continue', target: 'after' },
      ],
      nodes: {
        before: { ...task, task: { ...task.task, outputs: [{ ...port, handle: 'value' }] } },
        pause: { kind: 'wait', inputs: {}, input: { ...port, handle: 'value', value: null }, actions: ['continue'], prompt: 'Continue?' },
        after: { ...task, inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'before', output: 'value' }] } } },
      },
    }
    const prepared = await prepareFlow(
      revision({
        nodes: { start: { kind: 'manual', name: 'Start' }, ...graph.nodes },
        edges: [
          ...graph.edges,
          ...Object.keys(graph.nodes)
            .filter((id) => !graph.edges.some((edge) => edge.target == id))
            .map((target) => ({ source: 'start', target })),
        ],
      }),
      currentEngineContract,
    )
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    let id = 0
    const options = { waits: waitHost(), createId: () => String(++id), flowId: 'main', runId: 'run' }
    const first = await advanceWaiting(
      runFlow(prepared.flow, { ...options, trigger: { nodeId: 'start', outputs: {} }, invokeTask: () => Effect.succeed({ value: 42 }) }),
    )
    if (first.kind != 'waiting') throw new Error('Expected Wait.')
    const calls: unknown[] = []
    await Effect.runPromise(
      runFlow(prepared.flow, {
        ...options,
        waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
        resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
        invokeTask: (invocation) =>
          Effect.sync(() => {
            calls.push({ nodeId: invocation.nodeId, input: invocation.input })
            return {}
          }),
      }),
    )
    expect(calls).toEqual([{ nodeId: 'after', input: { input: 42 } }])
    for (const checkpoint of [
      { ...first.checkpoint, results: {} },
      { ...first.checkpoint, skipped: ['before'], results: {} },
      { ...first.checkpoint, results: { ...first.checkpoint.results, after: { jobId: 'after', outputs: {} } } },
      { ...first.checkpoint, results: { before: { jobId: 'before', outputs: {} } } },
      { ...first.checkpoint, inputs: { before: { unknown: true } } },
      { ...first.checkpoint, queues: {} },
    ]) {
      await expect(
        Effect.runPromise(
          runFlow(prepared.flow, {
            ...options,
            resume: { checkpoint },
            invokeTask: () => Effect.die('No work should run.'),
          }),
        ),
      ).rejects.toThrow()
    }
  })

  it('rejects cycles and invalid branch endpoints without inferring execution from inputs', async () => {
    for (const edges of [
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
      [{ source: 'a', sourceHandle: 'value', target: 'b' }],
      [{ source: 'missing', target: 'b' }],
      [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'b' },
      ],
    ]) {
      expect((await prepareFlow(revision({ edges, nodes: { a: value, b: task } }), currentEngineContract)).kind).toBe('flow-invalid')
    }
  })
})

it('does not treat eventual action values as available on the notification path', async () => {
  const wait = {
    kind: 'wait' as const,
    inputs: {},
    input: { ...port, handle: 'value', value: null },
    actions: ['approve', 'reject'] as const,
    prompt: 'Approve?',
  }
  const graph: Graph = {
    nodes: {
      start: { kind: 'manual', name: 'Start' },
      wait,
      notify: {
        ...task,
        inputs: {
          input: {
            kind: 'sources',
            sources: [
              { kind: 'node', nodeId: 'wait', output: 'approve' },
              { kind: 'node', nodeId: 'wait', output: 'reject' },
            ],
          },
        },
      },
    },
    edges: [
      { source: 'start', target: 'wait' },
      { source: 'wait', sourceHandle: 'notification', target: 'notify' },
    ],
  }
  const content = revision(graph)
  const result = await prepareFlow(content, currentEngineContract)
  expect(result.kind).toBe('flow-invalid')
  expect(availableOutputs(content.document, graph, 'notify')).toEqual({ wait: ['notification'] })
})

it.each([true, false])('runs with null from either an available nullable source or a missing branch source: %s', async (takeSource) => {
  const prepared = await prepareFlow(
    revision({
      nodes: {
        start: { kind: 'manual', name: 'Start' },
        choice: {
          kind: 'condition',
          inputs: { input: { kind: 'value', value: takeSource } },
          input: { ...port, handle: 'input' },
          cases: [{ output: 'yes', relation: 'all', expressions: [{ input: 'input', operator: 'isTrue' }] }],
          defaultOutput: 'no',
        },
        source: { ...value, values: [{ ...port, handle: 'value', value: null }] },
        bypass: value,
        join: { ...task, inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } } },
        after: task,
        independent: task,
        pause: { kind: 'wait', inputs: {}, input: { ...port, handle: 'value', value: null }, actions: ['continue'], prompt: 'Continue?' },
      },
      edges: [
        { source: 'start', target: 'choice' },
        { source: 'choice', sourceHandle: 'yes', target: 'source' },
        { source: 'choice', sourceHandle: 'no', target: 'bypass' },
        { source: 'source', target: 'join' },
        { source: 'bypass', target: 'join' },
        { source: 'join', target: 'after' },
        { source: 'start', target: 'independent' },
        { source: 'start', target: 'pause' },
      ],
    }),
    currentEngineContract,
  )
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  const calls: { nodeId: string; input: unknown }[] = []
  const logs: string[] = []
  let id = 0
  const options = {
    createId: () => String(++id),
    flowId: 'main',
    runId: 'run',
    waits: waitHost(),
    invokeTask: (call: { nodeId: string; input: unknown }) =>
      Effect.sync(() => {
        calls.push(call)
        return {}
      }),
    emit: (event: import('../src/execution/common/scheduler.ts').SchedulerEvent) =>
      Effect.sync(() => {
        if (event.type == 'node.log') logs.push(event.message)
      }),
  }
  const first = await advanceWaiting(runFlow(prepared.flow, { ...options, trigger: { nodeId: 'start', outputs: {} } }))
  if (first.kind != 'waiting') throw new Error('Expected waiting')
  expect(calls.map((call) => call.nodeId).toSorted()).toEqual(['after', 'independent', 'join'])
  expect(calls.find((call) => call.nodeId == 'join')?.input).toEqual({ input: null })
  expect(first.checkpoint.skipped).not.toContain('join')
  expect(logs).toEqual([])
  if (takeSource) {
    const checkpoint = structuredClone(first.checkpoint)
    const result = checkpoint.results.source!
    const incomplete = { ...checkpoint, results: { ...checkpoint.results, source: { ...result, outputs: {} } } }
    await expect(
      Effect.runPromise(
        runFlow(prepared.flow, {
          ...options,
          resume: { checkpoint: incomplete },
          waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
        }),
      ),
    ).rejects.toThrow('Checkpoint node outputs are incomplete')
  }
  calls.length = 0
  const resumed = await Effect.runPromise(
    runFlow(prepared.flow, {
      ...options,
      resume: { checkpoint: first.checkpoint },
      waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
    }),
  )
  expect(resumed.kind).toBe('node-results')
  expect(calls).toEqual([])
})

it('runs a shared descendant with null when its only input source belongs to another trigger', async () => {
  const content = revision({
    nodes: {
      first: { kind: 'manual', name: 'First' },
      second: { kind: 'manual', name: 'Second' },
      source: value,
      join: { ...task, inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } } },
    },
    edges: [
      { source: 'first', target: 'source' },
      { source: 'source', target: 'join' },
      { source: 'second', target: 'join' },
    ],
  })
  const prepared = await prepareFlow(content, currentEngineContract, 'second')
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  let invoked = false
  const result = await Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => 'job',
      flowId: 'main',
      runId: 'run',
      trigger: { nodeId: 'second', outputs: {} },
      invokeTask: () =>
        Effect.sync(() => {
          invoked = true
          return {}
        }),
    }),
  )
  expect(result.kind).toBe('node-results')
  expect(invoked).toBe(true)
})
