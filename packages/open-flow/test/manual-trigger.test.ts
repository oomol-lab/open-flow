import type { RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { currentEngineContract } from '../src/execution/common/runtime.ts'
import { runFlow } from '../src/execution/common/scheduler.ts'
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
          other: { kind: 'manual', name: 'Other' },
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
