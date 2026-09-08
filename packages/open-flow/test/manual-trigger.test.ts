import type { RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges } from '../src/flow/common/change.ts'
import { encodeRevision } from '../src/flow/common/encoding.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'

it('requires an entry and skips unrelated roots and other trigger branches', async () => {
  const content: RevisionContent = {
    modelVersion: 1,
    modules: {},
    document: {
      bindings: {},
      subflows: {},
      tasks: {},
      graph: {
        edges: [
          { source: 'manual', target: 'selected' },
          { source: 'other', target: 'unselected' },
        ],
        nodes: {
          manual: { kind: 'manual', name: 'Start' },
          other: { kind: 'cron', name: 'Other', cronTimes: [] },
          selected: { kind: 'value', inputs: {}, values: [] },
          unselected: { kind: 'value', inputs: {}, values: [] },
          orphan: { kind: 'value', inputs: {}, values: [] },
        },
      },
    },
  }
  expect(new TextDecoder().decode(encodeRevision(content))).toContain('"kind":"manual"')
  const prepared = await prepareFlow(content, currentEngineContract)
  expect(prepared.kind).toBe('prepared')
  if (prepared.kind != 'prepared') throw new Error('Expected prepared Flow.')
  const started: string[] = []
  const options = {
    createId: () => crypto.randomUUID(),
    flowId: 'flow',
    runId: 'run',
    invokeTask: () => Effect.succeed({}),
  }
  // @ts-expect-error A new Run requires a Trigger seed.
  await expect(Effect.runPromise(runFlow(prepared.flow, options))).rejects.toThrow('requires a Trigger')
  await Effect.runPromise(
    runFlow(prepared.flow, {
      ...options,
      trigger: { nodeId: 'manual', payload: {} },
      emit: (event) =>
        Effect.sync(() => {
          if (event.type == 'node.started') started.push(event.nodeId)
        }),
    }),
  )
  expect(started).toEqual(['selected'])
  await expect(Effect.runPromise(runFlow(prepared.flow, { ...options, trigger: { nodeId: 'orphan', payload: {} } }))).rejects.toThrow('not a TriggerNode')
})

it('rejects adding a second manual trigger and allows replacing the existing one', () => {
  const content: RevisionContent = {
    modelVersion: 1,
    modules: {},
    document: { bindings: {}, subflows: {}, tasks: {}, graph: { edges: [], nodes: { start: { kind: 'manual', name: 'Start' } } } },
  }
  const create = { kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'other', node: { kind: 'manual', name: 'Other' } } as const
  expect(() => applyFlowChanges(content, [create])).toThrow('only one manual Trigger')
  const replaced = applyFlowChanges(content, [{ kind: 'graph.node.delete', target: { kind: 'flow' }, nodeId: 'start' }, create])
  expect(Object.keys(replaced.document.graph.nodes)).toEqual(['other'])
  expect(Object.keys(content.document.graph.nodes)).toEqual(['start'])
})

it('rejects imported graphs with multiple manual triggers during preparation', async () => {
  const content: RevisionContent = {
    modelVersion: 1,
    modules: {},
    document: {
      bindings: {},
      subflows: {},
      tasks: {},
      graph: {
        edges: [],
        nodes: {
          first: { kind: 'manual', name: 'First' },
          second: { kind: 'manual', name: 'Second' },
        },
      },
    },
  }
  const result = await prepareFlow(content, currentEngineContract)
  expect(result.kind).toBe('flow-invalid')
  if (result.kind != 'flow-invalid') throw new Error('Expected invalid Flow.')
  expect(result.validation.diagnostics.filter((item) => item.code == 'graph.manual-trigger-duplicate')).toHaveLength(2)
})
