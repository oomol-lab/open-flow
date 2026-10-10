import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { ControlClient } from '@oomol-lab/open-flow/control-api'
import { encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { flow as flowView } from '../node/application/control-views.ts'
import { Database } from '../node/storage/database.ts'
import { migrateFlowResources } from '../node/storage/migrate-flow-resources.ts'
import { Store } from '../node/storage/store.ts'

const empty = { variableNames: [], connections: [], errorSourceFlowIds: [] }

function content(name = 'TOKEN'): RevisionContent {
  return {
    modelVersion: 6,
    modules: {},
    document: {
      bindings: { token: { kind: 'variable', target: name } },
      graph: {
        edges: [],
        nodes: {
          task: {
            kind: 'task',
            description: 'x'.repeat(10_000),
            inputs: { token: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'token' }] } },
            task: { name: 'Send', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'account' } },
          },
        },
      },
    },
  }
}

function body(revision: RevisionContent) {
  const bytes = encodeRevision(revision)
  return { content: new TextDecoder().decode(bytes), digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
}

function create(store: Store, flowId = 'flow', revision = content()) {
  return store.flows.createFlow({
    ...body(revision),
    actorId: 'operator',
    createdAt: 1,
    flowId,
    idempotencyKey: flowId,
    modelVersion: 6,
    name: flowId,
    requestDigest: flowId,
    revisionId: `${flowId}-initial`,
  })
}

function commit(store: Store, revision: RevisionContent, revisionId = 'next', expectedRevisionId = 'flow-initial') {
  return store.flows.commitRevision({
    ...body(revision),
    actorId: 'operator',
    createdAt: 2,
    flowId: 'flow',
    changeId: revisionId,
    modelVersion: 6,
    requestDigest: revisionId,
    revisionId,
    expectedRevisionId,
  })
}

function setup() {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  return { database, store: new Store(database) }
}

it('returns current delta-backed resources in one list/detail query without reading revisions', async () => {
  const { database, store } = setup()
  create(store)
  create(store, 'source')
  database.connection.prepare("INSERT INTO flow_live (flow_id, publication_id, revision, updated_at) VALUES ('source', 'publication', 1, 1)").run()
  const next = content('NEW_TOKEN')
  const changed: RevisionContent = {
    ...next,
    document: {
      ...next.document,
      graph: {
        ...next.document.graph,
        nodes: { ...next.document.graph.nodes, error: { kind: 'error', name: 'Error', sourceFlowIds: ['source'] } },
      },
    },
  }
  expect(commit(store, changed).kind).toBe('committed')
  expect(database.connection.prepare('SELECT revision_id FROM revision_deltas WHERE revision_id = ?').get('next')).toBeDefined()
  const read = vi.spyOn(store.revisions, 'read').mockImplementation(() => {
    throw new Error('List must not read revisions')
  })
  const query = vi.spyOn(database.connection, 'prepare')
  const page = store.flows.list(10)
  expect(query).toHaveBeenCalledTimes(1)
  query.mockClear()
  const stored = store.flows.get('flow')!
  expect(query).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
  expect(flowView(page.flows.find((flow) => flow.flowId == 'flow')!)).toEqual(flowView(stored))
  const expected = { variableNames: ['NEW_TOKEN'], connections: [{ providerId: 'mail', connectionId: 'account' }], errorSourceFlowIds: ['source'] }
  expect(flowView(stored).resourceReferences.draft).toEqual(expected)
  const client = new ControlClient(async () => Response.json({ flows: page.flows.map(flowView), version: 1 }))
  expect((await client.listFlows()).flows.find((flow) => flow.flowId == 'flow')!.resourceReferences.draft).toEqual(expected)
  query.mockRestore()
  read.mockRestore()
  const removed: RevisionContent = { modelVersion: 6, modules: {}, document: { bindings: {}, graph: { nodes: {}, edges: [] } } }
  expect(commit(store, removed, 'removed', 'next').kind).toBe('committed')
  expect(flowView(store.flows.get('flow')!).resourceReferences.draft).toEqual(empty)
})

it('reads shared account changes independently of the draft and keeps them distinct from node selections', () => {
  const { database, store } = setup()
  create(store)
  const insert = database.connection.prepare(`INSERT INTO flow_provider_access
    (flow_id, access_revision, bindings_json, shared_access_digest, provider_ids_json) VALUES (?, ?, ?, ?, ?)`)
  insert.run(
    'flow',
    1,
    JSON.stringify([{ providerId: 'mail', connectionId: 'shared-account', accessBindingId: 'grant', connectionDisplayName: 'Private label' }]),
    'digest',
    '["mail"]',
  )
  const flow = flowView(store.flows.get('flow')!)
  expect(flow.resourceReferences.sharedAccess).toEqual({
    accessRevision: 1,
    providerIds: ['mail'],
    bindings: [{ providerId: 'mail', connectionId: 'shared-account', accessBindingId: 'grant' }],
  })
  expect(flow.resourceReferences.draft!.connections).toEqual([{ providerId: 'mail', connectionId: 'account' }])
  database.connection.prepare("UPDATE flow_provider_access SET access_revision = 2, bindings_json = '[]' WHERE flow_id = 'flow'").run()
  const next = flowView(store.flows.list(10).flows[0]!)
  expect(next.draftRevisionId).toBe(flow.draftRevisionId)
  expect(next.resourceReferences.sharedAccess).toEqual({ accessRevision: 2, providerIds: ['mail'], bindings: [] })
})

it('keeps the previous summary on a conflicting or rolled-back draft write', () => {
  const { database, store } = setup()
  create(store)
  const original = flowView(store.flows.get('flow')!)
  expect(commit(store, content('CHANGED'), 'conflict', 'stale').kind).toBe('conflict')
  database.connection.exec(`CREATE TRIGGER reject_draft BEFORE UPDATE OF draft_revision_id ON flows
    BEGIN SELECT RAISE(ABORT, 'rejected'); END`)
  expect(() => commit(store, content('CHANGED'))).toThrow('rejected')
  expect(flowView(store.flows.get('flow')!)).toEqual(original)
  expect(database.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'next'").get()).toBeUndefined()
})

it('backfills delta heads on upgrade and preserves unavailable summaries for damaged drafts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'flow-resources-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  const old = Database.open(file)
  const store = new Store(old)
  create(store)
  create(store, 'damaged')
  expect(commit(store, content('LATEST')).kind).toBe('committed')
  old.connection.prepare("UPDATE revisions SET content = '{}' WHERE revision_id = 'damaged-initial'").run()
  old.connection.exec('ALTER TABLE flows DROP COLUMN draft_resource_references')
  old.transaction(() => migrateFlowResources(old.connection))
  old.close()
  const upgraded = Database.open(file)
  onTestFinished(() => upgraded.close())
  const restored = new Store(upgraded)
  expect(flowView(restored.flows.get('flow')!).resourceReferences.draft!.variableNames).toEqual(['LATEST'])
  expect(flowView(restored.flows.get('damaged')!).resourceReferences.draft).toBeNull()
  expect(upgraded.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'next'").get()).toBeDefined()
})

function publishFixture(database: Database, flowId: string, revisionId: string, publicationId: string, enabled = 1) {
  database.connection
    .prepare(`INSERT INTO publications (publication_id, flow_id, revision_id, revision_digest, closure_digest, engine_contract,
    idempotency_key, request_digest, actor_id, operation, model_version, created_at)
    VALUES (?, ?, ?, 'digest', 'closure', 'engine', ?, ?, 'operator', 'publish', 6, 1)`)
    .run(publicationId, flowId, revisionId, publicationId, publicationId)
  database.connection
    .prepare(`INSERT INTO flow_live (flow_id, publication_id, revision, updated_at, enabled) VALUES (?, ?, 1, 1, ?)
    ON CONFLICT(flow_id) DO UPDATE SET publication_id = excluded.publication_id, enabled = excluded.enabled`)
    .run(flowId, publicationId, enabled)
}

it('combines draft and current publication references and follows publication replacement and rollback', () => {
  const { database, store } = setup()
  create(store)
  publishFixture(database, 'flow', 'flow-initial', 'original', 0)
  const reference = { flowId: 'flow', flowName: 'flow', draft: true, live: { publicationId: 'original', enabled: false } }
  expect(store.flows.variableReferences('operator', 'TOKEN')).toEqual({ version: 1, references: [reference], unknown: [] })
  expect(commit(store, content('OTHER')).kind).toBe('committed')
  expect(store.flows.variableReferences('operator', 'TOKEN').references).toEqual([{ ...reference, draft: false }])
  expect(store.flows.variableReferences('operator', 'OTHER').references).toEqual([{ ...reference, live: null }])
  publishFixture(database, 'flow', 'next', 'replacement')
  expect(store.flows.variableReferences('operator', 'TOKEN').references).toEqual([])
  publishFixture(database, 'flow', 'flow-initial', 'rollback')
  expect(store.flows.variableReferences('operator', 'TOKEN').references).toEqual([
    { ...reference, draft: false, live: { publicationId: 'rollback', enabled: true } },
  ])
  expect(store.flows.variableReferences('operator', 'token').references).toEqual([])
})

it('isolates owners, excludes retiring flows, and returns all matches beyond catalog page sizes', () => {
  const { database, store } = setup()
  for (let index = 0; index < 105; index++) create(store, `flow-${String(index).padStart(3, '0')}`)
  create(store, 'foreign')
  database.connection.prepare("UPDATE flows SET owner_id = 'someone-else' WHERE flow_id = 'foreign'").run()
  create(store, 'retiring')
  database.connection.prepare("UPDATE flows SET status = 'retiring' WHERE flow_id = 'retiring'").run()
  const result = store.flows.variableReferences('operator', 'TOKEN')
  expect(result.references).toHaveLength(105)
  expect(result.references.map((item) => item.flowId)).toEqual(Array.from({ length: 105 }, (_, i) => `flow-${String(i).padStart(3, '0')}`))
  expect(store.flows.variableReferences('someone-else', 'TOKEN').references.map((item) => item.flowId)).toEqual(['foreign'])
})

it('reports unknown versions separately and reuses a shared publication revision within one query', () => {
  const { database, store } = setup()
  create(store, 'a')
  create(store, 'b')
  publishFixture(database, 'a', 'a-initial', 'a-live')
  publishFixture(database, 'b', 'a-initial', 'b-live')
  database.connection.prepare("UPDATE flows SET draft_resource_references = NULL WHERE flow_id = 'a'").run()
  const read = vi.spyOn(store.revisions, 'read')
  expect(store.flows.variableReferences('operator', 'TOKEN')).toMatchObject({
    references: [
      { flowId: 'a', draft: false },
      { flowId: 'b', draft: true },
    ],
    unknown: [{ flowId: 'a', flowName: 'a', scope: 'draft' }],
  })
  expect(read).toHaveBeenCalledTimes(1)
  database.connection.prepare("UPDATE revisions SET content = '{}' WHERE revision_id = 'a-initial'").run()
  expect(store.flows.variableReferences('operator', 'MISSING')).toEqual({
    version: 1,
    references: [],
    unknown: [
      { flowId: 'a', flowName: 'a', scope: 'draft' },
      { flowId: 'a', flowName: 'a', scope: 'live' },
      { flowId: 'b', flowName: 'b', scope: 'live' },
    ],
  })
  expect(read).toHaveBeenCalledTimes(2)
  read.mockRestore()
})
