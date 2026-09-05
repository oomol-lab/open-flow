import type { Graph, RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges } from '../src/flow/common/change.ts'
import { availableOutputs, prepareFlow } from '../src/flow/common/semantics.ts'

const port = { jsonSchema: {}, nullable: true }
const value = { inputs: {}, kind: 'value' as const, values: [{ ...port, handle: 'value', value: 1 }] }
const task = { inputs: {}, kind: 'task' as const, task: { inputs: [{ ...port, handle: 'input', value: null }], moduleId: 'main', name: 'Task', outputs: [] } }
function revision(graph: Graph): RevisionContent {
  return {
    document: { bindings: {}, graph, subflows: {}, tasks: {} },
    modelVersion: 1,
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

  it('distinguishes parallel ancestors from possibly skipped branch results', () => {
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
    expect(availableOutputs(revision(graph).document, graph, 'd')).toEqual({})
    expect(availableOutputs(revision(graph).document, graph, 'b')).toEqual({ a: ['yes'] })
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
    const prepared = await prepareFlow(revision(graph), currentEngineContract)
    expect(prepared.kind).toBe('prepared')
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    const calls: unknown[] = []
    const skipped: string[] = []
    let id = 0
    await Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => String(++id),
        flowId: 'main',
        runId: 'run',
        emit: (event) =>
          Effect.sync(() => {
            if (event.type == 'node.skipped') skipped.push(event.nodeId)
          }),
        invokeTask: (invocation) =>
          Effect.sync(() => {
            calls.push(invocation.input)
            return {}
          }),
      }),
    )
    expect(calls).toEqual([{ input: input ? 1 : 2 }])
    expect(skipped).toEqual([input ? 'no' : 'yes'])
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
    const prepared = await prepareFlow(revision(graph), currentEngineContract)
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    let id = 0
    const options = { createId: () => String(++id), flowId: 'main', runId: 'run' }
    const first = await Effect.runPromise(runFlow(prepared.flow, { ...options, invokeTask: () => Effect.succeed({ value: 42 }) }))
    if (first.kind != 'waiting') throw new Error('Expected Wait.')
    const calls: unknown[] = []
    await Effect.runPromise(
      runFlow(prepared.flow, {
        ...options,
        resume: { action: 'continue', checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
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
            resume: { action: 'continue', checkpoint },
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
