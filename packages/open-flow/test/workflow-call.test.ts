import type { AuthoringHost } from '../src/control/common/authoring.ts'
import type { SchedulerEvent } from '../src/execution/common/scheduler.ts'
import type { RevisionContent } from '../src/flow/common/change.ts'
import type { WorkflowContract } from '../src/workflow/common/workflow.ts'

import * as Effect from 'effect/Effect'
import { expect, it, vi } from 'vitest'
import { compileAuthoring, authoringNode } from '../src/control/common/authoring.ts'
import { decodeFlowRunCheckpoint, runFlow } from '../src/execution/common/scheduler.ts'
import { currentFlowModelVersion } from '../src/flow/common/change.ts'
import { prepareFlow } from '../src/flow/common/semantics.ts'
import { currentEngineContract } from '../src/runtime/common/engineContract.ts'
import {
  sameWorkflowInterface,
  publishedWorkflowInterface,
  workflowCompatibility,
  workflowSelectionTask,
  workflowCandidate,
  workflowCandidateGroup,
  workflowTask,
} from '../src/workflow/common/workflow.ts'
const port = { handle: 'answer', jsonSchema: { type: 'number' }, nullable: false } as const
const contract: WorkflowContract = {
  version: 1,
  flowId: 'target',
  name: 'Target',
  revisionId: 'r1',
  publicationId: 'p1',
  inputs: [port],
  outputs: [port],
}
const empty: RevisionContent = { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } }
const workflow = vi.fn(async () => contract)
const host: AuthoringHost = {
  id: (name) => name,
  workflow,
  action: async () => {
    throw new Error('Unused')
  },
  openapi: async () => ({}),
  trigger: () => {
    throw new Error('Unused')
  },
}
async function create() {
  return compileAuthoring(
    empty,
    {
      baseRevision: 'base',
      requestId: 'create',
      edits: [
        { op: 'node.add', as: 'start', name: 'Start', type: 'start' },
        { op: 'node.add', as: 'call', name: 'Target', type: 'workflow', config: { flowId: 'target' }, inputs: { answer: { kind: 'value', value: 42 } } },
        { op: 'edge.connect', source: '$start', target: '$call' },
      ],
    },
    host,
  )
}
it('preserves the saved contract during local edits and explicitly refreshes without guessing renames', async () => {
  const created = await create()
  workflow.mockClear()
  const ref = created.nodes.call!
  const local = await compileAuthoring(
    created.content,
    { baseRevision: 'base', requestId: 'rename', edits: [{ op: 'node.update', node: ref, set: { name: 'Renamed' } }] },
    host,
  )
  expect(workflow).not.toHaveBeenCalled()
  expect(authoringNode(local.content, ref).config).toEqual({ flowId: 'target' })
  const refreshed = await compileAuthoring(
    local.content,
    { baseRevision: 'base', requestId: 'refresh', edits: [{ op: 'node.refresh', node: ref }] },
    {
      ...host,
      workflow: async () => ({ ...contract, revisionId: 'r2', inputs: [{ ...port, handle: 'replacement' }], outputs: [] }),
    },
  )
  expect(refreshed.content.document.graph.nodes[ref]).toMatchObject({ inputs: {}, task: { executor: { revisionId: 'r2' }, outputs: [] } })
})
it('checkpoints a child call immediately and resumes its execution identity with ordinary output validation', async () => {
  const created = await create()
  const prepared = await prepareFlow(created.content, currentEngineContract, created.nodes.start)
  if (prepared.kind != 'prepared') throw new Error('Invalid fixture')
  const events: SchedulerEvent[] = []
  const options = {
    flowId: 'parent',
    runId: 'parent-run',
    createId: () => crypto.randomUUID(),
    emit: (event: SchedulerEvent) =>
      Effect.sync(() => {
        events.push(event)
      }),
  }
  const pending = await Effect.runPromise(
    runFlow(prepared.flow, {
      ...options,
      trigger: { nodeId: created.nodes.start!, outputs: {} },
      invokeTask: () => Effect.succeed({ kind: 'calling', childRunId: 'child' }),
    }),
  )
  expect(pending.kind).toBe('waiting')
  if (pending.kind != 'waiting') throw new Error('Expected pending call')
  expect(pending.checkpoint.waits).toEqual([])
  const checkpoint = decodeFlowRunCheckpoint(JSON.parse(JSON.stringify(pending.checkpoint)))
  const result = await Effect.runPromise(
    runFlow(prepared.flow, {
      ...options,
      resume: { checkpoint },
      invokeTask: (call) => {
        expect(call.workflowRunId).toBe('child')
        expect(call.jobId).toBe(checkpoint.calls![0]!.jobId)
        return Effect.succeed({ kind: 'completed', outputs: { answer: 42, extra: 'ignored' } })
      },
    }),
  )
  expect(result).toMatchObject({ nodes: [{ outputs: { answer: 42 } }] })
  expect(events.filter((event) => event.type == 'node.started')).toHaveLength(1)
})
it('accepts additive interfaces and catches breaking output contracts', async () => {
  const created = await create()
  const node = created.content.document.graph.nodes[created.nodes.call!]!
  if (node.kind != 'task') throw new Error('Expected task')
  expect(
    workflowCompatibility(node, {
      ...contract,
      inputs: [...contract.inputs, { ...port, handle: 'optional', nullable: true }],
      outputs: [...(contract.outputs ?? []), { ...port, handle: 'extra' }],
    }),
  ).toEqual([])
  expect(workflowCompatibility(node, { ...contract, outputs: [] })).toMatchObject([{ field: 'answer' }])
})

it.each([true, false])('handles absent child business outputs like Code returning an empty object (nullable=%s)', async (nullable) => {
  const created = await create()
  const ref = created.nodes.call!
  const original = created.content.document.graph.nodes[ref]!
  if (original.kind != 'task') throw new Error('Expected task')
  const content: RevisionContent = {
    ...created.content,
    document: {
      ...created.content.document,
      graph: {
        ...created.content.document.graph,
        nodes: { ...created.content.document.graph.nodes, [ref]: { ...original, task: { ...original.task, outputs: [{ ...port, nullable }] } } },
      },
    },
  }
  const prepared = await prepareFlow(content, currentEngineContract, created.nodes.start)
  if (prepared.kind != 'prepared') throw new Error('Invalid fixture')
  const promise = Effect.runPromise(
    runFlow(prepared.flow, {
      flowId: 'parent',
      runId: 'parent-run',
      createId: () => crypto.randomUUID(),
      trigger: { nodeId: created.nodes.start!, outputs: {} },
      invokeTask: () => Effect.succeed({ kind: 'completed', outputs: {} }),
    }),
  )
  if (nullable) expect(await promise).toMatchObject({ nodes: [{ outputs: { answer: null } }] })
  else await expect(promise).rejects.toThrow('does not match its declaration')
})

it('checks nullable independently of an unrestricted target input schema', async () => {
  const created = await create()
  const node = created.content.document.graph.nodes[created.nodes.call!]!
  if (node.kind != 'task') throw new Error('Expected task')
  const input = contract.inputs[0]!
  const withNull = { ...node, inputs: { [input.handle]: { kind: 'value' as const, value: null } } }
  const target = { ...contract, inputs: [{ ...input, jsonSchema: {}, nullable: false }] }
  expect(workflowCompatibility(withNull, target)).toMatchObject([{ side: 'input', field: input.handle }])
  expect(workflowCompatibility(withNull, { ...target, inputs: [{ ...target.inputs[0]!, nullable: true }] })).toEqual([])
})

it('compares changed revisions using their published interfaces and diagnoses missing snapshots', async () => {
  const created = await create()
  const node = created.content.document.graph.nodes[created.nodes.call!]!
  if (node.kind != 'task') throw new Error('Expected task')
  expect(workflowCompatibility(node, contract)).toEqual([])
  expect(workflowCompatibility(node, { ...contract, revisionId: 'r2' }, contract)).toEqual([])
  expect(workflowCompatibility(node, { ...contract, revisionId: 'r2' })).toMatchObject([{ reason: 'snapshot-missing' }])
  expect(workflowCompatibility(node, { ...contract, revisionId: 'r2', outputs: [] }, contract)).toMatchObject([{ reason: 'revision-stale' }])
})

it('keeps unavailable target selections and preserves an existing snapshot when rechecking', async () => {
  const candidate = workflowCandidate({ flowId: 'draft', name: 'Draft target', status: 'active', live: null })
  const created = await compileAuthoring(
    empty,
    {
      baseRevision: 'base',
      requestId: 'select-draft',
      edits: [{ op: 'node.add', as: 'call', name: 'Draft target', type: 'workflow', config: { flowId: 'draft' } }],
    },
    { ...host, workflow: async () => candidate },
  )
  const node = created.content.document.graph.nodes[created.nodes.call!]!
  expect(node).toMatchObject({ task: { name: 'Draft target', executor: { kind: 'workflow', flowId: 'draft', revisionId: '' }, inputs: [], outputs: [] } })
  const saved = workflowTask({ ...contract, flowId: 'draft' })
  expect(workflowSelectionTask(candidate, undefined, saved)).toBe(saved)
  expect(workflowSelectionTask(candidate, { ...contract, flowId: 'draft', revisionId: 'r2' }, saved)).toMatchObject({
    executor: { flowId: 'draft', revisionId: 'r2' },
  })
})

it('classifies targets using only publication metadata', () => {
  const flow = { flowId: 'target', name: 'Target', status: 'active', live: { hasStart: true, enabled: true } }
  expect(workflowCandidate(flow).problem).toBeNull()
  expect(workflowCandidate({ ...flow, live: null }).problem).toBe('unpublished')
  expect(workflowCandidate({ ...flow, live: { hasStart: true, enabled: false } }).problem).toBe('disabled')
  expect(workflowCandidate({ ...flow, status: 'retiring' }).problem).toBe('retiring')
  expect(workflowCandidate(flow, 'target').problem).toBe('recursive')
})

it('separates callable, published without Start, and unavailable targets', () => {
  const flow = { flowId: 'target', name: 'Target', status: 'active', live: { hasStart: true, enabled: true } }
  expect(workflowCandidateGroup(workflowCandidate(flow))).toBe('published')
  expect(workflowCandidateGroup(workflowCandidate({ ...flow, live: { hasStart: false, enabled: true } }))).toBe('missingStart')
  for (const candidate of [
    workflowCandidate({ ...flow, live: null }),
    workflowCandidate({ ...flow, live: { hasStart: false, enabled: false } }),
    workflowCandidate({ ...flow, status: 'retiring' }),
  ])
    expect(workflowCandidateGroup(candidate)).toBe('other')
})

it('compares named interface fields independently of ordering and descriptions while retaining null', () => {
  const first = { inputs: [port, { ...port, handle: 'other', jsonSchema: { type: 'object', properties: { x: { type: 'number' } } } }], outputs: null }
  const reordered = {
    inputs: [
      { ...first.inputs[1]!, jsonSchema: { properties: { x: { type: 'number' } }, type: 'object' } },
      { ...port, description: 'New text' },
    ],
    outputs: null,
  }
  expect(sameWorkflowInterface(first, reordered)).toBe(true)
  expect(sameWorkflowInterface(first, { ...first, outputs: [] })).toBe(false)
  expect(sameWorkflowInterface(first, { ...first, inputs: [{ ...port, nullable: true }, first.inputs[1]!] })).toBe(false)
  expect(sameWorkflowInterface(first, { ...first, inputs: [...first.inputs, { ...port, handle: 'extra' }] })).toBe(false)
})

it('extracts absent, empty and declared interfaces from the owning nodes', () => {
  expect(publishedWorkflowInterface(empty)).toEqual({ inputs: null, outputs: null })
  const content = {
    ...empty,
    document: {
      ...empty.document,
      graph: {
        nodes: {
          start: { kind: 'start' as const, name: 'Start', inputDefs: [port] },
          outputs: { kind: 'outputs' as const, name: 'Outputs', outputDefs: [], outputMappings: {} },
        },
        edges: [],
      },
    },
  }
  expect(publishedWorkflowInterface(content)).toEqual({ inputs: [port], outputs: [] })
})
