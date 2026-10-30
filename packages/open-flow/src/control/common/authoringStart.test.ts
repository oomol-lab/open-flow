import type { RevisionContent } from '../../flow/common/change.ts'
import type { AuthoringHost, AuthoringRequest } from './authoring.ts'

import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { runFlow } from '../../execution/common/scheduler.ts'
import { applyFlowChanges, currentFlowModelVersion } from '../../flow/common/change.ts'
import { inverseFlowChanges } from '../../flow/common/inverseChanges.ts'
import { prepareFlow } from '../../flow/common/semantics.ts'
import { currentEngineContract } from '../../runtime/common/runtime.ts'
import { authoringDiagnostics, authoringNode, authoringSchema, compileAuthoring, searchAuthoring } from './authoring.ts'

const empty: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { bindings: {}, graph: { nodes: {}, edges: [] } },
}
const host: AuthoringHost = {
  id: (label) => label,
  action: async () => {
    throw new Error('Unused Action')
  },
  trigger: () => {
    throw new Error('Unused Trigger')
  },
  openapi: async () => {
    throw new Error('Unused OpenAPI')
  },
}
const compile = (base: RevisionContent, edits: AuthoringRequest['edits']) => compileAuthoring(base, { baseRevision: 'base', requestId: 'request', edits }, host)

it('authors Start parameters, preserves local updates, and supplies their values downstream', async () => {
  const created = await compile(empty, [
    {
      op: 'node.add',
      as: 'start',
      type: 'start',
      name: 'Start',
      config: {
        inputDefs: {
          amount: { schema: { type: 'number' }, nullable: false, description: 'Order total' },
          note: { schema: { type: 'string' }, nullable: true },
        },
      },
    },
    {
      op: 'node.add',
      as: 'echo',
      type: 'code',
      name: 'Echo',
      code: 'export default input => ({result: input})',
      config: { outputs: { result: {} } },
      inputs: {
        amount: { kind: 'output', node: '$start', port: 'amount' },
        note: { kind: 'output', node: '$start', port: 'note' },
      },
    },
    { op: 'edge.connect', source: '$start', target: '$echo' },
  ])
  const start = created.nodes.start!
  const roundTrip = await compile(created.content, [
    { op: 'node.update', node: start, set: { config: JSON.parse(JSON.stringify(authoringNode(created.content, start).config)) } },
  ])
  expect(roundTrip.content).toEqual(created.content)
  const updated = await compile(created.content, [
    { op: 'node.update', node: start, set: { config: { inputDefs: { amount: { description: 'Invoice total' } } } } },
  ])
  expect((authoringNode(updated.content, start).config as Record<string, unknown>).inputDefs).toEqual({
    amount: { schema: { type: 'number' }, nullable: false, description: 'Invoice total' },
    note: { schema: { type: 'string' }, nullable: true },
  })
  expect(updated.content.document.graph.nodes[created.nodes.echo!]).toEqual(created.content.document.graph.nodes[created.nodes.echo!])
  expect(updated.content.document.graph.edges).toEqual(created.content.document.graph.edges)
  expect(searchAuthoring(updated.content, { query: 'Invoice total' }).matches).toContainEqual(expect.objectContaining({ node: start, field: 'config' }))
  const renamed = await compile(updated.content, [
    {
      op: 'node.update',
      node: start,
      set: { config: { inputDefs: { total: { schema: { type: 'number' }, nullable: false, description: 'Invoice total' } } } },
      clear: [['config', 'inputDefs', 'amount']],
    },
  ])
  const echo = renamed.content.document.graph.nodes[created.nodes.echo!]
  expect(echo != null && 'inputs' in echo ? echo.inputs.amount : undefined).toEqual({
    kind: 'sources',
    sources: [{ kind: 'node', nodeId: start, output: 'total' }],
  })
  const prepared = await prepareFlow(renamed.content, currentEngineContract)
  if (prepared.kind != 'prepared') throw new Error('Expected prepared Flow')
  const calls: unknown[] = []
  const result = await Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: start, outputs: { total: 0 } },
      invokeTask: (invocation) =>
        Effect.sync(() => {
          calls.push(invocation.input)
          return { result: invocation.input }
        }),
    }),
  )
  expect(result.kind).toBe('node-results')
  expect(calls).toEqual([{ amount: 0, note: null }])
})

it('shares the Start schema example and reports its business parameter location', async () => {
  const unrestricted = await compile(empty, [{ op: 'node.add', as: 'start', type: 'start', name: 'Start', config: { inputDefs: { value: {} } } }])
  expect((authoringNode(unrestricted.content, unrestricted.nodes.start!).config as Record<string, unknown>).inputDefs).toEqual({
    value: { schema: {}, nullable: true },
  })
  const example = authoringSchema('start').example!
  const created = await compile(empty, [example as AuthoringRequest['edits'][number]])
  const start = created.nodes.step!
  expect(authoringNode(created.content, start)).toMatchObject({
    type: 'start',
    config: {},
  })
  const diagnostic = authoringDiagnostics(unrestricted.content, [
    {
      code: 'start.parameter-invalid',
      message: 'Invalid parameter.',
      path: `/document/graph/nodes/${unrestricted.nodes.start}/inputDefs/0/jsonSchema/type`,
      line: 1,
      column: 0,
    },
  ])
  expect(diagnostic[0]).toMatchObject({ nodes: [unrestricted.nodes.start], field: 'config.inputDefs.value.schema.type' })
  await expect(
    compile(empty, [{ op: 'node.add', as: 'bad', type: 'start', name: 'Bad', config: { inputDefs: JSON.parse('{"message":{"default":"hello"}}') } }]),
  ).rejects.toThrow()
  await expect(compile(created.content, [{ op: 'input.set', node: start, input: 'message', source: { kind: 'value', value: 'hello' } }])).rejects.toMatchObject(
    { code: 'input.not-found' },
  )
})

it('reads a legacy Manual node as Start and upgrades only the new authored Revision', async () => {
  const legacy: RevisionContent = {
    ...empty,
    modelVersion: 6,
    document: { bindings: {}, graph: { nodes: { old: { kind: 'manual', name: 'Click' } }, edges: [] } },
  }
  expect(authoringNode(legacy, 'old')).toMatchObject({ ref: 'old', type: 'start', config: {} })
  const updated = await compile(legacy, [{ op: 'node.update', node: 'old', set: { description: 'Entry' } }])
  expect(updated.content.document.graph.nodes.old).toEqual({ inputDefs: [], kind: 'start', name: 'Click', description: 'Entry' })
  expect(legacy.document.graph.nodes.old).toEqual({ kind: 'manual', name: 'Click' })
})

it('deletes interface configuration with Start, restores it on undo, and starts empty on recreation', async () => {
  const created = await compile(empty, [
    {
      op: 'node.add',
      as: 'start',
      type: 'start',
      name: 'Start',
      config: { inputDefs: { amount: { schema: { type: 'number', minimum: 0 }, nullable: false } } },
    },
  ])
  const nodeId = created.nodes.start!
  const removed = await compile(created.content, [{ op: 'node.remove', node: nodeId }])
  expect(removed.content.document.graph.nodes[nodeId]).toBeUndefined()
  expect(removed.content.document).not.toHaveProperty('inputDefs')
  const restored = applyFlowChanges(removed.content, inverseFlowChanges(created.content, removed.operations))
  expect(authoringNode(restored, nodeId).config).toEqual(authoringNode(created.content, nodeId).config)
  const recreated = await compile(removed.content, [{ op: 'node.add', as: 'start', type: 'start', name: 'Start' }])
  expect(authoringNode(recreated.content, recreated.nodes.start!).config).toEqual({ inputDefs: {} })
  const clearedSchema = await compile(restored, [{ op: 'node.update', node: nodeId, clear: [['config', 'inputDefs', 'amount', 'schema', 'minimum']] }])
  expect(authoringNode(clearedSchema.content, nodeId).config).toEqual({ inputDefs: { amount: { schema: { type: 'number' }, nullable: false } } })
  const cleared = await compile(clearedSchema.content, [{ op: 'node.update', node: nodeId, clear: [['config', 'inputDefs']] }])
  expect(authoringNode(cleared.content, nodeId).outputPorts).toEqual({})
  await expect(compile(empty, [{ op: 'node.add', as: 'old', type: 'start', name: 'Start', config: { parameters: {} } }])).rejects.toThrow()
})
