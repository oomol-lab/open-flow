import type { AuthoringHost, AuthoringRequest } from '../src/control/common/authoring.ts'
import type { FlowRunOptions, SchedulerEvent } from '../src/execution/common/scheduler.ts'
import type { Graph, InputMapping, Port, RevisionContent, OutputsNode } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { authoringNode, authoringSchema, compileAuthoring, searchAuthoring } from '../src/control/common/authoring.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges, currentFlowModelVersion } from '../src/flow/common/change.ts'
import { decodeRevision, encodeRevision, digestBytes } from '../src/flow/common/encoding.ts'
import { validateFlowGraph, inputSourceCandidates } from '../src/flow/common/graph.ts'
import { inverseFlowChanges } from '../src/flow/common/inverseChanges.ts'
import { deleteNodes, setInputVariable, updateStartInputDefs, updateOutputsDefs } from '../src/flow/common/nodeChanges.ts'
import { flowClosure, flowDependencies, prepareFlow } from '../src/flow/common/semantics.ts'
import { currentEngineContract } from '../src/runtime/common/runtime.ts'
import { advanceWaiting, waitHost } from './waitHost.ts'

const field = (handle: string): Port => ({ handle, jsonSchema: { type: 'number' }, nullable: false })
const source = (nodeId: string, output = 'value'): InputMapping => ({ kind: 'sources', sources: [{ kind: 'node', nodeId, output }] })
const value = (n: number) => ({ kind: 'value' as const, name: `Value ${n}`, inputs: {}, values: [{ ...field('value'), value: n }] })
function content(graph?: Graph): RevisionContent {
  const sourceGraph: Graph = graph ?? {
    nodes: {
      start: { kind: 'start', name: 'Start', inputDefs: [] },
      value: value(42),
      outputs: { kind: 'outputs', name: 'Outputs', outputDefs: [], outputMappings: {} },
    },
    edges: [
      { source: 'start', target: 'value' },
      { source: 'value', target: 'outputs' },
    ],
  }
  const outputs = sourceGraph.nodes.outputs
  if (outputs?.kind != 'outputs') throw new Error('Expected Outputs fixture')
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        ...sourceGraph,
        nodes: { ...sourceGraph.nodes, outputs: { ...outputs, outputDefs: [field('answer')], outputMappings: { answer: source('value') } } },
      },
    },
  }
}
function outputNode(revision: RevisionContent) {
  const node = Object.values(revision.document.graph.nodes).find((candidate) => candidate.kind == 'outputs')
  if (node?.kind != 'outputs') throw new Error('Expected Outputs')
  return node
}
function outputsDocument(revision: RevisionContent, patch: Partial<OutputsNode>) {
  return {
    ...revision.document,
    graph: { ...revision.document.graph, nodes: { ...revision.document.graph.nodes, outputs: { ...outputNode(revision), ...patch } } },
  }
}
async function run(revision: RevisionContent, options: Partial<Pick<FlowRunOptions, 'emit' | 'invokeTask' | 'bindingValues'>> = {}) {
  const prepared = await prepareFlow(revision, currentEngineContract, 'start')
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  return Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: 'start', outputs: {} },
      invokeTask: () => Effect.succeed({}),
      ...options,
    }),
  )
}
const host: AuthoringHost = {
  id: (label) => label,
  action: async () => {
    throw new Error('Unused')
  },
  trigger: () => {
    throw new Error('Unused')
  },
  openapi: async () => {
    throw new Error('Unused')
  },
}
const compile = (base: RevisionContent, edits: AuthoringRequest['edits']) => compileAuthoring(base, { baseRevision: 'base', requestId: 'request', edits }, host)

describe('workflow Outputs', () => {
  it('computes each loop invocation from its own snapshot and retains the final business output', async () => {
    const revision = content({
      nodes: {
        start: { inputDefs: [], kind: 'start', name: 'Start' },
        counter: {
          kind: 'task',
          inputs: { previous: source('counter', 'count') },
          task: { name: 'Counter', moduleId: 'counter', inputs: [{ handle: 'previous', jsonSchema: {}, nullable: true }], outputs: [field('count')] },
        },
        choose: {
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
                      left: { kind: 'source', source: { kind: 'node', nodeId: 'counter', output: 'count' } },
                      operator: '<',
                      right: { kind: 'value', value: 3 },
                    },
                  ],
                },
              ],
            },
          ],
        },
        outputs: { outputDefs: [], outputMappings: {}, kind: 'outputs', name: 'Outputs' },
      },
      edges: [
        { source: 'start', target: 'counter' },
        { source: 'counter', target: 'choose' },
        { source: 'choose', sourceHandle: 'again', target: 'counter' },
        { source: 'counter', target: 'outputs' },
      ],
    })
    const seen: unknown[] = []
    const result = await run(
      {
        ...revision,
        modules: { counter: { name: 'Counter', imports: [], source: 'export default () => ({count: 1})' } },
        document: outputsDocument(revision, { outputMappings: { answer: source('counter', 'count') } }),
      },
      {
        invokeTask: (call) => Effect.succeed({ count: Number(call.input.previous ?? 0) + 1 }),
        emit: (event) =>
          Effect.sync(() => {
            if (event.type == 'node.completed' && event.nodeId == 'outputs') seen.push(event.outputs.answer)
          }),
      },
    )
    expect(seen).toEqual([1, 2, 3])
    expect(result).toHaveProperty('outputs', { answer: 3 })
  })

  it('restores completed Outputs across a wait without executing it again', async () => {
    const base = content()
    const revision: RevisionContent = {
      ...base,
      document: {
        ...base.document,
        graph: {
          nodes: { ...base.document.graph.nodes, wait: { kind: 'wait', name: 'Wait', inputs: {}, inputDefinitions: [], prompt: 'Continue?' } },
          edges: [...base.document.graph.edges, { source: 'start', target: 'wait' }],
        },
      },
    }
    const prepared = await prepareFlow(revision, currentEngineContract, 'start')
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    const events: SchedulerEvent[] = []
    const shared = {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      invokeTask: () => Effect.succeed({}),
      emit: (event: SchedulerEvent) =>
        Effect.sync(() => {
          events.push(event)
        }),
    }
    const first = await advanceWaiting(runFlow(prepared.flow, { ...shared, trigger: { nodeId: 'start', outputs: {} }, waits: waitHost() }))
    if (first.kind != 'waiting') throw new Error('Expected wait checkpoint')
    expect(first.checkpoint.results.outputs?.outputs).toEqual({ answer: 42 })
    const result = await Effect.runPromise(
      runFlow(prepared.flow, {
        ...shared,
        resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) },
        waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
      }),
    )
    expect(result).toHaveProperty('outputs', { answer: 42 })
    expect(events.filter((event) => event.type == 'node.started' && event.nodeId == 'outputs')).toHaveLength(1)
  })
  it('round trips, contributes to semantic identity, and preserves legacy bytes', async () => {
    const revision = content()
    expect(decodeRevision(encodeRevision(revision))).toEqual(revision)
    const changed = applyFlowChanges(revision, [
      {
        kind: 'graph.node.input.set',
        nodeId: 'outputs',
        handle: 'answer',
        before: outputNode(revision).outputMappings.answer,
        value: { kind: 'value', value: 7 },
      },
    ])
    expect((await flowClosure(changed)).digest).not.toBe((await flowClosure(revision)).digest)
    const legacy: RevisionContent = {
      modelVersion: 7,
      modules: {},
      document: { bindings: {}, graph: { nodes: { start: { inputDefs: [], kind: 'start', name: 'Start' } }, edges: [] } },
    }
    const encoded = encodeRevision(legacy)
    expect(await digestBytes(encodeRevision(decodeRevision(encoded)))).toEqual(await digestBytes(encoded))
    expect(() => decodeRevision(encodeRevision({ ...revision, modelVersion: 7 }))).toThrow('version 8')
  })

  it('keeps business outputs alongside terminal node results and normal events', async () => {
    const events: SchedulerEvent[] = []
    const result = await run(content(), {
      emit: (event) =>
        Effect.sync(() => {
          events.push(event)
        }),
    })
    expect(result).toMatchObject({ kind: 'node-results', outputs: { answer: 42 }, nodes: [{ nodeId: 'outputs', outputs: { answer: 42 } }] })
    expect(events).toContainEqual(expect.objectContaining({ type: 'node.started', nodeKind: 'outputs', nodeId: 'outputs', inputs: { answer: 42 } }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'node.completed', nodeId: 'outputs', outputs: { answer: 42 } }))
  })

  it('waits for both predecessors, then completes without terminating an independent branch', async () => {
    const right = Promise.withResolvers<Record<string, number>>()
    const unrelated = Promise.withResolvers<Record<string, number>>()
    const leftDone = Promise.withResolvers<void>()
    const outputDone = Promise.withResolvers<void>()
    const task = { kind: 'task' as const, inputs: {}, task: { name: 'Task', moduleId: 'main', inputs: [], outputs: [field('value')] } }
    const revision = content({
      nodes: {
        start: { inputDefs: [], kind: 'start', name: 'Start' },
        left: task,
        right: task,
        unrelated: task,
        outputs: { outputDefs: [], outputMappings: {}, kind: 'outputs', name: 'Outputs' },
      },
      edges: ['left', 'right', 'unrelated']
        .map((target) => ({ source: 'start', target }))
        .concat([
          { source: 'left', target: 'outputs' },
          { source: 'right', target: 'outputs' },
        ]),
    })
    const events: SchedulerEvent[] = []
    const execution = run(
      {
        ...revision,
        modules: { main: { name: 'Task', imports: [], source: 'export default () => ({value: 0})' } },
        document: outputsDocument(revision, { outputDefs: [field('left'), field('right')], outputMappings: { left: source('left'), right: source('right') } }),
      },
      {
        invokeTask: ({ nodeId }) =>
          nodeId == 'left' ? Effect.succeed({ value: 1 }) : Effect.promise(() => (nodeId == 'right' ? right.promise : unrelated.promise)),
        emit: (event) =>
          Effect.sync(() => {
            events.push(event)
            if (event.type == 'node.completed' && event.nodeId == 'left') leftDone.resolve()
            if (event.type == 'node.completed' && event.nodeId == 'outputs') outputDone.resolve()
          }),
      },
    )
    await leftDone.promise
    expect(events.some((event) => event.type == 'node.started' && event.nodeId == 'outputs')).toBe(false)
    right.resolve({ value: 2 })
    await outputDone.promise
    expect(events.some((event) => event.type == 'run.completed')).toBe(false)
    unrelated.resolve({ value: 3 })
    expect(await execution).toMatchObject({ outputs: { left: 1, right: 2 }, nodes: expect.arrayContaining([expect.objectContaining({ nodeId: 'unrelated' })]) })
  })

  it.each([true, false])('uses selected branches and skips inactive sources (%s)', async (selected) => {
    const revision = content({
      nodes: {
        start: { inputDefs: [], kind: 'start', name: 'Start' },
        condition: {
          kind: 'condition',
          inputs: {},
          matchMode: 'first',
          cases: [{ output: 'yes', groups: [{ expressions: [{ left: { kind: 'value', value: selected }, operator: 'isTrue' }] }] }],
        },
        yes: value(1),
        no: value(2),
        outputs: { outputDefs: [], outputMappings: {}, kind: 'outputs', name: 'Outputs' },
      },
      edges: [
        { source: 'start', target: 'condition' },
        { source: 'condition', sourceHandle: 'yes', target: 'yes' },
        { source: 'condition', sourceHandle: 'otherwise', target: 'no' },
        { source: 'yes', target: 'outputs' },
        { source: 'no', target: 'outputs' },
      ],
    })
    const mapping: InputMapping = {
      kind: 'sources',
      sources: [
        { kind: 'node', nodeId: 'yes', output: 'value' },
        { kind: 'node', nodeId: 'no', output: 'value' },
      ],
    }
    expect(await run({ ...revision, document: outputsDocument(revision, { outputMappings: { answer: mapping } }) })).toMatchObject({
      outputs: { answer: selected ? 1 : 2 },
    })
    const skipped: RevisionContent = {
      ...revision,
      document: {
        ...outputsDocument(revision, { outputMappings: { answer: { kind: 'value', value: 0 } } }),
        graph: {
          ...outputsDocument(revision, { outputMappings: { answer: { kind: 'value', value: 0 } } }).graph,
          edges: revision.document.graph.edges.filter((edge) => edge.target != 'outputs').concat([{ source: selected ? 'no' : 'yes', target: 'outputs' }]),
        },
      },
    }
    expect(await run(skipped)).not.toHaveProperty('outputs')
  })

  it('preserves definitions and variable references through deletion, rename and undo', () => {
    const revision = content()
    const variable = applyFlowChanges(revision, setInputVariable(revision, 'outputs', 'answer', 'TOKEN', 'binding')!)
    const removed = applyFlowChanges(variable, deleteNodes(variable, ['outputs']))
    expect(removed.document.graph.nodes.outputs).toBeUndefined()
    expect(removed.document.bindings).toEqual({})
    const renamed = updateOutputsDefs(variable, 'outputs', [field('result')])
    expect(outputNode(applyFlowChanges(variable, renamed)).outputMappings).toEqual({ result: outputNode(variable).outputMappings.answer })
    expect(applyFlowChanges(applyFlowChanges(variable, renamed), inverseFlowChanges(variable, renamed))).toEqual(variable)
    expect([...flowDependencies(variable).bindings]).toEqual(['binding'])
    const fromStart: RevisionContent = {
      ...revision,
      document: {
        ...outputsDocument(revision, { outputMappings: { answer: source('start', 'amount') } }),
        graph: {
          ...revision.document.graph,
          nodes: {
            ...revision.document.graph.nodes,
            start: { kind: 'start', name: 'Start', inputDefs: [field('amount')] },
            outputs: { ...outputNode(revision), outputMappings: { answer: source('start', 'amount') } },
          },
        },
      },
    }
    expect(outputNode(applyFlowChanges(fromStart, updateStartInputDefs(fromStart, 'start', [field('total')]))).outputMappings).toEqual({
      answer: source('start', 'total'),
    })
    expect(inputSourceCandidates(revision.document.graph, 'outputs', 'answer').value).toMatchObject([{ output: 'value', check: { kind: 'available' } }])
  })

  it('rejects duplicate sinks, outgoing edges, invalid types, conflicting and missing sources', async () => {
    const revision = content()
    expect(() =>
      applyFlowChanges(revision, [
        { kind: 'graph.node.create', nodeId: 'another', node: { outputDefs: [], outputMappings: {}, kind: 'outputs', name: 'Another' } },
      ]),
    ).toThrow('only one')
    expect(() => applyFlowChanges(revision, [{ kind: 'graph.edge.connect', edge: { source: 'outputs', target: 'value' } }])).toThrow('downstream')
    const invalid = { ...revision, document: outputsDocument(revision, { outputMappings: { answer: { kind: 'value', value: 'wrong' } } }) }
    await expect(run(invalid)).rejects.toThrow('declared schema')
    expect(validateFlowGraph({ ...revision, document: outputsDocument(revision, { outputMappings: { answer: source('missing') } }) })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'graph.source-missing' })]),
    )
    const conflict: InputMapping = {
      kind: 'sources',
      sources: [
        { kind: 'node', nodeId: 'value', output: 'value' },
        { kind: 'node', nodeId: 'value', output: 'value' },
      ],
    }
    expect(validateFlowGraph({ ...revision, document: outputsDocument(revision, { outputMappings: { answer: conflict } }) })).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'graph.source-unavailable' })]),
    )
    expect(await run({ ...revision, document: outputsDocument(revision, { outputDefs: [], outputMappings: {} }) })).toHaveProperty('outputs', {})
    expect(
      await run({
        ...revision,
        document: outputsDocument(revision, { outputDefs: [{ ...field('answer'), nullable: true }], outputMappings: { answer: { kind: 'unset' } } }),
      }),
    ).toHaveProperty('outputs', { answer: null })
  })

  it('resolves variable and nested field sources and preserves literal output names', async () => {
    const revision = content()
    const mappings = Object.fromEntries([
      ['__proto__', { kind: 'value', value: { safe: true } }],
      ['constructor', { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'token' }] }],
      ['nested', { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'record', field: 'count' }] }],
    ]) as Record<string, InputMapping>
    const changed: RevisionContent = {
      ...revision,
      document: {
        ...revision.document,

        bindings: { token: { kind: 'variable' as const, target: 'TOKEN' } },
        graph: {
          ...revision.document.graph,
          nodes: {
            ...revision.document.graph.nodes,
            start: {
              ...(revision.document.graph.nodes['start'] as Extract<import('../src/flow/common/change.ts').GraphNode, { kind: 'start' }>),
              inputDefs: [
                { handle: 'record', jsonSchema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] }, nullable: false },
              ],
            },
            outputs: {
              ...(revision.document.graph.nodes['outputs'] as Extract<import('../src/flow/common/change.ts').GraphNode, { kind: 'outputs' }>),
              outputDefs: [
                { handle: '__proto__', jsonSchema: {}, nullable: false },
                { handle: 'constructor', jsonSchema: { type: 'string' }, nullable: false },
                field('nested'),
              ],
              outputMappings: mappings,
            },
          },
        },
      },
    }
    const prepared = await prepareFlow(changed, currentEngineContract, 'start')
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    const result = await Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => crypto.randomUUID(),
        flowId: 'flow',
        runId: 'run',
        trigger: { nodeId: 'start', outputs: { record: { count: 0 } } },
        bindingValues: { token: 'value' },
        invokeTask: () => Effect.succeed({}),
      }),
    )
    expect(result).toHaveProperty('outputs', JSON.parse('{"__proto__":{"safe":true},"constructor":"value","nested":0}'))
  })

  it('authors, reads, locally edits and executes through public operations', async () => {
    const empty: RevisionContent = { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } }
    const created = await compile(empty, [
      { op: 'node.add', type: 'start', name: 'Start', as: 'start', config: { inputDefs: { amount: { schema: { type: 'number' }, nullable: false } } } },
      {
        op: 'node.add',
        type: 'outputs',
        name: 'Outputs',
        as: 'outputs',
        inputs: { total: { kind: 'output', node: '$start', port: 'amount' } },
        config: { outputDefs: { total: { schema: { type: 'number' }, nullable: false } } },
      },
      { op: 'edge.connect', source: '$start', target: '$outputs' },
    ])
    const outputId = created.nodes.outputs!
    expect(authoringNode(created.content, outputId)).toMatchObject({
      type: 'outputs',
      config: {},
      inputPorts: { total: { schema: { type: 'number' } } },
      outputPorts: {},
    })
    expect(authoringNode(created.content, outputId)).toMatchObject({
      inputs: { total: { kind: 'sources', sources: [{ kind: 'output', node: created.nodes.start, port: 'amount' }] } },
    })
    const changed = await compile(created.content, [
      { op: 'node.update', node: outputId, set: { config: { outputDefs: { total: { description: 'Invoice total' } } } } },
    ])
    expect(outputNode(changed.content).outputMappings).toEqual(outputNode(created.content).outputMappings)
    expect(searchAuthoring(changed.content, { query: 'Invoice total' }).matches).toContainEqual(expect.objectContaining({ node: outputId, field: 'config' }))
    const prepared = await prepareFlow(changed.content, currentEngineContract, created.nodes.start!)
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    expect(
      await Effect.runPromise(
        runFlow(prepared.flow, {
          createId: () => crypto.randomUUID(),
          flowId: 'flow',
          runId: 'run',
          trigger: { nodeId: created.nodes.start!, outputs: { amount: 0 } },
          invokeTask: () => Effect.succeed({}),
        }),
      ),
    ).toHaveProperty('outputs', { total: 0 })
    await expect(compile(created.content, [{ op: 'input.set', node: outputId, input: 'unknown', source: { kind: 'value', value: 1 } }])).rejects.toMatchObject({
      code: 'input.not-found',
    })
    expect((await compile(empty, [authoringSchema('outputs').example as AuthoringRequest['edits'][number]])).content.document.graph.nodes).toHaveProperty(
      'node:step',
      { outputDefs: [], outputMappings: {}, kind: 'outputs', name: 'Step' },
    )
  })
})
