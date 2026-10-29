import type { ChangeOperation, OutputsNode } from '@oomol-lab/open-flow/flow-change'
import type { ServerService } from '../node/application/service.ts'
import type { Store } from '../node/storage/store.ts'

import { digestBytes, encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { workflowTask } from '@oomol-lab/open-flow/workflow'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { workflowAuthoringTarget, workflowCallCompatibility } from '../node/application/workflow.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const engine = currentEngineContract
const number = { handle: 'answer', jsonSchema: { type: 'number' }, nullable: false } as const
async function create(service: ServerService, name: string, operations: readonly ChangeOperation[]) {
  const created = await service.control.flows.createFlow('operator', name, name)
  const flowId = created.flow.flowId
  const changed = await service.control.drafts.changeDraft('operator', flowId, created.flow.draftRevisionId, operations)
  return { flowId, revisionId: changed.revision.revisionId }
}
async function target(service: ServerService, wait = false) {
  await startService(service)
  const flow = await create(service, 'Target', [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start', inputDefs: [number] } },

    {
      kind: 'graph.node.create',
      nodeId: 'outputs',
      node: {
        kind: 'outputs',
        name: 'Outputs',
        outputDefs: [number],
        outputMappings: { answer: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'start', output: 'answer' }] } },
      },
    },
    ...(wait
      ? [
          {
            kind: 'graph.node.create' as const,
            nodeId: 'wait',
            node: { kind: 'wait' as const, name: 'Wait', inputs: {}, inputDefinitions: [], prompt: 'Continue' },
          },
          { kind: 'graph.edge.connect' as const, edge: { source: 'start', target: 'wait' } },
          { kind: 'graph.edge.connect' as const, edge: { source: 'wait', sourceHandle: 'continue', target: 'outputs' } },
        ]
      : [{ kind: 'graph.edge.connect' as const, edge: { source: 'start', target: 'outputs' } }]),
  ])
  const published = await service.control.publications.publishFlow('operator', flow.flowId, flow.revisionId, engine, null, 'publish')
  await expect.poll(() => service.control.publications.getPublishOperation('operator', flow.flowId, published.operationId).status).toBe('succeeded')
  return flow
}
function outputChange(service: ServerService, flow: { flowId: string; revisionId: string }, patch: Partial<OutputsNode>): ChangeOperation {
  const node = service.control.drafts.getRevision('operator', flow.flowId, flow.revisionId).content.document.graph.nodes.outputs
  if (node?.kind != 'outputs') throw new Error('Expected Outputs fixture')
  return { kind: 'graph.node.replace', nodeId: 'outputs', before: node, node: { ...node, ...patch } }
}
async function caller(service: ServerService, flowId: string, timeoutMs?: number, name = 'Caller') {
  const contract = service.control.flows.getWorkflowContract('operator', flowId)
  return create(service, name, [
    { kind: 'graph.node.create', nodeId: 'start', node: { inputDefs: [], kind: 'start', name: 'Start' } },
    {
      kind: 'graph.node.create',
      nodeId: 'call',
      node: {
        kind: 'task',
        name: 'Target',
        ...(timeoutMs == null ? {} : { timeoutMs }),
        inputs: { answer: { kind: 'value', value: 42 } },
        task: workflowTask(contract),
      },
    },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'call' } },
  ])
}

it('calls current Live with one execution slot, preserves separate events and durable origin', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const refs = service.control.flows.getFlowReferences('operator', child.flowId, 'incoming', 0, 50)
  expect(refs.references).toMatchObject([{ flowId: parent.flowId, draft: true, live: null }])
  const accepted = await service.control.runs.createDraftRun(
    'operator',
    parent.flowId,
    parent.revisionId,
    engine,
    {},
    'call',
    { nodeId: 'start', outputs: {} },
    'cli',
  )
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  const run = service.control.runs.getRun('operator', accepted.run.runId)
  expect(run.triggerNodeId).toBe('start')
  expect(run.calls).toHaveLength(1)
  expect(service.control.runs.getRunEvents('operator', run.runId, 0, 100).events.find((event) => event.kind == 'node.started')?.payload.executionId).toBe(
    run.calls![0]!.executionId,
  )
  const call = run.calls![0]!
  expect(service.control.runs.getRun('operator', call.runId)).toMatchObject({
    source: 'live',
    initiator: { actorId: 'operator', channel: 'workflow' },
    triggerNodeId: 'start',
    caller: { runId: run.runId, flowId: parent.flowId, nodeId: 'call', executionId: call.executionId },
  })
  expect(service.run(run.runId)?.result).toMatchObject({ nodes: [{ nodeId: 'call', outputs: { answer: 42 } }] })
  expect(service.events(run.runId).some((event) => event.payload.nodeId == 'outputs')).toBe(false)
  expect(service.events(call.runId).some((event) => event.payload.nodeId == 'outputs')).toBe(true)
  const store = (service.control.runs as unknown as { store: Store }).store
  store.runs.maintain(Date.now() + 31 * 24 * 60 * 60 * 1000, 100, 1000)
  expect(service.events(run.runId)).toEqual([])
  expect(service.control.runs.getRun('operator', run.runId).initiator).toEqual({ actorId: 'operator', channel: 'cli' })
  expect(service.control.runs.getRun('operator', call.runId).initiator).toEqual({ actorId: 'operator', channel: 'workflow' })
  expect(service.control.runs.getRun('operator', call.runId).caller?.executionId).toBe(call.executionId)
  expect(service.control.runs.getRun('operator', run.runId).calls).toHaveLength(1)
})

it('keeps the parent pending while a child waits for a human and resumes without another child', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await caller(service, child.flowId)
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revisionId, engine, {}, 'call', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).calls?.length).toBe(1)
  const call = service.control.runs.getRun('operator', accepted.run.runId).calls![0]!
  await expect.poll(() => service.control.runs.getRun('operator', call.runId).waits.length).toBe(1)
  expect(service.control.runs.getRun('operator', accepted.run.runId).status).toBe('waiting')
  const wait = service.control.runs.getRun('operator', call.runId).waits[0]!
  service.control.runs.resolveRunWait('operator', call.runId, wait.waitId, 'continue')
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  expect(service.control.runs.getRun('operator', accepted.run.runId).calls).toHaveLength(1)
})

it('cancels a waiting child with its caller and refuses other owners', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  expect(() => service.control.flows.getWorkflowContract('someone-else', child.flowId)).toThrow()
  const parent = await caller(service, child.flowId)
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revisionId, engine, {}, 'call', { nodeId: 'start', outputs: {} })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).calls?.length).toBe(1)
  const call = service.control.runs.getRun('operator', accepted.run.runId).calls![0]!
  service.control.runs.cancelRun('operator', accepted.run.runId)
  await expect.poll(() => service.control.runs.getRun('operator', call.runId).status).toBe('canceled')
})

it('enforces the call deadline while the child is waiting', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await caller(service, child.flowId, 800)
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revisionId, engine, {}, 'timeout', {
    nodeId: 'start',
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('failed')
  const run = service.control.runs.getRun('operator', accepted.run.runId)
  expect(run.calls).toHaveLength(1)
  expect(run.calls![0]!.status).toBe('canceled')
  expect(service.run(run.runId)?.result).toMatchObject({ error: { code: 'run.timeout' } })
})

it('resumes a persisted parent after restart without starting another child', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-call-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const store = (service.control.runs as unknown as { store: Store }).store
  const claim = store.runs.claim.bind(store.runs)
  const held = vi
    .spyOn(store.runs, 'claim')
    .mockImplementation((excluded) =>
      claim(store.runViews.listControlRuns(parent.flowId, 1)[0]?.startedAt != null ? [...(excluded ?? []), parent.flowId] : excluded),
    )
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revisionId, engine, {}, 'restart', {
    nodeId: 'start',
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).calls?.[0]?.status).toBe('completed')
  expect(service.control.runs.getRun('operator', accepted.run.runId).status).toBe('queued')
  const original = service.control.runs.getRun('operator', accepted.run.runId).calls![0]!
  await closeService(service)
  held.mockRestore()
  const reopened = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  await startService(reopened)
  await expect.poll(() => reopened.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  expect(reopened.control.runs.getRun('operator', accepted.run.runId).calls).toEqual([original])
  expect(reopened.events(accepted.run.runId).filter((event) => event.kind == 'node.started')).toHaveLength(1)
})

it('propagates an unconfirmed child after restart without replaying it', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-unknown-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await caller(service, child.flowId)
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revisionId, engine, {}, 'unknown', {
    nodeId: 'start',
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).calls?.length).toBe(1)
  const call = service.control.runs.getRun('operator', accepted.run.runId).calls![0]!
  await expect.poll(() => service.control.runs.getRun('operator', call.runId).waits.length).toBe(1)
  await closeService(service)
  const reopened = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  expect(reopened.control.runs.getRun('operator', accepted.run.runId).status).toBe('indeterminate')
  expect(reopened.control.runs.getRun('operator', call.runId).status).toBe('indeterminate')
  expect(reopened.control.runs.getRun('operator', accepted.run.runId).calls).toHaveLength(1)
})

it('accepts implementation changes without refreshing and requires refresh for interface changes', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const original = service.control.drafts.getRevision('operator', parent.flowId, parent.revisionId).content
  const updated = await service.control.drafts.changeDraft('operator', child.flowId, child.revisionId, [
    outputChange(service, child, { outputMappings: { answer: { kind: 'value', value: 7 } } }),
  ])
  const publish = async (revisionId: string, key: string) => {
    const op = await service.control.publications.publishFlow(
      'operator',
      child.flowId,
      revisionId,
      engine,
      service.control.flows.getFlow('operator', child.flowId).live!.publicationId,
      key,
    )
    await expect.poll(() => service.control.publications.getPublishOperation('operator', child.flowId, op.operationId).status).toBe('succeeded')
  }
  await publish(updated.revision.revisionId, 'compatible')
  expect((await service.control.drafts.checkFlow('operator', parent.flowId, parent.revisionId, engine)).valid).toBe(true)
  expect((await service.control.drafts.checkAuthoring('operator', parent.flowId, parent.revisionId)).valid).toBe(true)
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revisionId, engine, {}, 'latest', {
    nodeId: 'start',
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  expect(service.run(accepted.run.runId)?.result).toMatchObject({ nodes: [{ outputs: { answer: 7 } }] })
  expect(service.control.drafts.getRevision('operator', parent.flowId, parent.revisionId).content).toEqual(original)
  const broken = await service.control.drafts.changeDraft('operator', child.flowId, updated.revision.revisionId, [
    outputChange(
      service,
      { flowId: child.flowId, revisionId: updated.revision.revisionId },
      {
        outputDefs: [{ ...number, jsonSchema: { type: 'string' } }],
        outputMappings: { answer: { kind: 'value', value: 'changed' } },
      },
    ),
  ])
  await publish(broken.revision.revisionId, 'breaking')
  expect(await service.control.drafts.checkAuthoring('operator', parent.flowId, parent.revisionId)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.revision-stale', field: 'config.flowId' }],
  })
  await expect(
    service.control.runs.createDraftRun('operator', parent.flowId, parent.revisionId, engine, {}, 'stale', { nodeId: 'start', outputs: {} }),
  ).rejects.toThrow('interface has changed')
  const refreshed = await service.control.drafts.editAuthoring('operator', parent.flowId, {
    baseRevision: parent.revisionId,
    requestId: 'refresh',
    edits: [{ op: 'node.refresh', node: 'call' }],
  })
  expect(refreshed.validation.status).toBe('valid')
})

it('supports nested calls with one slot and merges Draft and Live definition references', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const middle = await caller(service, child.flowId)
  const exposed = await service.control.drafts.changeDraft('operator', middle.flowId, middle.revisionId, [
    {
      kind: 'graph.node.replace',
      nodeId: 'start',
      before: { kind: 'start', name: 'Start', inputDefs: [] },
      node: { kind: 'start', name: 'Start', inputDefs: [number] },
    },

    {
      kind: 'graph.node.create',
      nodeId: 'outputs',
      node: {
        kind: 'outputs',
        name: 'Outputs',
        outputDefs: [number],
        outputMappings: { answer: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'call', output: 'answer' }] } },
      },
    },
    { kind: 'graph.edge.connect', edge: { source: 'call', target: 'outputs' } },
  ])
  const publication = await service.control.publications.publishFlow('operator', middle.flowId, exposed.revision.revisionId, engine, null, 'middle')
  await expect.poll(() => service.control.publications.getPublishOperation('operator', middle.flowId, publication.operationId).status).toBe('succeeded')
  expect(service.control.flows.getFlowReferences('operator', child.flowId, 'incoming', 0, 50)).toMatchObject({
    total: 1,
    references: [{ flowId: middle.flowId, draft: true, live: { enabled: true } }],
  })
  const outer = await caller(service, middle.flowId, undefined, 'Outer')
  const accepted = await service.control.runs.createDraftRun('operator', outer.flowId, outer.revisionId, engine, {}, 'nested', {
    nodeId: 'start',
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  expect(service.run(accepted.run.runId)?.result).toMatchObject({ nodes: [{ outputs: { answer: 42 } }] })
  const middleRun = service.control.runs.getRun('operator', accepted.run.runId).calls![0]!.runId
  expect(service.control.runs.getRun('operator', middleRun).calls).toHaveLength(1)
})

it('rejects self-reference on save and still rejects legacy recursion during check and admission', async () => {
  const service = await openService(':memory:', { clock: Date.now })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const original = service.control.drafts.getRevision('operator', parent.flowId, parent.revisionId).content.document.graph.nodes.call!
  if (original.kind != 'task') throw new Error('Expected call')
  const task = { ...original.task, executor: { kind: 'workflow' as const, flowId: parent.flowId, revisionId: parent.revisionId } }
  await expect(
    service.control.drafts.changeDraft('operator', parent.flowId, parent.revisionId, [
      { kind: 'graph.node.task.set', nodeId: 'call', before: original.task, value: task },
    ]),
  ).rejects.toMatchObject({ code: 'flow.invalid', details: { reason: 'workflow.recursive' } })
  expect(service.control.flows.getFlow('operator', parent.flowId).draftRevisionId).toBe(parent.revisionId)

  // Simulate a Revision saved before write-time self-reference validation existed.
  const content = service.control.drafts.getRevision('operator', parent.flowId, parent.revisionId).content
  const legacy = {
    ...content,
    document: {
      ...content.document,
      graph: {
        ...content.document.graph,
        nodes: {
          ...content.document.graph.nodes,
          call: { ...original, task },
        },
      },
    },
  }
  const bytes = encodeRevision(legacy)
  const store = (service.control.runs as unknown as { store: Store }).store
  const recursive = store.flows.commitRevision({
    actorId: 'operator',
    flowId: parent.flowId,
    expectedRevisionId: parent.revisionId,
    changeId: 'legacy-recursive',
    requestDigest: 'legacy-recursive',
    content: new TextDecoder().decode(bytes),
    digest: await digestBytes(bytes),
    revisionId: 'legacy-recursive',
    modelVersion: content.modelVersion,
    createdAt: Date.now(),
  })
  if (recursive.kind != 'committed') throw new Error('Expected legacy fixture')
  expect(await service.control.drafts.checkFlow('operator', parent.flowId, recursive.revision.revisionId, engine)).toMatchObject({
    valid: false,
    diagnostics: [{ message: 'Recursive workflow calls are not supported.' }],
  })
  await expect(
    service.control.runs.createDraftRun('operator', parent.flowId, recursive.revision.revisionId, engine, {}, 'recursive', { nodeId: 'start', outputs: {} }),
  ).rejects.toThrow('Recursive')
})

it('rejects disconnected self-calls through public authoring without saving any part of the batch', async () => {
  const service = await openService(':memory:')
  const { flow } = await service.control.flows.createFlow('operator', 'Caller', 'self-call')
  await expect(
    service.control.drafts.editAuthoring('operator', flow.flowId, {
      baseRevision: flow.draftRevisionId,
      requestId: 'self-call',
      edits: [
        { op: 'node.add', as: 'start', type: 'start', name: 'Start' },
        { op: 'node.add', as: 'call', type: 'workflow', name: 'Self', config: { flowId: flow.flowId } },
      ],
    }),
  ).rejects.toMatchObject({ code: 'flow.invalid', details: { reason: 'workflow.recursive' } })
  expect(service.control.flows.getFlow('operator', flow.flowId).draftRevisionId).toBe(flow.draftRevisionId)
  expect(service.control.drafts.getRevision('operator', flow.flowId, flow.draftRevisionId).content.document.graph.nodes).toEqual({})
})

it('creates separate child runs and matching event identities for each loop invocation', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const loop = await service.control.drafts.changeDraft('operator', parent.flowId, parent.revisionId, [
    {
      kind: 'module.create',
      moduleId: 'counter',
      module: { name: 'Counter', imports: [], source: 'export default ({previous}) => ({answer: (previous ?? 0) + 1})' },
    },
    {
      kind: 'graph.node.create',
      nodeId: 'counter',
      node: {
        kind: 'task',
        name: 'Counter',
        inputs: { previous: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'counter', output: 'answer' }] } },
        task: { name: 'Counter', moduleId: 'counter', inputs: [{ ...number, handle: 'previous', nullable: true }], outputs: [number] },
      },
    },
    {
      kind: 'graph.node.create',
      nodeId: 'choose',
      node: {
        kind: 'condition',
        name: 'Again',
        inputs: {},
        matchMode: 'first',
        cases: [
          {
            output: 'again',
            groups: [
              {
                expressions: [
                  { left: { kind: 'source', source: { kind: 'node', nodeId: 'call', output: 'answer' } }, operator: '<', right: { kind: 'value', value: 3 } },
                ],
              },
            ],
          },
        ],
      },
    },
    {
      kind: 'graph.node.input.set',
      nodeId: 'call',
      handle: 'answer',
      before: { kind: 'value', value: 42 },
      value: { kind: 'sources', sources: [{ kind: 'node', nodeId: 'counter', output: 'answer' }] },
    },
    { kind: 'graph.edge.disconnect', edge: { source: 'start', target: 'call' } },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'counter' } },
    { kind: 'graph.edge.connect', edge: { source: 'counter', target: 'call' } },
    { kind: 'graph.edge.connect', edge: { source: 'call', target: 'choose' } },
    { kind: 'graph.edge.connect', edge: { source: 'choose', sourceHandle: 'again', target: 'counter' } },
  ])
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, loop.revision.revisionId, engine, {}, 'loop', {
    nodeId: 'start',
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  const calls = service.control.runs.getRun('operator', accepted.run.runId).calls!
  expect(new Set(calls.map((call) => call.runId)).size).toBe(3)
  const completions = service.control.runs
    .getRunEvents('operator', accepted.run.runId, 0, 100)
    .events.filter((event) => event.kind == 'node.completed')
    .filter((event) => event.payload.nodeId == 'call')
  expect(completions.map((event) => event.payload.outputs)).toEqual([{ answer: 1 }, { answer: 2 }, { answer: 3 }])
  expect(completions.map((event) => event.payload.executionId)).toEqual(calls.map((call) => call.executionId))
})

it('reports an unselected workflow separately without looking up an empty target', async () => {
  const service = await openService(':memory:')
  const parent = await create(service, 'Unconfigured', [
    { kind: 'graph.node.create', nodeId: 'start', node: { inputDefs: [], kind: 'start', name: 'Start' } },
    {
      kind: 'graph.node.create',
      nodeId: 'call',
      node: {
        kind: 'task',
        name: 'Call',
        inputs: {},
        task: { name: 'Call', inputs: [], outputs: [], executor: { kind: 'workflow', flowId: '', revisionId: '' } },
      },
    },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'call' } },
  ])
  const store = (service.control.runs as unknown as { store: Store }).store
  const lookup = vi.spyOn(store.flows, 'get')
  expect(await service.control.drafts.checkFlow('operator', parent.flowId, parent.revisionId, engine)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.target-required', message: 'Select a target workflow.', path: '/document/graph/nodes/call/task/executor/flowId' }],
  })
  expect(lookup).not.toHaveBeenCalledWith('')
  expect(await service.control.drafts.checkAuthoring('operator', parent.flowId, parent.revisionId)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.target-required', field: 'config.flowId' }],
  })
})

it('reports a missing Live Start from the published interface even when Draft has Start', async () => {
  const service = await openService(':memory:')
  await startService(service)
  const created = await service.control.flows.createFlow('operator', 'Empty Live', 'empty-live')
  const flowId = created.flow.flowId
  const published = await service.control.publications.publishFlow('operator', flowId, created.flow.draftRevisionId, engine, null, 'empty-live')
  await expect.poll(() => service.control.publications.getPublishOperation('operator', flowId, published.operationId).status).toBe('succeeded')
  const draft = await service.control.drafts.changeDraft('operator', flowId, created.flow.draftRevisionId, [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start', inputDefs: [] } },
  ])
  const store = (service.control.runs as unknown as { store: Store }).store
  const read = vi.spyOn(store.flows, 'revision')
  expect(service.control.flows.getFlow('operator', flowId).live).toMatchObject({ hasStart: false })
  expect(workflowAuthoringTarget(store, 'operator', flowId)).toMatchObject({ problem: 'missing-start' })
  expect(() => service.control.flows.getWorkflowContract('operator', flowId)).toThrow()
  expect(read).not.toHaveBeenCalled()
  read.mockRestore()
  const next = await service.control.publications.publishFlow(
    'operator',
    flowId,
    draft.revision.revisionId,
    engine,
    service.control.flows.getFlow('operator', flowId).live!.publicationId,
    'with-start',
  )
  await expect.poll(() => service.control.publications.getPublishOperation('operator', flowId, next.operationId).status).toBe('succeeded')
  expect(service.control.flows.getWorkflowContract('operator', flowId)).toMatchObject({ revisionId: draft.revision.revisionId, inputs: [], outputs: null })
})

it('saves an unpublished target through authoring and refreshes it after publication', async () => {
  const service = await openService(':memory:')
  await startService(service)
  const child = await service.control.flows.createFlow('operator', 'Draft target', 'draft-target')
  const parent = await service.control.flows.createFlow('operator', 'Caller', 'caller')
  const edited = await service.control.drafts.editAuthoring('operator', parent.flow.flowId, {
    baseRevision: parent.flow.draftRevisionId,
    requestId: 'select',
    edits: [{ op: 'node.add', as: 'call', name: 'Draft target', type: 'workflow', config: { flowId: child.flow.flowId } }],
  })
  expect(service.control.drafts.getRevision('operator', parent.flow.flowId, edited.revision).content.document.graph.nodes).toMatchObject({
    [edited.nodes.call!]: { task: { executor: { flowId: child.flow.flowId, revisionId: '' } } },
  })
  expect(await service.control.drafts.checkAuthoring('operator', parent.flow.flowId, edited.revision)).toMatchObject({
    valid: false,
    diagnostics: [{ code: 'workflow.unpublished' }],
  })
  const childDraft = await service.control.drafts.changeDraft('operator', child.flow.flowId, child.flow.draftRevisionId, [
    { kind: 'graph.node.create', nodeId: 'start', node: { kind: 'start', name: 'Start', inputDefs: [] } },
  ])
  const published = await service.control.publications.publishFlow('operator', child.flow.flowId, childDraft.revision.revisionId, engine, null, 'publish-draft')
  await expect.poll(() => service.control.publications.getPublishOperation('operator', child.flow.flowId, published.operationId).status).toBe('succeeded')
  const refreshed = await service.control.drafts.editAuthoring('operator', parent.flow.flowId, {
    baseRevision: edited.revision,
    requestId: 'refresh',
    edits: [{ op: 'node.refresh', node: edited.nodes.call! }],
  })
  expect(refreshed.validation.status).toBe('valid')
})

it('diagnoses each caller of the same invalid dependency while reading each target revision once', async () => {
  const service = await openService(':memory:')
  const leaf = await target(service)
  const middle = await caller(service, leaf.flowId)
  const live = await service.control.publications.publishFlow('operator', middle.flowId, middle.revisionId, engine, null, 'middle-live')
  await expect.poll(() => service.control.publications.getPublishOperation('operator', middle.flowId, live.operationId).status).toBe('succeeded')
  const task = workflowTask(service.control.flows.getWorkflowContract('operator', middle.flowId))
  const outer = await create(service, 'Outer', [
    { kind: 'graph.node.create', nodeId: 'start', node: { inputDefs: [], kind: 'start', name: 'Start' } },
    { kind: 'graph.node.create', nodeId: 'first', node: { kind: 'task', name: 'First call', inputs: {}, task } },
    { kind: 'graph.node.create', nodeId: 'second', node: { kind: 'task', name: 'Second call', inputs: {}, task } },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'first' } },
    { kind: 'graph.edge.connect', edge: { source: 'start', target: 'second' } },
  ])
  const changed = await service.control.drafts.changeDraft('operator', leaf.flowId, leaf.revisionId, [
    outputChange(service, leaf, { outputDefs: [number, { handle: 'extra', jsonSchema: {}, nullable: true }] }),
  ])
  const updated = await service.control.publications.publishFlow(
    'operator',
    leaf.flowId,
    changed.revision.revisionId,
    engine,
    service.control.flows.getFlow('operator', leaf.flowId).live!.publicationId,
    'leaf-updated',
  )
  await expect.poll(() => service.control.publications.getPublishOperation('operator', leaf.flowId, updated.operationId).status).toBe('succeeded')
  const store = (service.control.runs as unknown as { store: Store }).store
  const read = vi.spyOn(store.flows, 'revision')
  const checked = await service.control.drafts.checkFlow('operator', outer.flowId, outer.revisionId, engine)
  expect(checked.diagnostics).toMatchObject([
    { code: 'workflow.dependency-stale', path: '/document/graph/nodes/first/task/executor/flowId' },
    { code: 'workflow.dependency-stale', path: '/document/graph/nodes/second/task/executor/flowId' },
  ])
  expect(read.mock.calls.filter(([id]) => id == middle.flowId)).toHaveLength(1)
  expect(read.mock.calls.filter(([id]) => id == leaf.flowId)).toHaveLength(1)
  const childLive = service.control.flows.getFlow('operator', leaf.flowId).live!
  service.control.publications.setFlowEnabled('operator', leaf.flowId, childLive.publicationId, false)
  expect((await service.control.drafts.checkFlow('operator', outer.flowId, outer.revisionId, engine)).diagnostics).toMatchObject([
    { code: 'workflow.dependency-invalid', path: '/document/graph/nodes/first/task/executor/flowId' },
    { code: 'workflow.dependency-invalid', path: '/document/graph/nodes/second/task/executor/flowId' },
  ])
})

it('protects unfinished child calls and retains origin until both runs are deleted', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await caller(service, child.flowId)
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revisionId, engine, {}, 'cleanup', {
    nodeId: 'start',
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).calls?.length).toBe(1)
  const call = service.control.runs.getRun('operator', accepted.run.runId).calls![0]!
  await expect.poll(() => service.control.runs.getRun('operator', call.runId).waits.length).toBe(1)
  const store = (service.control.runs as unknown as { store: Store }).store
  expect(store.runs.deleteByFlow(child.flowId, 10)).toBe(0)
  const wait = service.control.runs.getRun('operator', call.runId).waits[0]!
  service.control.runs.resolveRunWait('operator', call.runId, wait.waitId, 'continue')
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  expect(store.runs.deleteByFlow(parent.flowId, 10)).toBe(1)
  expect(store.runs.workflowOrigin(call.runId)).toMatchObject({ runId: accepted.run.runId })
  expect(store.runs.deleteByFlow(child.flowId, 10)).toBe(1)
  expect(store.runs.workflowOrigin(call.runId)).toBeUndefined()
})

it('resolves authoring targets with one metadata lookup and no revision read for an unpublished target', async () => {
  const service = await openService(':memory:')
  const live = await target(service)
  const draft = await service.control.flows.createFlow('operator', 'Draft', 'draft')
  const store = (service.control.runs as unknown as { store: Store }).store
  const get = vi.spyOn(store.flows, 'get')
  const read = vi.spyOn(store.flows, 'revision')
  expect(workflowAuthoringTarget(store, 'operator', live.flowId)).toMatchObject({ revisionId: live.revisionId })
  expect(get).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
  get.mockClear()
  read.mockClear()
  expect(workflowAuthoringTarget(store, 'operator', draft.flow.flowId)).toMatchObject({ problem: 'unpublished' })
  expect(get).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
})

it('reads and compares publication interfaces without reading revision bodies, and restores them on rollback', async () => {
  const service = await openService(':memory:')
  const child = await target(service)
  const first = service.control.flows.getWorkflowContract('operator', child.flowId)
  const task = { kind: 'task' as const, name: 'Call', task: workflowTask(first), inputs: { answer: { kind: 'value' as const, value: 3 } } }
  const store = (service.control.runs as unknown as { store: Store }).store
  const changed = await service.control.drafts.changeDraft('operator', child.flowId, child.revisionId, [
    outputChange(service, child, { outputMappings: { answer: { kind: 'value', value: 9 } } }),
  ])
  expect(service.control.flows.getWorkflowContract('operator', child.flowId)).toEqual(first)
  const op = await service.control.publications.publishFlow(
    'operator',
    child.flowId,
    changed.revision.revisionId,
    engine,
    first.publicationId,
    'implementation',
  )
  await expect.poll(() => service.control.publications.getPublishOperation('operator', child.flowId, op.operationId).status).toBe('succeeded')
  const read = vi.spyOn(store.flows, 'revision').mockImplementation(() => {
    throw new Error('Unexpected full Revision read')
  })
  const second = service.control.flows.getWorkflowContract('operator', child.flowId)
  expect(second.revisionId).toBe(changed.revision.revisionId)
  expect(workflowCallCompatibility(store, task, second)).toEqual([])
  expect(
    workflowCallCompatibility(store, { ...task, task: { ...task.task, executor: { kind: 'workflow', flowId: child.flowId, revisionId: 'missing' } } }, second),
  ).toMatchObject([{ reason: 'snapshot-missing' }])
  expect(service.control.flows.listFlows('operator', 100, undefined, false).page.flows.find((flow) => flow.flowId == child.flowId)?.live).toMatchObject({
    hasStart: true,
  })
  expect(read).not.toHaveBeenCalled()
  read.mockRestore()
  const rolledBack = await service.control.publications.rollbackFlow('operator', child.flowId, first.publicationId, second.publicationId, 'restore')
  expect(service.control.flows.getWorkflowContract('operator', child.flowId)).toMatchObject({
    revisionId: first.revisionId,
    publicationId: rolledBack.publication.publicationId,
    inputs: first.inputs,
    outputs: first.outputs,
  })
  expect(store.publications.interfaceForRevision(child.flowId, second.revisionId)).toEqual({ inputs: first.inputs, outputs: first.outputs })
})

it('refreshes list counts through real draft, publication, disabled-live and retirement changes', async () => {
  const service = await openService(':memory:', { clock: Date.now })
  const child = await target(service)
  const parent = await caller(service, child.flowId)
  const count = () => service.control.flows.listFlows('operator', 50, undefined, false).page.flows.find((flow) => flow.flowId == child.flowId)!.referenceCount
  expect(count()).toBe(1)
  const published = await service.control.publications.publishFlow('operator', parent.flowId, parent.revisionId, engine, null, 'publish-parent')
  await expect.poll(() => service.control.publications.getPublishOperation('operator', parent.flowId, published.operationId).status).toBe('succeeded')
  const live = service.control.flows.getFlow('operator', parent.flowId).live!
  service.control.publications.setFlowEnabled('operator', parent.flowId, live.publicationId, false)
  expect(count()).toBe(1)
  const store = (service.control.runs as unknown as { store: Store }).store
  store.flows.retire(parent.flowId, Date.now())
  expect(count()).toBe(0)
  expect(service.control.flows.getFlowReferences('operator', child.flowId, 'incoming', 0, 50).total).toBe(0)
})

async function codeToolCaller(service: ServerService, flowId: string, code: string, name = 'code-tool-caller', timeoutMs?: number) {
  const { flow } = await service.control.flows.createFlow('operator', 'Code tool caller', name)
  const edited = await service.control.drafts.editAuthoring('operator', flow.flowId, {
    baseRevision: flow.draftRevisionId,
    requestId: 'create-tools',
    edits: [
      { op: 'node.add', as: 'start', type: 'start', name: 'Start' },
      {
        op: 'node.add',
        as: 'code',
        type: 'code',
        name: 'Call tools',
        config: {
          inputs: {},
          outputs: { answers: { schema: { type: 'array', items: { type: 'number' } }, nullable: false } },
          capabilities: [{ kind: 'workflow', name: 'echo', flowId }],
        },
      },
      { op: 'text.set', node: '$code', field: 'code', text: code },
      ...(timeoutMs == null ? [] : [{ op: 'node.update' as const, node: '$code', set: { timeoutMs } }]),
      { op: 'edge.connect', source: '$start', target: '$code' },
    ],
  })
  return edited
}

it('calls workflow tools repeatedly and concurrently from public Code authoring with one execution slot', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const invoke = service.control.runs.invokeWorkflowTarget.bind(service.control.runs)
  vi.spyOn(service.control.runs, 'invokeWorkflowTarget').mockImplementation(async (...args) => {
    const [first, repeated] = await Promise.all([invoke(...args), invoke(...args)])
    if (first.kind == 'calling' && repeated.kind == 'calling') expect(repeated.childRunId).toBe(first.childRunId)
    return first
  })
  const child = await target(service)
  const parent = await codeToolCaller(
    service,
    child.flowId,
    `export default async (_, context) => {
    const results = await Promise.all([0, -2, 3].map(answer => context.workflows.call('echo', { answer })));
    const last = await context.workflows.call('echo', { answer: 4 });
    return { answers: [...results.map(result => result.answer), last.answer] };
  }`,
  )
  expect(await service.control.drafts.checkAuthoring('operator', parent.flowId, parent.revision)).toMatchObject({ valid: true })
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revision, engine, {}, 'code-tools', {
    nodeId: parent.nodes.start!,
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  const run = service.control.runs.getRun('operator', accepted.run.runId)
  expect(run.calls).toHaveLength(4)
  expect(new Set(run.calls!.map((call) => call.callId)).size).toBe(4)
  expect(run.calls!.every((call) => call.status == 'completed')).toBe(true)
  expect(service.control.runs.getRunEvents('operator', run.runId, 0, 100).events.findLast((event) => event.kind == 'node.completed')?.payload).toMatchObject({
    outputs: { answers: [0, -2, 3, 4] },
  })
  expect(
    service.control.flows.getFlowReferences('operator', child.flowId, 'incoming', 0, 50).references.some((reference) => reference.flowId == parent.flowId),
  ).toBe(true)
})

it('denies undeclared workflow tool aliases before admitting a child', async () => {
  const service = await openService(':memory:', { clock: Date.now })
  const child = await target(service)
  const parent = await codeToolCaller(service, child.flowId, `export default async (_, context) => context.workflows.call('missing', { answer: 1 })`)
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revision, engine, {}, 'missing-tool', {
    nodeId: parent.nodes.start!,
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('failed')
  expect(service.control.runs.getRun('operator', accepted.run.runId).calls).toEqual([])
})

it('executes a renamed workflow tool after a partial public authoring update', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const parent = await codeToolCaller(service, child.flowId, 'export default () => ({ answers: [] })')
  const renamed = await service.control.drafts.editAuthoring('operator', parent.flowId, {
    baseRevision: parent.revision,
    requestId: 'rename-tool',
    edits: [
      {
        op: 'node.update',
        node: parent.nodes.code!,
        set: { config: { capabilities: [{ kind: 'workflow', flowId: child.flowId, name: 'renamed' }] } },
      },
      {
        op: 'text.set',
        node: parent.nodes.code!,
        field: 'code',
        text: `export default async (_, context) => ({ answers: [(await context.workflows.call('renamed', { answer: 7 })).answer] })`,
      },
    ],
  })
  expect(renamed.validation.status).toBe('valid')
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, renamed.revision, engine, {}, 'renamed-tool', {
    nodeId: parent.nodes.start!,
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  expect(
    service.control.runs.getRunEvents('operator', accepted.run.runId, 0, 100).events.findLast((event) => event.kind == 'node.completed')?.payload,
  ).toMatchObject({ outputs: { answers: [7] } })
})

it('cancels a waiting workflow tool when its calling Run is canceled', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await codeToolCaller(
    service,
    child.flowId,
    `export default async (_, context) => { const result = await context.workflows.call('echo', { answer: 1 }); return { answers: [result.answer] } }`,
  )
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revision, engine, {}, 'cancel-tool', {
    nodeId: parent.nodes.start!,
    outputs: {},
  })
  await expect
    .poll(() => {
      const call = service.control.runs.getRun('operator', accepted.run.runId).calls?.[0]
      return call == null ? 0 : service.control.runs.getRun('operator', call.runId).waits.length
    })
    .toBe(1)
  service.control.runs.cancelRun('operator', accepted.run.runId)
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).calls?.[0]?.status).toBe('canceled')
})

it('resumes an in-memory workflow tool after child Wait with one execution slot', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await codeToolCaller(
    service,
    child.flowId,
    `export default async (_, context) => { const result = await context.workflows.call('echo', { answer: 0 }); return { answers: [result.answer] } }`,
  )
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revision, engine, {}, 'wait-tool', {
    nodeId: parent.nodes.start!,
    outputs: {},
  })
  await expect
    .poll(() => {
      const call = service.control.runs.getRun('operator', accepted.run.runId).calls?.[0]
      return call == null ? 0 : service.control.runs.getRun('operator', call.runId).waits.length
    })
    .toBe(1)
  const call = service.control.runs.getRun('operator', accepted.run.runId).calls![0]!
  expect(service.control.runs.getRun('operator', accepted.run.runId).status).toBe('running')
  const wait = service.control.runs.getRun('operator', call.runId).waits[0]!
  service.control.runs.resolveRunWait('operator', call.runId, wait.waitId, 'continue')
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  expect(service.control.runs.getRun('operator', accepted.run.runId).calls).toHaveLength(1)
})

it.each(['timeout', 'node-ended'] as const)('cancels unfinished workflow tools on %s', async (reason) => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const code =
    reason == 'timeout'
      ? `export default async (_, context) => { await context.workflows.call('echo', { answer: 1 }); return { answers: [] } }`
      : `export default async (_, context) => { context.workflows.call('echo', { answer: 1 }).catch(() => {}); await new Promise(resolve => setTimeout(resolve, 200)); return { answers: [] } }`
  const parent = await codeToolCaller(service, child.flowId, code, 'end-tool', reason == 'timeout' ? 500 : undefined)
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revision, engine, {}, 'end-tool', {
    nodeId: parent.nodes.start!,
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe(reason == 'timeout' ? 'failed' : 'completed')
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).calls?.[0]?.status).toBe('canceled')
})

it('advances nested tools and multiple parent runs with one execution slot', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const leaf = await target(service)
  const middle = await codeToolCaller(
    service,
    leaf.flowId,
    `export default async (_, context) => { const result = await context.workflows.call('echo', { answer: 2 }); return { answers: [result.answer] } }`,
    'middle',
  )
  const published = await service.control.publications.publishFlow('operator', middle.flowId, middle.revision, engine, null, 'publish-middle')
  await expect.poll(() => service.control.publications.getPublishOperation('operator', middle.flowId, published.operationId).status).toBe('succeeded')
  const parents = await Promise.all(
    ['one', 'two'].map((name) =>
      codeToolCaller(
        service,
        middle.flowId,
        `export default async (_, context) => { const result = await context.workflows.call('echo', {}); if (Object.keys(result).length) throw new Error('Expected no business outputs'); return { answers: [] } }`,
        name,
      ),
    ),
  )
  const accepted = await Promise.all(
    parents.map((parent) =>
      service.control.runs.createDraftRun('operator', parent.flowId, parent.revision, engine, {}, `nested-${parent.flowId}`, {
        nodeId: parent.nodes.start!,
        outputs: {},
      }),
    ),
  )
  for (const { run } of accepted) {
    await expect.poll(() => service.control.runs.getRun('operator', run.runId).status).toBe('completed')
    const nested = service.control.runs.getRun('operator', run.runId).calls![0]!
    expect(service.control.runs.getRun('operator', nested.runId).calls).toHaveLength(1)
  }
})

it('does not replay a tool call after interruption and restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-tool-restart-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service, true)
  const parent = await codeToolCaller(
    service,
    child.flowId,
    `export default async (_, context) => { await context.workflows.call('echo', { answer: 1 }); return { answers: [] } }`,
  )
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revision, engine, {}, 'restart-tool', {
    nodeId: parent.nodes.start!,
    outputs: {},
  })
  await expect
    .poll(() => {
      const call = service.control.runs.getRun('operator', accepted.run.runId).calls?.[0]
      return call == null ? 0 : service.control.runs.getRun('operator', call.runId).waits.length
    })
    .toBe(1)
  const original = service.control.runs.getRun('operator', accepted.run.runId).calls![0]!
  await closeService(service)
  const reopened = await openService(file, { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  await startService(reopened)
  expect(reopened.control.runs.getRun('operator', accepted.run.runId).status).toBe('indeterminate')
  expect(reopened.control.runs.getRun('operator', accepted.run.runId).calls).toMatchObject([{ callId: original.callId, runId: original.runId }])
})

it('checks and explicitly refreshes tool interfaces while retaining unavailable drafts', async () => {
  const service = await openService(':memory:', { clock: Date.now })
  const child = await target(service)
  const parent = await codeToolCaller(service, child.flowId, 'export default () => ({ answers: [] })')
  const original = service.control.drafts.getRevision('operator', parent.flowId, parent.revision).content
  const publish = async (revision: string, key: string) => {
    const live = service.control.flows.getFlow('operator', child.flowId).live!
    const operation = await service.control.publications.publishFlow('operator', child.flowId, revision, engine, live.publicationId, key)
    await expect.poll(() => service.control.publications.getPublishOperation('operator', child.flowId, operation.operationId).status).toBe('succeeded')
  }
  const equivalent = await service.control.drafts.changeDraft('operator', child.flowId, child.revisionId, [
    outputChange(service, child, { outputMappings: { answer: { kind: 'value', value: 0 } } }),
  ])
  await publish(equivalent.revision.revisionId, 'equivalent')
  expect(await service.control.drafts.checkAuthoring('operator', parent.flowId, parent.revision)).toMatchObject({ valid: true })
  const changed = await service.control.drafts.changeDraft('operator', child.flowId, equivalent.revision.revisionId, [
    outputChange(
      service,
      { flowId: child.flowId, revisionId: equivalent.revision.revisionId },
      { outputDefs: [{ ...number, jsonSchema: { type: 'string' } }], outputMappings: { answer: { kind: 'value', value: 'changed' } } },
    ),
  ])
  await publish(changed.revision.revisionId, 'changed')
  const checked = await service.control.drafts.checkAuthoring('operator', parent.flowId, parent.revision)
  expect(checked).toMatchObject({ valid: false, diagnostics: [{ code: 'workflow.revision-stale', field: 'config.capabilities.0.flowId' }] })
  expect(service.control.drafts.getRevision('operator', parent.flowId, parent.revision).content).toEqual(original)
  const refreshed = await service.control.drafts.editAuthoring('operator', parent.flowId, {
    baseRevision: parent.revision,
    requestId: 'refresh-tool',
    edits: [{ op: 'node.refresh', node: parent.nodes.code!, tool: 'echo' }],
  })
  expect(refreshed.validation.status).toBe('valid')
  const live = service.control.flows.getFlow('operator', child.flowId).live!
  service.control.publications.setFlowEnabled('operator', child.flowId, live.publicationId, false)
  const draft = await codeToolCaller(service, child.flowId, 'export default () => ({ answers: [] })', 'disabled-draft')
  expect(draft.validation.status).not.toBe('valid')
  await expect(
    service.control.drafts.editAuthoring('operator', draft.flowId, {
      baseRevision: draft.revision,
      requestId: 'self-tool',
      edits: [{ op: 'node.update', node: draft.nodes.code!, set: { config: { capabilities: [{ kind: 'workflow', name: 'self', flowId: draft.flowId }] } } }],
    }),
  ).rejects.toMatchObject({ code: 'flow.invalid', details: { reason: 'workflow.recursive' } })
})

it('preserves zero, negative, null and omitted workflow arguments and rejects unknown parameters', async () => {
  const service = await openService(':memory:', { clock: Date.now, runtime: { maxConcurrentRuns: 1 } })
  const child = await target(service)
  const before = service.control.drafts.getRevision('operator', child.flowId, child.revisionId).content.document.graph.nodes.start!
  const nullable = await service.control.drafts.changeDraft('operator', child.flowId, child.revisionId, [
    { kind: 'graph.node.replace', nodeId: 'start', before, node: { kind: 'start', name: 'Start', inputDefs: [{ ...number, nullable: true }] } },
    outputChange(service, child, { outputDefs: [{ ...number, nullable: true }] }),
  ])
  const operation = await service.control.publications.publishFlow(
    'operator',
    child.flowId,
    nullable.revision.revisionId,
    engine,
    service.control.flows.getFlow('operator', child.flowId).live!.publicationId,
    'nullable',
  )
  await expect.poll(() => service.control.publications.getPublishOperation('operator', child.flowId, operation.operationId).status).toBe('succeeded')
  const parent = await codeToolCaller(
    service,
    child.flowId,
    `export default async (_, context) => {
    const results = await Promise.all([{answer:0},{answer:-2},{answer:null},{}].map(input => context.workflows.call('echo', input)));
    if (JSON.stringify(results.map(result => result.answer)) !== '[0,-2,null,null]') throw new Error('Arguments changed');
    return { answers: [0,-2] };
  }`,
  )
  const accepted = await service.control.runs.createDraftRun('operator', parent.flowId, parent.revision, engine, {}, 'nullable-tool', {
    nodeId: parent.nodes.start!,
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', accepted.run.runId).status).toBe('completed')
  const invalid = await codeToolCaller(
    service,
    child.flowId,
    `export default async (_, context) => context.workflows.call('echo', { unknown: 1 })`,
    'unknown-parameter',
  )
  const rejected = await service.control.runs.createDraftRun('operator', invalid.flowId, invalid.revision, engine, {}, 'unknown-param', {
    nodeId: invalid.nodes.start!,
    outputs: {},
  })
  await expect.poll(() => service.control.runs.getRun('operator', rejected.run.runId).status).toBe('failed')
  expect(service.control.runs.getRun('operator', rejected.run.runId).calls).toEqual([])
})
