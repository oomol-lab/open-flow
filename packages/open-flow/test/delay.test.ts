import type { FlowRunOptions, SchedulerEvent, WaitRequest } from '../src/execution/common/scheduler.ts'
import type { DelayNode, RevisionContent, WaitAction } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { expect, expectTypeOf, it } from 'vitest'
import { runFlow } from '../src/execution/common/scheduler.ts'
import { currentFlowModelVersion } from '../src/flow/common/change.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'
import { currentEngineContract } from '../src/runtime/common/runtime.ts'
import { waitHost } from './waitHost.ts'

it('types Delay as a timer-only node without inputs or Task policies', () => {
  expectTypeOf<DelayNode['inputs']>().toEqualTypeOf<Readonly<Record<string, never>>>()
  expectTypeOf<DelayNode['timeoutMs']>().toEqualTypeOf<undefined>()
  expectTypeOf<DelayNode['retry']>().toEqualTypeOf<undefined>()
  expectTypeOf<DelayNode['onError']>().toEqualTypeOf<undefined>()
})

async function fixture(loop = false) {
  const content: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        nodes: {
          start: { kind: 'start', name: 'Start', inputDefs: [] },
          delay: { kind: 'delay', inputs: {}, durationMs: 5000 },
          side: { kind: 'task', inputs: {}, task: { name: 'Side', inputs: [], outputs: [], executor: { kind: 'connector', action: 'test.side' } } },
          out: { kind: 'outputs', outputDefs: [], outputMappings: {} },
          ...(loop
            ? {
                check: {
                  kind: 'task' as const,
                  inputs: {},
                  task: {
                    name: 'Check',
                    inputs: [],
                    outputs: [{ handle: 'again', jsonSchema: { type: 'boolean' }, nullable: false }],
                    executor: { kind: 'connector' as const, action: 'test.check' },
                  },
                },
                branch: {
                  kind: 'condition' as const,
                  inputs: {},
                  matchMode: 'first' as const,
                  cases: [
                    {
                      output: 'again',
                      groups: [
                        {
                          expressions: [
                            {
                              left: { kind: 'source' as const, source: { kind: 'node' as const, nodeId: 'check', output: 'again' } },
                              operator: 'isTrue' as const,
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              }
            : {}),
        },
        edges: loop
          ? [
              { source: 'start', target: 'delay' },
              { source: 'delay', target: 'check' },
              { source: 'check', target: 'branch' },
              { source: 'branch', sourceHandle: 'again', target: 'delay' },
              { source: 'branch', sourceHandle: 'otherwise', target: 'out' },
            ]
          : [
              { source: 'start', target: 'delay' },
              { source: 'start', target: 'side' },
              { source: 'delay', target: 'out' },
              { source: 'side', target: 'out' },
            ],
      },
    },
  }
  const prepared = await prepareFlow(content, currentEngineContract)
  if (prepared.kind !== 'prepared') throw new Error(JSON.stringify(prepared))
  const requests: WaitRequest[] = []
  const events: SchedulerEvent[] = []
  const decisions: Record<string, WaitAction> = {}
  let ids = 0
  let checks = 0
  const options: Pick<FlowRunOptions, 'flowId' | 'runId' | 'createId' | 'remainingMs' | 'waits' | 'emit' | 'invokeTask'> = {
    flowId: 'flow',
    runId: 'run',
    createId: () => `job-${++ids}`,
    remainingMs: 10_000,
    waits: {
      ...waitHost(decisions),
      create: (wait) =>
        Effect.sync(() => {
          requests.push(wait)
          return undefined
        }),
    },
    emit: (event) =>
      Effect.sync(() => {
        events.push(event)
      }),
    invokeTask: (invocation) => Effect.sync(() => (invocation.nodeId === 'check' ? { again: ++checks < 2 } : {})),
  }
  return { prepared: prepared.flow, options, requests, events, decisions }
}

it('checkpoints a delayed branch, completes independent work and recovers without registering again', async () => {
  const f = await fixture()
  const first = await Effect.runPromise(runFlow(f.prepared, { ...f.options, trigger: { nodeId: 'start', outputs: {} } }))
  if (first.kind !== 'waiting') throw new Error('Expected delay suspension')
  expect(f.requests).toHaveLength(1)
  expect(f.requests[0]).toEqual({ kind: 'delay', durationMs: 5000, jobId: expect.any(String), nodeId: 'delay', waitId: expect.any(String) })
  expect(f.events.filter((event) => event.type === 'node.completed').map((event) => event.nodeId)).toEqual(['side'])
  expect(first.checkpoint.waits[0]).not.toHaveProperty('pending')
  const stillWaiting = await Effect.runPromise(runFlow(f.prepared, { ...f.options, resume: { checkpoint: JSON.parse(JSON.stringify(first.checkpoint)) } }))
  expect(stillWaiting.kind).toBe('waiting')
  expect(f.requests).toHaveLength(1)
  f.decisions[f.requests[0]!.waitId] = 'continue'
  const result = await Effect.runPromise(runFlow(f.prepared, { ...f.options, resume: { checkpoint: first.checkpoint } }))
  expect(result.kind).toBe('node-results')
  expect(f.events.filter((event) => event.type === 'node.completed' && event.nodeId === 'delay')).toEqual([expect.objectContaining({ outputs: {} })])
  expect(f.events.filter((event) => event.type === 'node.completed' && event.nodeId === 'side')).toHaveLength(1)
})

it('registers a distinct relative delay for each loop iteration', async () => {
  const f = await fixture(true)
  const first = await Effect.runPromise(runFlow(f.prepared, { ...f.options, trigger: { nodeId: 'start', outputs: {} } }))
  if (first.kind !== 'waiting') throw new Error('Expected first delay')
  f.decisions[f.requests[0]!.waitId] = 'continue'
  const second = await Effect.runPromise(runFlow(f.prepared, { ...f.options, resume: { checkpoint: first.checkpoint } }))
  if (second.kind !== 'waiting') throw new Error('Expected second delay')
  expect(f.requests).toHaveLength(2)
  expect(f.requests[1]!.waitId).not.toBe(f.requests[0]!.waitId)
  f.decisions[f.requests[1]!.waitId] = 'continue'
  const result = await Effect.runPromise(runFlow(f.prepared, { ...f.options, resume: { checkpoint: second.checkpoint } }))
  expect(result.kind).toBe('node-results')
  expect(f.requests).toHaveLength(2)
})
