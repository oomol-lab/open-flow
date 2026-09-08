import type { Graph, JsonValue, RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'

const port = { handle: 'value', jsonSchema: {}, nullable: false } as const
const start = { kind: 'manual', name: 'Start' } as const
const other = { kind: 'webhook', name: 'Other', inputsDef: [{ handle: 'entry', jsonSchema: { type: 'string' }, nullable: false }] } as const
const task = {
  kind: 'task',
  inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'payload' }] } },
  task: { name: 'Code', moduleId: 'main', inputs: [port], outputs: [] },
} as const

function revision(graph: Graph): RevisionContent {
  return {
    modelVersion: 1,
    modules: { main: { name: 'Main', imports: [], source: 'export default () => ({})' } },
    document: { bindings: {}, subflows: {}, tasks: {}, graph },
  }
}

it('prepares and executes an entry while unrelated nodes remain invalid', async () => {
  const content = revision({
    edges: [
      { source: 'start', target: 'code' },
      { source: 'broken', target: 'broken' },
    ],
    nodes: {
      start,
      code: task,
      broken: { ...task, task: { ...task.task, moduleId: 'missing' } },
      unused: { kind: 'subflow', subflowId: 'missing', inputs: {} },
      other: {
        kind: 'poll',
        name: 'Unconfigured',
        bindingId: 'missing',
        config: {},
        pollTimes: [],
        definition: {
          configSchema: {},
          payloadSchema: {},
          definitionVersion: 1,
          description: '',
          displayName: 'Other',
          key: 'example.event',
          name: 'event',
          provider: 'example',
          type: 'poll',
        },
      },
    },
  })
  const original = structuredClone(content)
  expect((await prepareFlow(content, currentEngineContract)).kind).toBe('flow-invalid')
  const prepared = await prepareFlow(content, currentEngineContract, 'start')
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  const calls: unknown[] = []
  const outcome = await Effect.runPromise(
    runFlow(prepared.flow, {
      createId: () => crypto.randomUUID(),
      flowId: 'flow',
      runId: 'run',
      trigger: { nodeId: 'start', payload: {} },
      invokeTask: (invocation) =>
        Effect.sync(() => {
          calls.push(invocation.input)
          return {}
        }),
    }),
  )
  expect(outcome).toMatchObject({ kind: 'node-results', nodes: [{ nodeId: 'code', status: 'completed' }] })
  expect(calls).toEqual([{ value: {} }])
  expect(content).toEqual(original)
  expect((await prepareFlow(content, currentEngineContract, 'other')).kind).toBe('flow-invalid')
})

it('uses only the selected trigger source at a join shared by multiple triggers', async () => {
  const content = revision({
    edges: [
      { source: 'start', target: 'code' },
      { source: 'other', target: 'code' },
    ],
    nodes: {
      start,
      other,
      code: {
        ...task,
        inputs: {
          value: {
            kind: 'sources',
            sources: [
              { kind: 'node', nodeId: 'start', output: 'payload' },
              { kind: 'node', nodeId: 'other', output: 'payload' },
            ],
          },
        },
      },
    },
  })
  for (const nodeId of ['start', 'other']) {
    const payload: JsonValue = nodeId == 'start' ? {} : { entry: nodeId }
    const prepared = await prepareFlow(content, currentEngineContract, nodeId)
    if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
    const calls: unknown[] = []
    await Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => crypto.randomUUID(),
        flowId: 'flow',
        runId: 'run',
        trigger: { nodeId, payload },
        invokeTask: (invocation) =>
          Effect.sync(() => {
            calls.push(invocation.input)
            return {}
          }),
      }),
    )
    expect(calls).toEqual([{ value: payload }])
  }
})

it.each(['other', 'missing', 'code'])('rejects a required input from unavailable node %s', async (nodeId) => {
  const content = revision({
    edges: [{ source: 'start', target: 'code' }],
    nodes: { start, other, code: { ...task, inputs: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId, output: 'payload' }] } } } },
  })
  expect((await prepareFlow(content, currentEngineContract, 'start')).kind).toBe('flow-invalid')
})

it('checks reachable subflows and includes only their required bindings and modules', async () => {
  const source = revision({ edges: [{ source: 'start', target: 'child' }], nodes: { start, child: { kind: 'subflow', subflowId: 'child', inputs: {} } } })
  const content: RevisionContent = {
    ...source,
    document: {
      ...source.document,
      bindings: { used: { kind: 'variable', target: 'TOKEN' }, unused: { kind: 'variable', target: 'bad-name' } },
      subflows: {
        child: {
          name: 'Child',
          inputs: [],
          outputs: [],
          graph: {
            edges: [],
            nodes: {
              code: { ...task, inputs: { value: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'used' }] } } },
            },
          },
        },
      },
    },
  }
  const prepared = await prepareFlow(content, currentEngineContract, 'start')
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  expect([...prepared.validation.closure.dependencies.inputBindings]).toEqual(['used'])
  expect(Object.keys(prepared.flow.modules)).toEqual(['main'])
  expect(Object.keys(prepared.flow.subflows)).toEqual(['child'])
  expect((await prepareFlow({ ...content, modules: {} }, currentEngineContract, 'start')).kind).toBe('flow-invalid')
})

it.each(['missing', 'code'])('rejects selecting %s as the trigger', async (nodeId) => {
  const content = revision({ edges: [{ source: 'start', target: 'code' }], nodes: { start, code: task } })
  expect((await prepareFlow(content, currentEngineContract, nodeId)).kind).toBe('flow-invalid')
})
