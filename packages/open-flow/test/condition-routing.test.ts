import type { SchedulerEvent } from '../src/execution/common/scheduler.ts'
import type { ConditionCase, ConditionExpression, ConditionNode, JsonValue, RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges, currentFlowModelVersion, decodeChangeOperations } from '../src/flow/common/change.ts'
import { conditionOperands, nodeInputMappings, selectConditionBranches, setConditionInput } from '../src/flow/common/condition.ts'
import { decodeRevision, encodeRevision } from '../src/flow/common/encoding.ts'
import { availableOutputs } from '../src/flow/common/graph.ts'
import { inverseFlowChanges } from '../src/flow/common/inverseChanges.ts'
import { flowDependencies, prepareFlow } from '../src/flow/common/semantics.ts'
import { copyNodes, pasteNodes, updateCondition, updateTaskPorts } from '../src/workbench/browser/runtime/editor/flowChanges.ts'
import { revisionView } from '../src/workbench/browser/runtime/revisionView.ts'

const draft = (revision: RevisionContent) => ({ content: revision, flowId: 'flow', revision: 'draft' }) as unknown as Parameters<typeof revisionView>[0]

const literal = (value: JsonValue) => ({ kind: 'value' as const, value })
const expression = (value: boolean): ConditionExpression => ({ left: literal(value), operator: 'isTrue' })
const branch = (output: string, ...groups: boolean[][]): ConditionCase => ({
  output,
  groups: groups.map((values) => ({ expressions: values.map(expression) })),
})
const node = (cases: readonly ConditionCase[], matchMode: 'first' | 'all' = 'first'): ConditionNode => ({ kind: 'condition', inputs: {}, matchMode, cases })
function content(condition: ConditionNode): RevisionContent {
  return {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      tasks: {},
      subflows: {},
      graph: {
        nodes: {
          start: { kind: 'manual', name: 'Start' },
          data: {
            kind: 'value',
            inputs: {},
            values: [
              { handle: 'total', value: 100, jsonSchema: { type: 'number' }, nullable: false },
              { handle: 'limit', value: 50, jsonSchema: { type: 'number' }, nullable: false },
            ],
          },
          condition,
          ...Object.fromEntries([...condition.cases.map((item) => item.output), 'otherwise'].map((id) => [id, { kind: 'value', inputs: {}, values: [] }])),
        },
        edges: [
          { source: 'start', target: 'data' },
          { source: 'data', target: 'condition' },
          ...[...condition.cases.map((item) => item.output), 'otherwise'].map((id) => ({ source: 'condition', sourceHandle: id, target: id })),
        ],
      },
    },
  }
}
async function execute(revision: RevisionContent) {
  const prepared = await prepareFlow(revision, currentEngineContract, 'start')
  if (prepared.kind !== 'prepared') throw new Error(JSON.stringify(prepared))
  const events: SchedulerEvent[] = []
  let id = 0
  const result = await Effect.runPromise(
    runFlow(prepared.flow, {
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: 'start', outputs: {} },
      createId: () => `${++id}`,
      invokeTask: () => Effect.succeed({}),
      emit: (event) =>
        Effect.sync(() => {
          events.push(event)
        }),
    }),
  )
  return { result, events }
}
const values = (condition: ConditionNode) =>
  Object.fromEntries(
    conditionOperands(condition).flatMap(({ handle, operand }) => (operand.kind === 'value' && operand.value !== undefined ? [[handle, operand.value]] : [])),
  )

describe('Condition groups and routing', () => {
  it.each(['first', 'all'] as const)('executes %s matches without publishing route data', async (mode) => {
    const condition = node([branch('a', [true, true], [true]), branch('b', [false], [true, true]), branch('c', [false, false])], mode)
    const { events } = await execute(content(condition))
    expect(events.filter((event) => event.type === 'node.completed').map((event) => event.nodeId)).toEqual([
      'data',
      'condition',
      'a',
      ...(mode === 'all' ? ['b'] : []),
    ])
    expect(events.find((event) => event.type === 'node.completed' && event.nodeId === 'condition')).toMatchObject({ outputs: {} })
    expect(selectConditionBranches(condition, values(condition))).toEqual(mode === 'first' ? ['a'] : ['a', 'b'])
  })
  it.each(['first', 'all'] as const)('uses Otherwise only on zero matches in %s mode', async (mode) => {
    const revision = content(node([branch('a', [false])], mode))
    expect((await execute(revision)).events.filter((event) => event.type === 'node.completed').map((event) => event.nodeId)).toEqual([
      'data',
      'condition',
      'otherwise',
    ])
    const graph = revision.document.graph
    const unconnected = {
      ...revision,
      document: { ...revision.document, graph: { ...graph, edges: graph.edges.filter((edge) => edge.sourceHandle !== 'otherwise') } },
    }
    expect((await execute(unconnected)).result.kind).toBe('node-results')
  })
  it('preserves grouped logic and explicit priority across encoding and reordering', () => {
    const condition = node([branch('a', [true, false], [false, true]), branch('b', [true, true]), branch('c', [true])])
    const decoded = decodeRevision(encodeRevision(content(condition)))
    expect(decoded.document.graph.nodes.condition).toEqual(condition)
    expect(selectConditionBranches(condition, values(condition))).toEqual(['b'])
    const reordered = { ...condition, cases: [condition.cases[2]!, ...condition.cases.slice(0, 2)] }
    expect(selectConditionBranches(reordered, values(reordered))).toEqual(['c'])
  })
  it('resolves both Source operands through ordinary upstream bindings', async () => {
    const condition = node([
      {
        output: 'a',
        groups: [
          {
            expressions: [
              {
                left: { kind: 'source', source: { kind: 'node', nodeId: 'data', output: 'total' } },
                operator: '>',
                right: { kind: 'source', source: { kind: 'node', nodeId: 'data', output: 'limit' } },
              },
            ],
          },
        ],
      },
    ])
    const revision = content(condition)
    expect(Object.values(nodeInputMappings(condition))).toHaveLength(2)
    expect(availableOutputs(revision.document, revision.document.graph, 'a')).toEqual({ data: ['total', 'limit'] })
    expect((await execute(revision)).events.filter((event) => event.type === 'node.completed').map((event) => event.nodeId)).toEqual(['data', 'condition', 'a'])
  })
  it('retains later-case Variable dependencies in first mode', () => {
    const condition = node([
      branch('a', [true]),
      {
        output: 'b',
        groups: [{ expressions: [{ left: { kind: 'source', source: { kind: 'binding', bindingId: 'secret' } }, operator: '==', right: literal('yes') }] }],
      },
    ])
    const revision = content(condition)
    expect([...flowDependencies(revision).inputBindings]).toEqual(['secret'])
  })
  it('fails when a later-case Source is absent at runtime instead of selecting the first case', async () => {
    const condition = node([
      branch('a', [true]),
      {
        output: 'b',
        groups: [{ expressions: [{ left: { kind: 'source', source: { kind: 'node', nodeId: 'skipped', output: 'value' } }, operator: 'isNotNull' }] }],
      },
    ])
    const revision = content(condition)
    const gate = node([branch('skip', [true])])
    const graph = revision.document.graph
    const withSkipped: RevisionContent = {
      ...revision,
      document: {
        ...revision.document,
        graph: {
          nodes: { ...graph.nodes, gate, skipped: { kind: 'value', inputs: {}, values: [{ handle: 'value', jsonSchema: {}, nullable: true, value: 1 }] } },
          edges: [
            { source: 'start', target: 'gate' },
            { source: 'gate', sourceHandle: 'skip', target: 'condition' },
            { source: 'gate', sourceHandle: 'otherwise', target: 'skipped' },
            { source: 'skipped', target: 'condition' },
            ...graph.edges.filter((edge) => edge.source === 'condition'),
          ],
        },
      },
    }
    await expect(execute(withSkipped)).rejects.toThrow('Source has no value')
  })
  it('rejects invalid runtime types even when a previous case matches', () => {
    const condition = node([branch('a', [true]), { output: 'b', groups: [{ expressions: [{ left: literal('bad'), operator: '>', right: literal(1) }] }] }])
    expect(() => selectConditionBranches(condition, values(condition))).toThrow('not compatible')
  })
  it('fails on incompatible runtime Source values before selecting a matching route', async () => {
    const condition = node([
      branch('a', [true]),
      {
        output: 'b',
        groups: [{ expressions: [{ left: { kind: 'source', source: { kind: 'node', nodeId: 'data', output: 'total' } }, operator: '>', right: literal(1) }] }],
      },
    ])
    const revision = content(condition)
    const graph = revision.document.graph
    const runtimeValue = {
      ...revision,
      document: {
        ...revision.document,
        graph: {
          ...graph,
          nodes: { ...graph.nodes, data: { kind: 'value' as const, inputs: {}, values: [{ handle: 'total', jsonSchema: {}, nullable: false, value: 'bad' }] } },
        },
      },
    }
    await expect(execute(runtimeValue)).rejects.toThrow('not compatible')
  })
  it.each([
    node([{ output: 'a', groups: [] }]),
    node([{ output: 'a', groups: [{ expressions: [] }] }]),
    node([{ output: 'a', groups: [{ expressions: [{ left: { kind: 'value' }, operator: '==' }] }] }]),
    node([branch('otherwise', [true])]),
    node([branch('', [true])]),
    node([branch('a', [true]), branch('a', [false])]),
    node([{ output: 'a', groups: [{ expressions: [{ ...expression(true), right: literal(false) }] }] }]),
    node([{ output: 'a', groups: [{ expressions: [{ left: literal(1), operator: 'contains', right: literal(1) }] }] }]),
    node([
      {
        output: 'a',
        groups: [{ expressions: [{ left: { kind: 'source', source: { kind: 'node', nodeId: 'missing', output: 'value' } }, operator: 'isNull' }] }],
      },
    ]),
  ])('blocks invalid configuration %#', async (condition) => {
    // The invalid branch name must not overwrite the Condition under test.
    const revision = content(condition)
    expect((await prepareFlow(revision, currentEngineContract)).kind).toBe('flow-invalid')
  })
  it('rejects a source from a descendant and rejects route ports as data sources', async () => {
    for (const source of [
      { kind: 'node' as const, nodeId: 'a', output: 'value' },
      { kind: 'node' as const, nodeId: 'condition', output: 'a' },
    ]) {
      const condition = setConditionInput(node([branch('a', [true])]), '0/0/0/left', { kind: 'sources', sources: [source] })
      expect((await prepareFlow(content(condition), currentEngineContract)).kind).toBe('flow-invalid')
    }
  })
})

describe('Condition editing contracts', () => {
  const target = { kind: 'flow' as const }
  it('renames, deletes and reorders routes with reversible ordinary history', () => {
    const original = content(node([branch('a', [true]), branch('b', [true])]))
    const current = original.document.graph.nodes.condition as ConditionNode
    for (const cases of [[{ ...current.cases[0]!, output: 'renamed' }, current.cases[1]!], [current.cases[1]!], current.cases.toReversed()]) {
      const changes = updateCondition(revisionView(draft(original)), target, 'condition', { cases, matchMode: 'all' })!
      const updated = applyFlowChanges(original, changes)
      expect(applyFlowChanges(updated, inverseFlowChanges(original, changes))).toEqual(original)
      expect(applyFlowChanges(applyFlowChanges(updated, inverseFlowChanges(original, changes)), changes)).toEqual(updated)
      expect(
        updated.document.graph.edges
          .filter((edge) => edge.source === 'condition')
          .every((edge) => edge.sourceHandle === 'otherwise' || cases.some((item) => item.output === edge.sourceHandle)),
      ).toBe(true)
    }
  })
  it('edits operand bindings via public changes without creating node input ports', () => {
    const original = content(
      node([{ output: 'a', groups: [{ expressions: [{ left: { kind: 'value', value: true, jsonSchema: { type: 'boolean' } }, operator: 'isTrue' }] }] }]),
    )
    const changes = decodeChangeOperations([
      {
        kind: 'graph.node.input.set',
        nodeId: 'condition',
        target,
        handle: '0/0/0/left',
        before: { kind: 'value', value: true },
        value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'data', output: 'total' }] },
      },
    ])
    const updated = applyFlowChanges(original, changes)
    expect((updated.document.graph.nodes.condition as ConditionNode).inputs).toEqual({})
    expect(applyFlowChanges(updated, inverseFlowChanges(original, changes))).toEqual(original)
    const view = revisionView(draft(updated))
    const clipboard = copyNodes(view, target, ['data', 'condition'])
    let id = 0
    const pasted = pasteNodes(view, target, clipboard, () => `copy${++id}`)
    const copied = applyFlowChanges(updated, pasted.changes)
    const copiedCondition = copied.document.graph.nodes[pasted.nodeIds[pasted.sourceIds.indexOf('condition')]!]!
    expect(Object.values(nodeInputMappings(copiedCondition))[0]).toEqual({
      kind: 'sources',
      sources: [{ kind: 'node', nodeId: pasted.nodeIds[pasted.sourceIds.indexOf('data')], output: 'total' }],
    })
  })
  it('updates Condition references when an ordinary upstream output is renamed', () => {
    let revision = content(
      setConditionInput(node([branch('a', [true])]), '0/0/0/left', { kind: 'sources', sources: [{ kind: 'node', nodeId: 'source', output: 'old' }] }),
    )
    revision = {
      ...revision,
      modules: { code: { name: 'Source', imports: [], source: 'export default () => ({})' } },
      document: {
        ...revision.document,
        graph: {
          ...revision.document.graph,
          nodes: {
            ...revision.document.graph.nodes,
            source: {
              kind: 'task',
              inputs: {},
              task: { moduleId: 'code', name: 'Source', inputs: [], outputs: [{ handle: 'old', jsonSchema: {}, nullable: true }] },
            },
          },
        },
      },
    }
    const changes = updateTaskPorts(revisionView(draft(revision)), target, 'source', {
      inputs: [],
      outputs: [{ handle: 'new', jsonSchema: {}, nullable: true }],
    })!
    const updated = applyFlowChanges(revision, changes)
    expect(Object.values(nodeInputMappings(updated.document.graph.nodes.condition!))[0]).toEqual({
      kind: 'sources',
      sources: [{ kind: 'node', nodeId: 'source', output: 'new' }],
    })
    expect(applyFlowChanges(updated, inverseFlowChanges(revision, changes))).toEqual(revision)
  })
})
