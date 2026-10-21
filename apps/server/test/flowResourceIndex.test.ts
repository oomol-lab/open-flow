import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { encodeRevision } from '@oomol-lab/open-flow/flow-encoding'
import { currentEngineContract } from '@oomol-lab/open-flow/runtime-contract'
import { createHash } from 'node:crypto'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Database } from '../node/storage/database.ts'
import * as resources from '../node/storage/flow-resources.ts'
import { migrateFlowResourceReferences } from '../node/storage/migrate-flow-resource-references.ts'
import { RevisionStore } from '../node/storage/revision-store.ts'
import { Store } from '../node/storage/store.ts'

function content(name: string): RevisionContent {
  return {
    modelVersion: 6,
    modules: {},
    document: {
      bindings: { value: { kind: 'variable', target: name } },
      graph: {
        edges: [],
        nodes: {
          task: {
            kind: 'task',
            description: 'x'.repeat(10_000),
            task: { name: 'Task', inputs: [], outputs: [], executor: { kind: 'connector', action: 'mail.send', connectionId: 'account' } },
            inputs: { value: { kind: 'sources', sources: [{ kind: 'binding', bindingId: 'value' }] } },
          },
        },
      },
    },
  }
}
function body(name: string) {
  const bytes = encodeRevision(content(name))
  return { content: new TextDecoder().decode(bytes), digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` }
}
function setup() {
  const database = Database.open(':memory:')
  const store = new Store(database)
  onTestFinished(() => {
    vi.restoreAllMocks()
    database.close()
  })
  const initial = body('TOKEN')
  store.flows.createFlow({
    ...initial,
    actorId: 'owner',
    createdAt: 1,
    flowId: 'flow',
    idempotencyKey: 'flow',
    modelVersion: 6,
    name: 'Flow',
    requestDigest: 'flow',
    revisionId: 'initial',
  })
  store.variables.put('owner', 'TOKEN', 'token')
  store.variables.put('owner', 'OTHER', 'other')
  const commit = (name = 'OTHER', revisionId = 'next', expectedRevisionId = 'initial', forceFull = false) =>
    store.flows.commitRevision({
      ...body(name),
      actorId: 'owner',
      changeId: revisionId,
      createdAt: 2,
      flowId: 'flow',
      modelVersion: 6,
      requestDigest: revisionId,
      revisionId,
      expectedRevisionId,
      forceFull,
    })
  const input = {
    interface: { inputs: null, outputs: null },
    content: initial.content,
    revisionDigest: initial.digest,
    revisionId: 'initial',
    flowId: 'flow',
    closureDigest: 'closure',
    engineContract: currentEngineContract,
    expectedLivePublicationId: null,
    idempotencyKey: 'publish',
    requestDigest: 'publish',
    publishedAt: 2,
    variableNames: ['TOKEN'],
    crons: [],
    polls: [],
    integrations: [],
    webhooks: [],
    metadata: { actorId: 'owner', operation: 'publish' as const, modelVersion: 6 },
  }
  return { database, store, commit, input }
}

it('extracts a new Draft once without reading or materializing revisions', () => {
  const read = vi.spyOn(RevisionStore.prototype, 'read')
  const materialize = vi.spyOn(RevisionStore.prototype, 'materialize')
  const extract = vi.spyOn(resources, 'revisionResourceReferences')
  setup()
  expect(read).not.toHaveBeenCalled()
  expect(materialize).not.toHaveBeenCalled()
  expect(extract).toHaveBeenCalledTimes(1)
})

it('extracts once and preserves the existing two old-revision reads and delta storage on commit', () => {
  const { database, store, commit } = setup()
  const read = vi.spyOn(store.revisions, 'read')
  const materialize = vi.spyOn(store.revisions, 'materialize')
  const extract = vi.spyOn(resources, 'revisionResourceReferences')
  expect(commit().kind).toBe('committed')
  // Existing error-source validation and saveDraft each read the old revision.
  expect(read.mock.calls.map(([id]) => id)).toEqual(['initial', 'initial'])
  expect(extract).toHaveBeenCalledTimes(1)
  expect(materialize).not.toHaveBeenCalled()
  expect(database.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'next'").get()).toBeDefined()
  expect(database.connection.prepare("SELECT 1 FROM revisions WHERE revision_id = 'next'").get()).toBeUndefined()
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references).toEqual([])
  expect(store.resourceReferences.variableReferences('owner', 'OTHER').references).toHaveLength(1)
  read.mockClear()
  extract.mockClear()
  expect(commit().kind).toBe('committed')
  expect(commit('TOKEN', 'conflict').kind).toBe('conflict')
  expect(read).not.toHaveBeenCalled()
  expect(extract).not.toHaveBeenCalled()
  expect(commit('TOKEN', 'repaired', 'next', true).kind).toBe('committed')
  expect(read).not.toHaveBeenCalled()
  expect(extract).toHaveBeenCalledTimes(1)
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references).toHaveLength(1)
})

it('rolls back the Draft head, summary and delta when updating its reference index fails', () => {
  const { database, store, commit } = setup()
  const before = store.flows.get('flow')
  database.connection.exec(
    "CREATE TRIGGER reject_draft_index BEFORE INSERT ON flow_resource_references WHEN NEW.scope = 'draft' BEGIN SELECT RAISE(ABORT, 'rejected'); END",
  )
  expect(() => commit()).toThrow('rejected')
  expect(store.flows.get('flow')).toEqual(before)
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references).toHaveLength(1)
  expect(store.resourceReferences.variableReferences('owner', 'OTHER').references).toEqual([])
  expect(database.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'next'").get()).toBeUndefined()
  expect(store.flows.change('flow', 'next')).toBeUndefined()
  database.connection.exec('DROP TRIGGER reject_draft_index')
  expect(commit().kind).toBe('committed')
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references).toEqual([])
  expect(store.resourceReferences.variableReferences('owner', 'OTHER').references).toHaveLength(1)
})

it('indexes publication targets and rollback atomically without extra revision reads', () => {
  const { database, store, commit, input } = setup()
  const read = vi.spyOn(store.revisions, 'read')
  const first = store.publications.publish(input)
  expect(first.kind).toBe('published')
  if (first.kind != 'published') throw new Error('Publication missing')
  expect(read.mock.calls.map(([id]) => id)).toEqual(['initial', 'initial'])
  expect(commit().kind).toBe('committed')
  const next = body('OTHER')
  const secondInput = {
    ...input,
    content: next.content,
    revisionDigest: next.digest,
    revisionId: 'next',
    variableNames: ['OTHER'],
    idempotencyKey: 'second',
    requestDigest: 'second',
    expectedLivePublicationId: first.publicationId,
  }
  database.connection.exec(
    "CREATE TRIGGER reject_index BEFORE INSERT ON flow_resource_references WHEN NEW.scope = 'live' BEGIN SELECT RAISE(ABORT, 'rejected'); END",
  )
  expect(() => store.publications.publish(secondInput)).toThrow('rejected')
  expect(store.publications.live('flow')?.publication.publicationId).toBe(first.publicationId)
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references[0]?.live?.publicationId).toBe(first.publicationId)
  database.connection.exec('DROP TRIGGER reject_index')
  const second = store.publications.publish(secondInput)
  if (second.kind != 'published') throw new Error('Second publication missing')
  read.mockClear()
  const rollbackInput = {
    ...input,
    idempotencyKey: 'rollback',
    requestDigest: 'rollback',
    expectedLivePublicationId: second.publicationId,
    metadata: { ...input.metadata, operation: 'rollback' as const, sourcePublicationId: first.publicationId },
  }
  const rollback = store.publications.publish(rollbackInput)
  if (rollback.kind != 'published') throw new Error('Rollback missing')
  expect(read.mock.calls.map(([id]) => id)).toEqual(['initial', 'initial'])
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references).toEqual([
    { flowId: 'flow', flowName: 'Flow', draft: false, live: { publicationId: rollback.publicationId, enabled: true } },
  ])
  expect(store.resourceReferences.variableReferences('owner', 'OTHER').references[0]).toMatchObject({ draft: true, live: null })
  read.mockClear()
  expect(store.publications.publish(rollbackInput)).toMatchObject({ created: false })
  expect(read).not.toHaveBeenCalled()
})

it('counts distinct active owned Flows in one indexed statement and retains references across variable deletion', () => {
  const { database, store, input } = setup()
  const publication = store.publications.publish(input)
  if (publication.kind != 'published') throw new Error('Publication missing')
  store.flows.setEnabled('flow', publication.publicationId, false)
  const read = vi.spyOn(store.revisions, 'read').mockImplementation(() => {
    throw new Error('No revision reads')
  })
  const prepare = vi.spyOn(database.connection, 'prepare')
  expect(store.variables.list('owner').map(({ name, referenceCount }) => [name, referenceCount])).toEqual([
    ['OTHER', 0],
    ['TOKEN', 1],
  ])
  expect(prepare).toHaveBeenCalledTimes(1)
  const sql = prepare.mock.calls[0]![0]
  const plan = database.connection.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('owner')
  expect(plan.some((row) => String(row.detail).includes('flow_resource_reference_target'))).toBe(true)
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references[0]?.live?.enabled).toBe(false)
  expect(store.variables.list('other-owner')).toEqual([])
  store.variables.delete('owner', 'TOKEN')
  store.variables.put('owner', 'TOKEN', 'new')
  expect(store.variables.list('owner').find((v) => v.name == 'TOKEN')?.referenceCount).toBe(1)
  store.flows.retire('flow', 4)
  expect(store.variables.list('owner').every((v) => v.referenceCount == 0)).toBe(true)
  expect(database.connection.prepare('SELECT * FROM flow_resource_references').all()).toEqual([])
  expect(read).not.toHaveBeenCalled()
})

it('backfills Draft summaries without reads and reuses Live results without materializing delta revisions', () => {
  const { database, store, commit, input } = setup()
  expect(commit().kind).toBe('committed')
  // A Live pointing to the old full revision, plus another Flow sharing that Live revision.
  const first = store.publications.publish({ ...input, metadata: undefined })
  if (first.kind != 'published') throw new Error('Publication missing')
  store.flows.createFlow({
    ...body('OTHER'),
    actorId: 'owner',
    createdAt: 1,
    flowId: 'second',
    idempotencyKey: 'second',
    modelVersion: 6,
    name: 'Second',
    requestDigest: 'second',
    revisionId: 'second-draft',
  })
  database.connection.prepare('INSERT INTO flow_live (flow_id, publication_id, revision, updated_at) VALUES (?, ?, 1, 1)').run('second', first.publicationId)
  const read = vi.spyOn(RevisionStore.prototype, 'read')
  const materialize = vi.spyOn(RevisionStore.prototype, 'materialize')
  database.connection.exec('DROP TABLE flow_resource_references')
  database.transaction(() => migrateFlowResourceReferences(database.connection))
  expect(read.mock.calls.map(([id]) => id)).toEqual(['initial'])
  expect(materialize).not.toHaveBeenCalled()
  expect(database.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'next'").get()).toBeDefined()
  expect(database.connection.prepare("SELECT 1 FROM revisions WHERE revision_id = 'next'").get()).toBeUndefined()
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references).toHaveLength(2)
  // Unreadable shared Live is cached too; a null Draft summary never triggers a read.
  database.connection.prepare("UPDATE revisions SET content = '{}' WHERE revision_id = 'initial'").run()
  database.connection.prepare("UPDATE flows SET draft_resource_references = NULL WHERE flow_id = 'flow'").run()
  database.connection.exec('DROP TABLE flow_resource_references')
  read.mockClear()
  database.transaction(() => migrateFlowResourceReferences(database.connection))
  expect(read.mock.calls.map(([id]) => id)).toEqual(['initial'])
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references).toEqual([])
  expect(store.resourceReferences.variableReferences('owner', 'OTHER').references.map((r) => r.flowId)).toEqual(['second'])
})

it('uses an existing Draft summary for matching Live and only reads Live when that summary is absent', () => {
  const { database, store, input } = setup()
  store.publications.publish(input)
  const read = vi.spyOn(RevisionStore.prototype, 'read')
  database.connection.exec('DROP TABLE flow_resource_references')
  database.transaction(() => migrateFlowResourceReferences(database.connection))
  expect(read).not.toHaveBeenCalled()
  database.connection.exec('DROP TABLE flow_resource_references; UPDATE flows SET draft_resource_references = NULL')
  database.transaction(() => migrateFlowResourceReferences(database.connection))
  expect(read.mock.calls.map(([id]) => id)).toEqual(['initial'])
  expect(store.resourceReferences.variableReferences('owner', 'TOKEN').references[0]).toMatchObject({ draft: false, live: { enabled: true } })
})

it('counts only requested workflow targets with indexed lookups, owner isolation and merged scopes', () => {
  const { database, store } = setup()
  const initial = body('TOKEN')
  for (const [flowId, actorId] of [
    ['other', 'owner'],
    ['foreign', 'foreign-owner'],
  ]) {
    store.flows.createFlow({
      ...initial,
      actorId: actorId!,
      createdAt: 2,
      flowId: flowId!,
      idempotencyKey: flowId!,
      modelVersion: 6,
      name: flowId!,
      requestDigest: flowId!,
      revisionId: `${flowId}-initial`,
    })
  }
  const references = store.resourceReferences
  references.replaceResources('owner', 'flow', 'draft', { variableNames: ['target'], calledFlowIds: ['target', 'target', 'off-page'] })
  references.replaceResources('owner', 'flow', 'live', { variableNames: [], calledFlowIds: ['target'] })
  references.replaceResources('owner', 'other', 'draft', { variableNames: [], calledFlowIds: ['target'] })
  references.replaceResources('foreign-owner', 'foreign', 'draft', { variableNames: [], calledFlowIds: ['target'] })
  const prepare = vi.spyOn(database.connection, 'prepare')
  expect(references.incomingFlowCounts([]).size).toBe(0)
  expect(prepare).not.toHaveBeenCalled()
  expect(
    references.incomingFlowCounts([
      { ownerId: 'owner', flowId: 'target' },
      { ownerId: 'owner', flowId: 'empty' },
    ]),
  ).toEqual(new Map([['target', 2]]))
  expect(prepare).toHaveBeenCalledTimes(1)
  const sql = prepare.mock.calls[0]![0]
  const plan = database.connection.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('owner', 'target', 'owner', 'empty') as { detail: string }[]
  expect(
    plan.some(({ detail }) =>
      /SEARCH r USING COVERING INDEX flow_resource_reference_target \(owner_id=\? AND relation_kind=\? AND target_key=\?\)/.test(detail),
    ),
  ).toBe(true)
  references.replaceResources('owner', 'flow', 'draft', null)
  expect(references.incomingFlowCounts([{ ownerId: 'owner', flowId: 'target' }]).get('target')).toBe(2)
  references.replaceResources('owner', 'flow', 'live', null)
  expect(references.incomingFlowCounts([{ ownerId: 'owner', flowId: 'target' }]).get('target')).toBe(1)
  store.flows.retire('other', 3)
  expect(references.incomingFlowCounts([{ ownerId: 'owner', flowId: 'target' }]).size).toBe(0)
  expect(references.incomingFlowCounts([{ ownerId: 'foreign-owner', flowId: 'target' }]).get('target')).toBe(1)
})
