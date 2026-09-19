import type { Graph, RevisionContent } from '../src/flow/common/change.ts'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges } from '../src/flow/common/change.ts'
import { availableOutputs, inputSourceCandidates } from '../src/flow/common/graph.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'
import { advanceWaiting, waitHost } from './waitHost.ts'

const port = { jsonSchema: {}, nullable: true }
const value = { inputs: {}, kind: 'value' as const, values: [{ ...port, handle: 'value', value: 1 }] }
const task = { inputs: {}, kind: 'task' as const, task: { inputs: [{ ...port, handle: 'input', value: null }], moduleId: 'main', name: 'Task', outputs: [] } }
function revision(graph: Graph): RevisionContent {
  return {
    document: { bindings: {}, graph, subflows: {}, tasks: {} },
    modelVersion: currentFlowModelVersion,
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

  it('offers structurally available inputs with their schema compatibility', () => {
    const source = {
      inputs: {},
      kind: 'value' as const,
      values: [
        { handle: 'text', jsonSchema: { type: 'string' }, nullable: false, value: 'hello' },
        { handle: 'count', jsonSchema: { type: 'number' }, nullable: false, value: 1 },
        { handle: 'unknown', jsonSchema: null, nullable: false, value: null },
      ],
    }
    const target = {
      ...task,
      task: {
        ...task.task,
        inputs: [{ handle: 'input', jsonSchema: { type: 'string' }, nullable: false }],
      },
    }
    const graph: Graph = {
      edges: [{ source: 'source', target: 'target' }],
      nodes: { source, target, unrelated: source },
    }
    const content = revision(graph)

    expect(inputSourceCandidates(content.document, graph, 'target', 'input')).toEqual({
      source: [
        { output: 'text', check: { kind: 'available' } },
        {
          output: 'count',
          check: { kind: 'schema', mismatch: { kind: 'keyword', keyword: 'type', path: [], source: 'number', target: 'string' } },
        },
        { output: 'unknown', check: { kind: 'schema-error' } },
      ],
    })
    expect(availableOutputs(content.document, graph, 'target', 'input')).toEqual({ source: ['text'] })
  })

  it('offers ancestor outputs even when their branch may be skipped', () => {
    const graph: Graph = {
      edges: [
        { source: 'a', sourceHandle: 'yes', target: 'b' },
        { source: 'a', sourceHandle: 'otherwise', target: 'c' },
        { source: 'b', target: 'd' },
        { source: 'c', target: 'd' },
      ],
      nodes: {
        a: {
          kind: 'condition',
          cases: [{ output: 'yes', groups: [{ expressions: [{ left: { kind: 'value' as const, value: true }, operator: 'isTrue' }] }] }],
          inputs: {},
          matchMode: 'first' as const,
        },
        b: value,
        c: value,
        d: task,
      },
    }
    expect(availableOutputs(revision(graph).document, graph, 'd')).toEqual({ b: ['value'], c: ['value'] })
    expect(availableOutputs(revision(graph).document, graph, 'b')).toEqual({})
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
        { source: 'choice', sourceHandle: 'otherwise', target: 'no' },
        { source: 'yes', target: 'join' },
        { source: 'no', target: 'join' },
      ],
      nodes: {
        choice: {
          kind: 'condition',
          cases: [{ output: 'yes', groups: [{ expressions: [{ left: { kind: 'value' as const, value: input }, operator: 'isTrue' }] }] }],
          inputs: {},
          matchMode: 'first' as const,
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
    const parallel = revision({
      ...graph,
      edges: [
        { source: 'yes', target: 'join' },
        { source: 'no', target: 'join' },
      ],
    })
    expect((await prepareFlow(parallel, currentEngineContract)).kind).toBe('prepared')
  })

  it('restores transitive ancestor values and refuses incomplete checkpoint dependencies', async () => {
    const graph: Graph = {
      edges: [
        { source: 'before', target: 'pause' },
        { source: 'pause', sourceHandle: 'continue', target: 'after' },
      ],
      nodes: {
        before: { ...task, task: { ...task.task, outputs: [{ ...port, handle: 'value' }] } },
        pause: { kind: 'wait', inputs: {}, inputDefinitions: [{ ...port, handle: 'value', value: null }], prompt: 'Continue?' },
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
      { ...first.checkpoint, counts: {} },
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

  it('rejects invalid branch endpoints without inferring execution from inputs', async () => {
    for (const edges of [
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
    kind: 'approval' as const,
    inputs: {},
    inputDefinitions: [{ ...port, handle: 'value', value: null }],
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
      { source: 'wait', sourceHandle: 'pending', target: 'notify' },
    ],
  }
  const content = revision(graph)
  const result = await prepareFlow(content, currentEngineContract)
  expect(result.kind).toBe('flow-invalid')
  expect(availableOutputs(content.document, graph, 'notify')).toEqual({ wait: ['pending'] })
})

it('only offers resolution outputs on their reachable paths', () => {
  const wait = { kind: 'wait' as const, inputs: {}, inputDefinitions: [{ ...port, handle: 'value', value: null }], prompt: 'Continue?' }
  const approval = { kind: 'approval' as const, inputs: {}, inputDefinitions: [{ ...port, handle: 'value', value: null }], prompt: 'Approve?' }
  const jsonTask = { ...task, task: { ...task.task, inputs: [{ ...port, handle: 'input', jsonSchema: {} }] } }
  const graph: Graph = {
    nodes: {
      wait,
      approval,
      waitNotify: task,
      continue: jsonTask,
      approvalNotify: task,
      approve: task,
      reject: task,
    },
    edges: [
      { source: 'wait', sourceHandle: 'pending', target: 'waitNotify' },
      { source: 'wait', sourceHandle: 'continue', target: 'continue' },
      { source: 'approval', sourceHandle: 'pending', target: 'approvalNotify' },
      { source: 'approval', sourceHandle: 'approve', target: 'approve' },
      { source: 'approval', sourceHandle: 'reject', target: 'reject' },
    ],
  }
  const content = revision(graph)
  expect(availableOutputs(content.document, graph, 'waitNotify', 'input')).toEqual({ wait: ['pending'] })
  expect(availableOutputs(content.document, graph, 'continue', 'input')).toEqual({ wait: ['continue'] })
  expect(availableOutputs(content.document, graph, 'approvalNotify', 'input')).toEqual({ approval: ['pending'] })
  expect(availableOutputs(content.document, graph, 'approve', 'input')).toEqual({ approval: ['approve'] })
  expect(availableOutputs(content.document, graph, 'reject', 'input')).toEqual({ approval: ['reject'] })
  expect(inputSourceCandidates(content.document, graph, 'waitNotify', 'input')).toEqual({
    wait: [expect.objectContaining({ output: 'pending', check: { kind: 'available' } })],
  })
})

it.each([true, false])('runs with null from either an available nullable source or a missing branch source: %s', async (takeSource) => {
  const prepared = await prepareFlow(
    revision({
      nodes: {
        start: { kind: 'manual', name: 'Start' },
        choice: {
          kind: 'condition',
          cases: [{ output: 'yes', groups: [{ expressions: [{ left: { kind: 'value' as const, value: takeSource }, operator: 'isTrue' }] }] }],
          inputs: {},
          matchMode: 'first' as const,
        },
        source: { ...value, values: [{ ...port, handle: 'value', value: null }] },
        bypass: value,
        join: { ...task, inputs: { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'value' }] } } },
        after: task,
        independent: task,
        pause: { kind: 'wait', inputs: {}, inputDefinitions: [{ ...port, handle: 'value', value: null }], prompt: 'Continue?' },
      },
      edges: [
        { source: 'start', target: 'choice' },
        { source: 'choice', sourceHandle: 'yes', target: 'source' },
        { source: 'choice', sourceHandle: 'otherwise', target: 'bypass' },
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
  expect(first.checkpoint.counts['']?.join).toBe(1)
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

it.each(['notification', 'pending'])('dispatches an ordinary Condition branch named %s', async (branch) => {
  const prepared = await prepareFlow(
    revision({
      nodes: {
        start: { kind: 'manual', name: 'Start' },
        condition: {
          kind: 'condition',
          cases: [{ output: branch, groups: [{ expressions: [{ left: { kind: 'value', value: true }, operator: 'isTrue' }] }] }],
          inputs: {},
          matchMode: 'first',
        },
        after: value,
      },
      edges: [
        { source: 'start', target: 'condition' },
        { source: 'condition', sourceHandle: branch, target: 'after' },
      ],
    }),
    currentEngineContract,
  )
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  let nextId = 0
  const completed: string[] = []
  await Effect.runPromise(
    runFlow(prepared.flow, {
      flowId: 'main',
      runId: 'run',
      trigger: { nodeId: 'start', outputs: {} },
      createId: () => `job-${++nextId}`,
      emit: (event) =>
        Effect.sync(() => {
          if (event.type == 'node.completed') completed.push(event.nodeId)
        }),
      invokeTask: () => Effect.succeed({}),
    }),
  )
  expect(completed).toEqual(['condition', 'after'])
})

it.each(['edge', 'input'] as const)('rejects the old Wait notification %s reference', async (reference) => {
  const result = await prepareFlow(
    revision({
      nodes: {
        start: { kind: 'manual', name: 'Start' },
        wait: { kind: 'wait', inputDefinitions: [{ handle: 'value', ...port }], inputs: {}, prompt: 'Continue?' },
        after: {
          ...task,
          inputs: reference == 'input' ? { input: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'wait', output: 'notification' }] } } : {},
        },
      },
      edges: [
        { source: 'start', target: 'wait' },
        { source: 'wait', sourceHandle: reference == 'edge' ? 'notification' : 'pending', target: 'after' },
      ],
    }),
    currentEngineContract,
  )
  expect(result.kind).not.toBe('prepared')
})
