import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { digestBytes, encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { createServerApp } from '../node/transport/http.ts'
import { closeOpenServices, openService } from './serviceFixture.ts'

const directories: string[] = []

afterEach(async () => {
  await closeOpenServices()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-start-trigger-'))
  directories.push(directory)
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file)
  const app = createServerApp(service, { resolveControlActor: () => 'operator' })
  const api = new ControlClient(async (route, init) => app.request(route, init))
  return { file, service, api }
}

const legacy: RevisionContent = {
  modelVersion: 6,
  modules: { shared: { name: 'Shared', source: 'export default () => ({})', imports: [] } },
  document: {
    bindings: {},
    graph: {
      nodes: {
        start: { kind: 'manual', name: 'Old entry', description: 'Preserve this description', icon: 'mdi:play' },
        value: { kind: 'value', name: 'Value', inputs: {}, values: [] },
      },
      edges: [{ source: 'start', target: 'value' }],
    },
  },
}

async function storedLegacy(file: string, api: ControlClient, content = legacy) {
  const flow = await api.createFlow('Legacy entry', 'create-legacy')
  const bytes = encodeRevision(content)
  const digest = await digestBytes(bytes)
  const database = new DatabaseSync(file)
  try {
    database.prepare('UPDATE revisions SET content = ?, digest = ? WHERE revision_id = ?').run(new TextDecoder().decode(bytes), digest, flow.draftRevisionId)
    database.prepare('UPDATE flow_revisions SET digest = ?, model_version = ? WHERE revision_id = ?').run(digest, content.modelVersion, flow.draftRevisionId)
  } finally {
    database.close()
  }
  return flow
}

it('upgrades a readable legacy Draft once while preserving historical Runs, Live and Presentation', async () => {
  const { api, file, service } = await fixture()
  const flow = await storedLegacy(file, api)
  const before = await api.getDraft(flow.flowId)
  const layout = service.control.flows.updatePresentation('operator', flow.flowId, 1, { nodes: { start: { x: 100, y: 200 } } })
  const run = await api.createDraftRun(flow.flowId, before.revisionId, { trigger: { nodeId: 'start', outputs: {} }, idempotencyKey: 'historical-run' })
  const operation = await api.publishFlow(flow.flowId, before.revisionId, null, { idempotencyKey: 'publish-legacy' })
  await service.tickMaintenance()
  expect(service.control.publications.getPublishOperation('operator', flow.flowId, operation.operationId).status).toBe('succeeded')
  const live = await api.getLive(flow.flowId)

  const [upgraded, replay] = await Promise.all([
    api.upgradeDraft(flow.flowId, before.revisionId, { idempotencyKey: 'upgrade-once' }),
    api.upgradeDraft(flow.flowId, before.revisionId, { idempotencyKey: 'upgrade-once' }),
  ])
  expect(replay).toEqual(upgraded)
  expect(upgraded.revision).toMatchObject({ parentRevisionId: before.revisionId, modelVersion: currentFlowModelVersion })
  expect(upgraded.revision.revisionId).not.toBe(before.revisionId)
  const next = await api.getDraft(flow.flowId)
  expect(next.content).toEqual({
    ...legacy,
    modelVersion: currentFlowModelVersion,
    document: {
      ...legacy.document,
      graph: {
        ...legacy.document.graph,
        nodes: {
          ...legacy.document.graph.nodes,
          start: { ...legacy.document.graph.nodes.start, kind: 'start', inputDefs: [] },
        },
      },
    },
  })
  expect(await api.getRevision(flow.flowId, before.revisionId)).toEqual(before)
  expect(await api.getRun(run.runId)).toEqual(run)
  expect(await api.getPresentation(flow.flowId)).toEqual(layout)
  expect((await api.getLive(flow.flowId)).publication).toEqual(live.publication)
  expect(await api.upgradeDraft(flow.flowId, next.revisionId, { idempotencyKey: 'already-upgraded' })).toEqual(upgraded)
  await expect(api.upgradeDraft(flow.flowId, before.revisionId, { idempotencyKey: 'stale-upgrade' })).rejects.toMatchObject({ code: 'flow.revision-conflict' })
  await expect(api.upgradeDraft(flow.flowId, next.revisionId, { idempotencyKey: 'upgrade-once' })).rejects.toMatchObject({ code: 'flow.conflict' })
  const changed = await api.changeDraft(
    flow.flowId,
    next.revisionId,
    [{ kind: 'graph.node.field.set', nodeId: 'start', field: 'name', before: 'Old entry', value: 'Changed entry' }],
    'rename',
  )
  expect(changed.revision.revisionId).not.toBe(next.revisionId)
  expect(await api.upgradeDraft(flow.flowId, before.revisionId, { idempotencyKey: 'upgrade-once' })).toEqual(upgraded)
  await expect(api.upgradeDraft(flow.flowId, next.revisionId, { idempotencyKey: 'already-upgraded' })).rejects.toMatchObject({ code: 'flow.revision-conflict' })
})

it.each([7, 8])('rejects model %s legacy Start configuration without rewriting stored history', async (modelVersion) => {
  const { api, file, service } = await fixture()
  const flow = await api.createFlow('Legacy Start parameters', 'legacy-start-parameters')
  const parameters = [
    { handle: 'message', jsonSchema: { type: 'string', minLength: 1 }, nullable: false, description: 'Required message' },
    { handle: 'note', jsonSchema: { type: 'string', default: 'unused' }, nullable: true },
  ]
  const node = { kind: 'start' as const, name: 'Original entry', description: 'Preserve this description', icon: 'mdi:play' }
  const content = JSON.stringify({
    ...legacy,
    modelVersion,
    kind: 'open-flow-flow-revision',
    version: 1,
    document: { ...legacy.document, graph: { ...legacy.document.graph, nodes: { ...legacy.document.graph.nodes, start: { ...node, parameters } } } },
  })
  const digest = await digestBytes(new TextEncoder().encode(content))
  const database = new DatabaseSync(file)
  try {
    database.prepare('UPDATE revisions SET content = ?, digest = ? WHERE revision_id = ?').run(content, digest, flow.draftRevisionId)
    database.prepare('UPDATE flow_revisions SET digest = ?, model_version = ? WHERE revision_id = ?').run(digest, modelVersion, flow.draftRevisionId)
    const presentation = service.control.flows.updatePresentation('operator', flow.flowId, 1, { nodes: { start: { x: 100, y: 200 } } })
    await expect(api.getEditor(flow.flowId)).rejects.toThrow()
    await expect(api.upgradeDraft(flow.flowId, flow.draftRevisionId)).rejects.toThrow()
    expect((await api.getFlow(flow.flowId)).draftRevisionId).toBe(flow.draftRevisionId)
    expect(await api.getPresentation(flow.flowId)).toEqual(presentation)
    expect(database.prepare('SELECT content, digest FROM revisions WHERE revision_id = ?').get(flow.draftRevisionId)).toEqual({ content, digest })
  } finally {
    database.close()
  }
})

it.each(['unreadable', 'retired Subflow', 'digest mismatch'])('rejects %s upgrade without repairing or changing the stored Draft', async (failure) => {
  const { api, file } = await fixture()
  const flow = await api.createFlow('Rejected upgrade', 'rejected')
  const before = await api.getDraft(flow.flowId)
  const content =
    failure == 'unreadable'
      ? '{'
      : failure == 'digest mismatch'
        ? new TextDecoder().decode(encodeRevision(legacy))
        : JSON.stringify({
            ...legacy,
            kind: 'open-flow-flow-revision',
            version: 1,
            document: { ...legacy.document, subflows: { child: { inputs: [], outputs: [], graph: { nodes: {}, edges: [] } } } },
          })
  const digest = await digestBytes(new TextEncoder().encode(content))
  const database = new DatabaseSync(file)
  try {
    database
      .prepare('UPDATE revisions SET content = ?, digest = ? WHERE revision_id = ?')
      .run(content, failure == 'digest mismatch' ? before.digest : digest, before.revisionId)
    const count = database.prepare('SELECT COUNT(*) AS count FROM flow_revisions').get()
    await expect(api.upgradeDraft(flow.flowId, before.revisionId, { idempotencyKey: 'rejected-upgrade' })).rejects.toMatchObject({
      code: 'flow.invalid',
    })
    expect((await api.getFlow(flow.flowId)).draftRevisionId).toBe(before.revisionId)
    expect(database.prepare('SELECT content FROM revisions WHERE revision_id = ?').get(before.revisionId)).toEqual({ content })
    expect(database.prepare('SELECT COUNT(*) AS count FROM flow_revisions').get()).toEqual(count)
  } finally {
    database.close()
  }
})

it.each(['draft', 'live'] as const)('persists complete Start arguments for %s Runs and keeps original request idempotency', async (source) => {
  const { api, file, service } = await fixture()
  const flow = await api.createFlow('Start arguments', 'arguments')
  const changed = await api.changeDraft(flow.flowId, flow.draftRevisionId, [
    {
      kind: 'graph.node.create',
      nodeId: 'start',
      node: {
        kind: 'start',
        name: 'Start',
        inputDefs: [
          { handle: 'text', jsonSchema: { type: 'string' }, nullable: false },
          { handle: 'items', jsonSchema: { type: 'array', items: { type: 'string' } }, nullable: true },
        ],
      },
    },
  ])
  let publicationId: string | undefined
  if (source == 'live') {
    const op = await api.publishFlow(flow.flowId, changed.revision.revisionId, null, { idempotencyKey: 'publish-arguments' })
    await service.tickMaintenance()
    const published = service.control.publications.getPublishOperation('operator', flow.flowId, op.operationId)
    if (published.status != 'succeeded') throw new Error('Publication did not succeed')
    publicationId = published.publicationId
  }
  const create = (outputs: Record<string, string | null | string[]>, idempotencyKey: string) =>
    source == 'draft'
      ? api.createDraftRun(flow.flowId, changed.revision.revisionId, { trigger: { nodeId: 'start', outputs }, idempotencyKey })
      : api.createLiveRun(publicationId!, { trigger: { nodeId: 'start', outputs }, idempotencyKey })
  const run = await create({ text: 'original' }, 'omitted-nullable')
  const database = new DatabaseSync(file)
  try {
    const stored = database.prepare('SELECT trigger_outputs AS outputs FROM runs WHERE run_id = ?').get(run.runId) as { outputs: string }
    expect(JSON.parse(stored.outputs)).toEqual({ text: 'original', items: null })
    expect(await create({ text: 'original' }, 'omitted-nullable')).toEqual(run)
    await expect(create({ text: 'original', items: null }, 'omitted-nullable')).rejects.toMatchObject({ code: 'run.conflict' })
    const invalidOutputs: readonly Record<string, string | null>[] = [
      {},
      { text: null },
      { text: 'original', items: 'wrong' },
      { text: 'original', extra: null },
    ]
    for (const [index, outputs] of invalidOutputs.entries()) {
      await expect(create(outputs, `invalid-${index}`)).rejects.toMatchObject({ code: 'run.invalid' })
    }
    database.prepare("UPDATE revisions SET content = '{}' WHERE revision_id = ?").run(changed.revision.revisionId)
    database.prepare('UPDATE revision_deltas SET patch = ? WHERE revision_id = ?').run('[{"op":"invalid","path":"/"}]', changed.revision.revisionId)
    expect(await create({ text: 'original' }, 'omitted-nullable')).toEqual(run)
  } finally {
    database.close()
  }
})

it.each([false, true])('rejects explicit Live Webhook Runs with Start present: %s, while allowing Draft simulation', async (withStart) => {
  const { api, service } = await fixture()
  const flow = await api.createFlow('Webhook entry', 'webhook-entry')
  const changed = await api.changeDraft(flow.flowId, flow.draftRevisionId, [
    { kind: 'graph.node.create', nodeId: 'webhook', node: { kind: 'webhook', name: 'Webhook', method: 'POST', bodyFields: [] } },
    ...(withStart ? [{ kind: 'graph.node.create' as const, nodeId: 'start', node: { kind: 'start' as const, name: 'Start', inputDefs: [] } }] : []),
  ])
  const operation = await api.publishFlow(flow.flowId, changed.revision.revisionId, null)
  await service.tickMaintenance()
  const published = service.control.publications.getPublishOperation('operator', flow.flowId, operation.operationId)
  if (published.status != 'succeeded') throw new Error('Publication did not succeed')
  const trigger = { nodeId: 'webhook', outputs: { headers: {}, query: {}, body: {}, webhookUrl: 'http://server.local/webhook' } }
  await expect(api.createLiveRun(published.publicationId, { trigger })).rejects.toMatchObject({
    code: 'run.invalid',
    message: 'Live Runs can only be started through a Start node.',
  })
  expect((await api.listRuns(flow.flowId)).runs).toEqual([])
  await expect(api.createDraftRun(flow.flowId, changed.revision.revisionId, { trigger })).resolves.toMatchObject({ source: 'draft' })
  if (withStart) {
    await expect(api.createLiveRun(published.publicationId, { trigger: { nodeId: 'start', outputs: {} } })).resolves.toMatchObject({ source: 'live' })
  }
})

it('rejects a published legacy Manual entry even after its Draft is upgraded to Start', async () => {
  const { api, file, service } = await fixture()
  const flow = await storedLegacy(file, api)
  const operation = await api.publishFlow(flow.flowId, flow.draftRevisionId, null)
  await service.tickMaintenance()
  const published = service.control.publications.getPublishOperation('operator', flow.flowId, operation.operationId)
  if (published.status != 'succeeded') throw new Error('Publication did not succeed')
  const upgraded = await api.upgradeDraft(flow.flowId, flow.draftRevisionId)
  expect((await api.getDraft(flow.flowId)).content.document.graph.nodes.start?.kind).toBe('start')
  await expect(api.createLiveRun(published.publicationId, { trigger: { nodeId: 'start', outputs: {} } })).rejects.toMatchObject({ code: 'run.invalid' })
  expect((await api.listRuns(flow.flowId)).runs).toEqual([])
  await expect(api.createDraftRun(flow.flowId, upgraded.revision.revisionId, { trigger: { nodeId: 'start', outputs: {} } })).resolves.toMatchObject({
    source: 'draft',
  })
})
