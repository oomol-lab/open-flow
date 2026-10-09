import type { RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { applyFlowChanges, currentFlowModelVersion, decodeChangeOperations } from '../src/flow/common/change.ts'
import { decodeRevisionContent } from '../src/flow/common/changeSchema.ts'
import { decodeRevision, encodeRevision, digestBytes } from '../src/flow/common/encoding.ts'
import { inverseFlowChanges } from '../src/flow/common/inverseChanges.ts'
import { prepareFlow, flowClosure, matchesTriggerOutputs } from '../src/flow/common/semantics.ts'
import { sampleErrorOutputs } from '../src/trigger/common/contract.ts'

const content: RevisionContent = {
  modelVersion: currentFlowModelVersion,
  modules: {},
  document: { bindings: {}, graph: { edges: [], nodes: { error: { kind: 'error', name: 'Flow Error' } } } },
}

describe('Flow Error contract', () => {
  it('round trips configuration, changes Revision and closure identity, and supports inverse changes', async () => {
    const operations = decodeChangeOperations([{ kind: 'graph.trigger.sources.set', nodeId: 'error', value: ['source', 'other'] }])
    const configured = applyFlowChanges(content, operations)
    expect(decodeRevision(encodeRevision(configured))).toEqual(configured)
    expect(await digestBytes(encodeRevision(configured))).not.toBe(await digestBytes(encodeRevision(content)))
    expect((await flowClosure(configured)).digest).not.toBe((await flowClosure(content)).digest)
    expect(applyFlowChanges(configured, inverseFlowChanges(content, operations))).toEqual(content)
    expect(() => applyFlowChanges(configured, operations)).toThrow('changed')
  })

  it('requires a new model version without changing old Revision bytes', () => {
    const previous: RevisionContent = {
      ...content,
      modelVersion: 4,
      document: { ...content.document, graph: { edges: [], nodes: { start: { kind: 'manual', name: 'Start' } } } },
    }
    expect(encodeRevision(decodeRevision(encodeRevision(previous)))).toEqual(encodeRevision(previous))
    expect(() => decodeRevisionContent({ ...content, modelVersion: 4 })).toThrow('version 5')
  })

  it('rejects duplicate Flow Error nodes', () => {
    expect(() =>
      applyFlowChanges(content, [{ kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'another', node: { kind: 'error', name: 'Another' } }]),
    ).toThrow('only one')
  })

  it('rejects duplicate or empty upstream IDs at the input boundary', () => {
    for (const value of [['source', 'source'], ['']])
      expect(() => decodeChangeOperations([{ kind: 'graph.trigger.sources.set', nodeId: 'error', value }])).toThrow()
    expect(() => decodeChangeOperations([{ kind: 'flow.error-workflow.set', value: 'handler' }])).toThrow()
  })

  it('validates the complete error context', () => {
    const trigger = content.document.graph.nodes.error!
    if ('inputs' in trigger) throw new Error('Expected a Trigger')
    expect(matchesTriggerOutputs(trigger, sampleErrorOutputs)).toBe(true)
    expect(matchesTriggerOutputs(trigger, { ...sampleErrorOutputs, error: { message: 'Missing code' } })).toBe(false)
    expect(matchesTriggerOutputs(trigger, { ...sampleErrorOutputs, execution: { ...(sampleErrorOutputs.execution as object), status: 'completed' } })).toBe(
      false,
    )
  })

  it('starts only the selected source branch with supplied error outputs', async () => {
    const revision: RevisionContent = {
      ...content,
      document: {
        ...content.document,
        graph: {
          nodes: {
            error: { kind: 'error', name: 'Flow Error' },
            manual: { kind: 'manual', name: 'Manual' },
            handled: {
              kind: 'value',
              name: 'Handled',
              inputs: {},
              values: [{ handle: 'value', value: 'handled', nullable: false, jsonSchema: { type: 'string' } }],
            },
            normal: {
              kind: 'value',
              name: 'Normal',
              inputs: {},
              values: [{ handle: 'value', value: 'normal', nullable: false, jsonSchema: { type: 'string' } }],
            },
          },
          edges: [
            { source: 'error', target: 'handled' },
            { source: 'manual', target: 'normal' },
          ],
        },
      },
    }
    const prepared = await prepareFlow(revision, 'open-flow-engine/v5')
    if (prepared.kind != 'prepared') throw new Error(prepared.kind)
    const started: string[] = []
    await Effect.runPromise(
      runFlow(prepared.flow, {
        createId: () => crypto.randomUUID(),
        invokeTask: () => Effect.succeed({}),
        flowId: 'flow',
        runId: 'run',
        trigger: { nodeId: 'error', outputs: sampleErrorOutputs },
        emit: (event) =>
          Effect.sync(() => {
            if (event.type == 'node.started') started.push(event.nodeId)
          }),
      }),
    )
    expect(started).toEqual(['handled'])
  })
})
