import type { RevisionContent } from '../src/flow/common/change.ts'

import * as Effect from 'effect/Effect'
import { expect, it } from 'vitest'
import { decodeFlowRunCheckpoint, runFlow } from '../src/execution/common/scheduler.ts'
import { currentFlowModelVersion } from '../src/flow/common/change.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'
import { currentEngineContract } from '../src/runtime/common/runtime.ts'
import { waitHost } from './waitHost.ts'

it('checkpoints a long result chain in linear space and resumes without replaying its tasks', async () => {
  const port = { handle: 'value', jsonSchema: { type: 'string' }, nullable: false }
  const source: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: { main: { name: 'Main', imports: [], source: 'export default () => ({ value: "" })' } },
    document: {
      bindings: {},
      graph: {
        nodes: {
          start: { kind: 'start', inputDefs: [], name: 'Start' },
          ...Object.fromEntries(
            Array.from({ length: 100 }, (_, index) => [
              `n${index}`,
              {
                kind: 'task' as const,
                inputs: {},
                task: { name: `Node ${index}`, moduleId: 'main', inputs: [], outputs: [port] },
              },
            ]),
          ),
          wait: { kind: 'wait', name: 'Wait', inputs: {}, inputDefinitions: [], prompt: 'Continue' },
          outputs: {
            kind: 'outputs',
            name: 'Outputs',
            outputDefs: [port],
            outputMappings: { value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'n0', output: 'value' }] } },
          },
        },
        edges: [
          ...Array.from({ length: 100 }, (_, index) => ({ source: index == 0 ? 'start' : `n${index - 1}`, target: `n${index}` })),
          { source: 'n99', target: 'wait' },
          { source: 'wait', sourceHandle: 'continue', target: 'outputs' },
        ],
      },
    },
  }
  const prepared = await prepareFlow(source, currentEngineContract)
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  let nextId = 0
  const calls: string[] = []
  const options = {
    flowId: 'flow',
    runId: 'run',
    createId: () => String(++nextId),
    invokeTask: (call: { nodeId: string }) =>
      Effect.sync(() => {
        calls.push(call.nodeId)
        return { value: 'x'.repeat(4096) }
      }),
  }
  const first = await Effect.runPromise(runFlow(prepared.flow, { ...options, trigger: { nodeId: 'start', outputs: {} }, waits: waitHost() }))
  if (first.kind != 'waiting') throw new Error('Expected waiting')
  const encoded = JSON.stringify(first.checkpoint)
  expect(new TextEncoder().encode(encoded).byteLength).toBeLessThan(1024 * 1024)
  expect(first.checkpoint.dependencies.frames.length).toBeLessThan(210)
  expect(calls).toHaveLength(100)
  const dependencies = first.checkpoint.dependencies
  for (const [name, changed] of [
    ['cyclic frame', { ...dependencies, frames: dependencies.frames.map((frame, index) => (index == 0 ? { ...frame, parent: 0 } : frame)) }],
    ['missing result', { ...dependencies, frames: [{ input: { start: dependencies.results.length } }] }],
    ['wrong result owner', { ...dependencies, frames: [{ input: { wrong: 0 } }] }],
    ['missing frame', { ...dependencies, nodes: { ...dependencies.nodes, wait: { ...dependencies.nodes.wait!, input: dependencies.frames.length } } }],
  ] as const)
    expect(() => decodeFlowRunCheckpoint({ ...first.checkpoint, dependencies: changed }), name).toThrow(/Checkpoint/)
  const result = await Effect.runPromise(
    runFlow(prepared.flow, {
      ...options,
      resume: { checkpoint: JSON.parse(encoded) },
      waits: waitHost({ [first.checkpoint.waits[0]!.waitId]: 'continue' }),
    }),
  )
  expect(result).toMatchObject({ kind: 'node-results', outputs: { value: 'x'.repeat(4096) } })
  expect(calls).toHaveLength(100)
})

it('resumes a published v6 checkpoint through the current Scheduler', async () => {
  const source: RevisionContent = {
    modelVersion: currentFlowModelVersion,
    modules: {},
    document: {
      bindings: {},
      graph: {
        nodes: {
          start: { kind: 'start', inputDefs: [], name: 'Start' },
          wait: { kind: 'wait', name: 'Wait', inputs: {}, inputDefinitions: [], prompt: 'Continue' },
        },
        edges: [{ source: 'start', target: 'wait' }],
      },
    },
  }
  const prepared = await prepareFlow(source, currentEngineContract)
  if (prepared.kind != 'prepared') throw new Error(JSON.stringify(prepared))
  const checkpoint = {
    version: 6,
    agents: {},
    bindingValues: {},
    inputs: {},
    counts: { '': { wait: 1 } },
    results: { start: { jobId: 'start', outputs: {} } },
    dependencies: {
      nextId: 2,
      iterations: {},
      nodes: {
        start: { id: 0, status: 'completed', input: {}, output: {}, previous: [], released: [], seeded: false },
        wait: { id: 1, status: 'running', input: { start: { execution: 0, outputs: {} } }, previous: ['start'], released: [], seeded: false, jobId: 'job' },
      },
    },
    waits: [{ jobId: 'job', nodeId: 'wait', waitId: 'wait', value: {} }],
  }
  const result = await Effect.runPromise(
    runFlow(prepared.flow, {
      flowId: 'flow',
      runId: 'run',
      createId: () => 'unexpected',
      resume: { checkpoint },
      waits: waitHost({ wait: 'continue' }),
      invokeTask: () => Effect.die('Unexpected task'),
    }),
  )
  expect(result).toMatchObject({ kind: 'node-results', nodes: [{ nodeId: 'wait', jobId: 'job' }] })
})
