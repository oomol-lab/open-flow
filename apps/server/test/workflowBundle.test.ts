import type { GraphNode } from '@oomol-lab/open-flow/flow-change'
import type { WorkflowBundle, WorkflowFile } from '@oomol-lab/open-flow/flow-encoding'
import type { ServerService } from '../node/application/service.ts'
import type { Store } from '../node/storage/store.ts'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { workflowBundleFromPreview } from '@oomol-lab/open-flow/flow-encoding'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { ConnectorClient } from '../node/deployment/connector.ts'
import { ControlError } from '../node/error.ts'
import { TagAssignmentError } from '../node/storage/tag-store.ts'
import { createServerApp } from '../node/transport/http.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

function file(name: string, targets: readonly string[] = []): WorkflowFile {
  const calls = targets.map((flowId, i): [string, GraphNode] => [
    `call${i}`,
    {
      kind: 'task',
      name: `Call ${i}`,
      inputs: {},
      task: { name: 'Call', inputs: [], outputs: [], executor: { kind: 'workflow', flowId, revisionId: 'source-live' } },
    },
  ])
  return {
    kind: 'open-flow-workflow',
    version: 1,
    name,
    icon: ':twemoji:package:',
    description: `Process ${name}.\nNotify the team.`,
    presentation: { comments: [name] },
    content: {
      modelVersion: currentFlowModelVersion,
      modules: {},
      document: {
        bindings: {},
        graph: {
          nodes: { start: { kind: 'start', name: 'Start', inputDefs: [] }, ...Object.fromEntries(calls) },
          edges: targets.length ? [{ source: 'start', target: 'call0' }] : [],
        },
      },
    },
  }
}
const bundle: WorkflowBundle = {
  kind: 'open-flow-workflow-bundle',
  version: 1,
  entryFlowId: 'root',
  workflows: [
    { flowId: 'root', file: file('Root', ['middle', 'leaf']) },
    { flowId: 'middle', file: file('Middle', ['leaf']) },
    { flowId: 'leaf', file: file('Leaf') },
  ],
}

function storeOf(service: ServerService): Store {
  return (service.control.runs as unknown as { store: Store }).store
}

it('imports the whole bundle with tags and layout, restores shared references, and exports each draft once', async () => {
  const service = await openService(':memory:')
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const client = new ControlClient(async (url, init) => app.request(`http://test${url}`, init))
  const tag = service.control.tags.saveTag('operator', 'Imported')
  const changed = vi.fn()
  const other = vi.fn()
  onTestFinished(service.subscribeFlowCatalog('operator', changed))
  onTestFinished(service.subscribeFlowCatalog('other', other))
  const result = await client.importFlowBundle(bundle, { name: 'Renamed root', tagIds: [tag.tagId, tag.tagId], idempotencyKey: 'import' })
  expect(result.flows).toHaveLength(3)
  expect(changed).toHaveBeenCalledOnce()
  expect(other).not.toHaveBeenCalled()
  const middle = result.flows.find((item) => item.name == 'Middle')!
  const leaf = result.flows.find((item) => item.name == 'Leaf')!
  for (const flow of result.flows) {
    expect(flow.tagIds).toEqual([tag.tagId])
    const original = bundle.workflows.find((item) => item.file.name == (flow.name == 'Renamed root' ? 'Root' : flow.name))!.file
    expect(flow).toMatchObject({ icon: original.icon, description: original.description })
    expect(flow.live).toBeUndefined()
    expect(['root', 'middle', 'leaf']).not.toContain(flow.flowId)
  }
  const editor = await client.getEditor(result.flow.flowId)
  expect(editor.presentation.value).toEqual(bundle.workflows[0]!.file.presentation)
  expect(editor.draft.content.document.graph.nodes.call0).toMatchObject({ task: { executor: { flowId: middle.flowId, revisionId: '' } } })
  expect(editor.draft.content.document.graph.nodes.call1).toMatchObject({ task: { executor: { flowId: leaf.flowId, revisionId: '' } } })
  expect((await client.getEditor(middle.flowId)).draft.content.document.graph.nodes.call0).toMatchObject({ task: { executor: { flowId: leaf.flowId } } })
  expect(service.control.tags.listTags('operator').tags[0]?.referenceCount).toBe(3)
  const preview = await client.getFlowExportPreview(result.flow.flowId)
  expect(preview.workflows[0]?.flowId).toBe(result.flow.flowId)
  expect(preview.workflows).toHaveLength(3)
  expect(preview.unavailableFlowIds).toEqual([])
  expect(preview.workflows[0]?.file).toMatchObject({ icon: bundle.workflows[0]!.file.icon, description: bundle.workflows[0]!.file.description })
  expect(await client.exportFlowBundle(result.flow.flowId)).toEqual(workflowBundleFromPreview(preview))
  expect(await client.importFlowBundle(bundle, { name: 'Renamed root', tagIds: [tag.tagId], idempotencyKey: 'import' })).toEqual(result)
  await expect(client.importFlowBundle(bundle, { name: 'Changed', tagIds: [tag.tagId], idempotencyKey: 'import' })).rejects.toMatchObject({
    code: 'flow.conflict',
  })
  const copy = await client.importFlowBundle(bundle)
  expect(copy.flows.every((item) => !result.flows.some((old) => old.flowId == item.flowId))).toBe(true)
  const isolated = await service.control.flows.importBundle('other', bundle, 'import')
  expect(isolated.flows).toHaveLength(3)
  expect(isolated.flows.every((item) => !result.flows.some((old) => old.flowId == item.flowId))).toBe(true)
})

it('binds every member to the selected Team and replays without consulting an offline Team service', async () => {
  const connector = new ConnectorClient('https://connector.oomol.com', 'test-runtime-token')
  const teams = vi.spyOn(connector, 'listTeams').mockResolvedValue([
    { id: 'selected', name: 'Selected', systemCreated: false },
    { id: 'default', name: 'Default', systemCreated: true },
  ])
  const service = await openService(':memory:', { capabilities: { connector: () => connector } })
  const imported = await service.control.flows.importBundle('operator', bundle, 'team', undefined, 'selected')
  for (const member of imported.flows) expect(await service.control.connectors.resolveConnectorScope('operator', member.flowId)).toBe('selected')
  await expect(service.control.flows.importBundle('operator', bundle, 'missing-team', undefined, 'missing')).rejects.toMatchObject({ code: 'flow.invalid' })
  expect(service.control.flows.listFlows('operator', 100).page.flows).toHaveLength(3)
  teams.mockRejectedValue(new Error('Team service is offline'))
  expect(await service.control.flows.importBundle('operator', bundle, 'team', undefined, 'selected')).toEqual({ ...imported, created: false })
})

it('reports inaccessible and absent dependencies without exposing names or content, and handles cycles', async () => {
  const service = await openService(':memory:')
  const { control } = service
  const foreign = await control.flows.importFlow('other', file('Private name'), 'private')
  const root = await control.flows.importFlow('operator', file('Root', [foreign.flow.flowId, 'missing']), 'root')
  const preview = control.flows.getExportPreview('operator', root.flow.flowId)
  expect(preview.workflows).toHaveLength(1)
  expect(preview.unavailableFlowIds).toEqual([foreign.flow.flowId, 'missing'].toSorted())
  expect(JSON.stringify(preview)).not.toContain('Private name')
  expect(() => control.flows.getExportPreview('other', root.flow.flowId)).toThrow(expect.objectContaining({ code: 'flow.not-found' }))
  const cyclic: WorkflowBundle = {
    ...bundle,
    workflows: bundle.workflows.map((item) => (item.flowId == 'leaf' ? { ...item, file: file('Leaf', ['root']) } : item)),
  }
  const imported = await control.flows.importBundle('operator', cyclic, 'cycle')
  expect(control.flows.getExportPreview('operator', imported.flow.flowId).workflows).toHaveLength(3)
})

it('keeps the entry export available when a referenced draft requires repair', async () => {
  const service = await openService(':memory:')
  const { flows, drafts } = service.control
  const child = await flows.importFlow('operator', file('Child'), 'child')
  const parent = await flows.importFlow('operator', file('Root', [child.flow.flowId]), 'root')
  const read = drafts.getDraft.bind(drafts)
  vi.spyOn(drafts, 'getDraft').mockImplementation((actorId, flowId) => {
    if (flowId == child.flow.flowId) throw new ControlError('flow.repair-required', 'Repair this draft.')
    return read(actorId, flowId)
  })
  expect(flows.getExportPreview('operator', parent.flow.flowId)).toMatchObject({
    workflows: [{ flowId: parent.flow.flowId }],
    unavailableFlowIds: [child.flow.flowId],
  })
  expect(flows.exportFlow('operator', parent.flow.flowId).name).toBe('Root')
})

it('rolls back every member and its tags on a mid-transaction failure, including the import receipt', async () => {
  const service = await openService(':memory:')
  const tag = service.control.tags.saveTag('operator', 'Bundle')
  const store = storeOf(service)
  const replace = store.tags.replace.bind(store.tags)
  const spy = vi
    .spyOn(store.tags, 'replace')
    .mockImplementationOnce(replace)
    .mockImplementationOnce(() => {
      throw new TagAssignmentError('Unavailable tag')
    })
  await expect(service.control.flows.importBundle('operator', bundle, 'atomic', undefined, undefined, undefined, [tag.tagId])).rejects.toMatchObject({
    code: 'tag.not-found',
  })
  expect(service.control.flows.listFlows('operator', 100).page.flows).toEqual([])
  expect(service.control.tags.listTags('operator').tags[0]?.referenceCount).toBe(0)
  spy.mockRestore()
  expect((await service.control.flows.importBundle('operator', bundle, 'atomic', undefined, undefined, undefined, [tag.tagId])).flows).toHaveLength(3)
  await expect(service.control.flows.importBundle('operator', { ...bundle, workflows: [bundle.workflows[0]] }, 'bad')).rejects.toMatchObject({
    code: 'flow.invalid',
  })
})

it('persists receipts across restarts, preserves later tag changes and never recreates deleted members', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'workflow-bundle-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const database = path.join(directory, 'db.sqlite')
  const first = await openService(database)
  const tag = first.control.tags.saveTag('operator', 'Original')
  const original = await first.control.flows.importBundle('operator', bundle, 'persisted', undefined, undefined, undefined, [tag.tagId])
  first.control.flows.setFlowTags('operator', original.flow.flowId, [])
  first.control.tags.deleteTag('operator', tag.tagId)
  await closeService(first)
  const second = await openService(database)
  const replay = await second.control.flows.importBundle('operator', bundle, 'persisted', undefined, undefined, undefined, [tag.tagId])
  expect(replay.created).toBe(false)
  expect(replay.flows.map((item) => item.flowId)).toEqual(original.flows.map((item) => item.flowId))
  expect(replay.flow.tagIds).toEqual([])
  second.control.flows.retireFlow('operator', replay.flows[2]!.flowId)
  await expect(second.control.flows.importBundle('operator', bundle, 'persisted', undefined, undefined, undefined, [tag.tagId])).rejects.toMatchObject({
    code: 'flow.conflict',
  })
})

it('publishes and refreshes an imported chain and executes only its new workflow identities', async () => {
  const service = await openService(':memory:', { runtime: { maxConcurrentRuns: 1 } })
  await startService(service)
  const imported = await service.control.flows.importBundle('operator', bundle, 'execute')
  const middle = imported.flows.find((item) => item.name == 'Middle')!
  const leaf = imported.flows.find((item) => item.name == 'Leaf')!
  const { drafts, publications, runs } = service.control
  async function publish(flowId: string) {
    const draft = drafts.getDraft('operator', flowId)
    const operation = await publications.publishFlow('operator', flowId, draft.revisionId, currentEngineContract, null, `publish-${flowId}`)
    await expect.poll(() => publications.getPublishOperation('operator', flowId, operation.operationId).status).toBe('succeeded')
  }
  async function refresh(flowId: string, nodes: readonly string[]) {
    const result = await drafts.editAuthoring('operator', flowId, {
      baseRevision: drafts.getDraft('operator', flowId).revisionId,
      requestId: `refresh-${flowId}`,
      edits: nodes.map((node) => ({ op: 'node.refresh', node })),
    })
    expect(result.validation.status).toBe('valid')
  }
  await publish(leaf.flowId)
  await refresh(middle.flowId, ['call0'])
  await publish(middle.flowId)
  await refresh(imported.flow.flowId, ['call0', 'call1'])
  const run = await runs.createDraftRun(
    'operator',
    imported.flow.flowId,
    drafts.getDraft('operator', imported.flow.flowId).revisionId,
    currentEngineContract,
    {},
    'execute',
    { nodeId: 'start', outputs: {} },
  )
  await expect.poll(() => runs.getRun('operator', run.run.runId).status).toBe('completed')
  const call = runs.getRun('operator', run.run.runId).calls![0]!
  expect(call.flowId).toBe(middle.flowId)
  expect(runs.getRun('operator', call.runId).calls![0]?.flowId).toBe(leaf.flowId)
})
