import type { JsonValue } from '@oomol-lab/open-flow/flow-change'

import { canonicalJsonBytes } from '@oomol-lab/open-flow/flow-encoding'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, onTestFinished } from 'vitest'
import { Database } from '../node/storage/database.ts'
import { applyRevisionPatch, createRevisionPatch } from '../node/storage/revision-delta.ts'
import { Store } from '../node/storage/store.ts'
import { closeService, openService } from './serviceFixture.ts'

function body(value: JsonValue) {
  const content = new TextDecoder().decode(canonicalJsonBytes(value))
  const digest = `sha256:${createHash('sha256').update(content).digest('hex')}`
  return { content, digest }
}

function flow(store: Store, value: JsonValue) {
  const { content, digest } = body(value)
  store.flows.createFlow({
    actorId: 'operator',
    content,
    createdAt: 1,
    digest,
    flowId: 'flow',
    idempotencyKey: 'create',
    modelVersion: 3,
    name: 'Flow',
    requestDigest: 'create',
    revisionId: 'initial',
  })
}

it('applies deterministic patches for nested objects, arrays, null, and escaped keys', () => {
  const before = body({ 'entries': [{ value: 1 }, { value: 2 }], 'nested': { old: null }, 'a/b~c': 'before' }).content
  const after = body({ 'entries': [{ value: 2 }], 'nested': { next: true }, 'a/b~c': 'after' }).content
  const patch = createRevisionPatch(before, after)
  expect(body(applyRevisionPatch(before, patch)).content).toBe(after)
  expect(createRevisionPatch(before, after)).toBe(patch)
  expect(() => applyRevisionPatch(before, '[{"op":"add","path":"/__proto__/polluted","value":true}]')).toThrow()
  expect(() => applyRevisionPatch(before, '[{"op":"move","path":"/nested","from":"/entries"}]')).toThrow()
})

it('stores small edits as deltas, checkpoints after 32 edits, and restores them after restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'revision-deltas-'))
  onTestFinished(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'flow.sqlite')
  const database = Database.open(file)
  const store = new Store(database)
  const padding = 'x'.repeat(20_000)
  flow(store, { counter: 0, padding })
  let previous = 'initial'
  const expected = new Map<string, ReturnType<typeof body>>()
  for (let index = 1; index <= 33; index += 1) {
    const next = body({ counter: index, padding })
    const revisionId = `revision-${index}`
    expect(
      store.flows.commitRevision({
        actorId: 'operator',
        changeId: `change-${index}`,
        content: next.content,
        createdAt: index + 1,
        digest: next.digest,
        expectedRevisionId: previous,
        flowId: 'flow',
        modelVersion: 3,
        requestDigest: `request-${index}`,
        revisionId,
      }),
    ).toMatchObject({ kind: 'committed' })
    expected.set(revisionId, next)
    previous = revisionId
  }
  expect(database.connection.prepare('SELECT COUNT(*) AS count FROM revision_deltas').get()).toEqual({ count: 32 })
  expect(database.connection.prepare('SELECT COUNT(*) AS count FROM revisions').get()).toEqual({ count: 2 })
  const written = database.connection.prepare('SELECT SUM(length(patch)) AS bytes FROM revision_deltas').get() as { bytes: number }
  expect(written.bytes).toBeLessThan(body({ counter: 0, padding }).content.length)
  database.close()

  const reopened = Database.open(file)
  try {
    const restored = new Store(reopened)
    for (const [revisionId, revision] of expected) expect(restored.flows.revision('flow', revisionId)).toMatchObject(revision)
    expect(restored.flows.draft('flow')).toMatchObject(expected.get('revision-33')!)
    for (let index = 0; index < 32; index += 1) expect(restored.flows.pruneDraftDeltas(100)).toBe(1)
    expect(restored.flows.pruneDraftRevisions(100)).toBe(1)
    expect(restored.flows.revision('flow', 'revision-1')).toBeUndefined()
    expect(restored.flows.draft('flow')).toMatchObject(expected.get('revision-33')!)
  } finally {
    reopened.close()
  }
})

it('materializes a Draft Revision atomically when admitting a Run', () => {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database)
  const padding = 'x'.repeat(10_000)
  flow(store, { counter: 0, padding })
  const revision = body({ counter: 1, padding })
  store.flows.commitRevision({
    actorId: 'operator',
    changeId: 'change',
    content: revision.content,
    createdAt: 2,
    digest: revision.digest,
    expectedRevisionId: 'initial',
    flowId: 'flow',
    modelVersion: 3,
    requestDigest: 'change',
    revisionId: 'draft',
  })
  expect(database.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'draft'").get()).toBeDefined()
  expect(
    store.runs.acceptControlRun({
      closureDigest: 'closure',
      flowId: 'flow',
      idempotencyKey: 'run',
      inputs: {},
      modelVersion: 3,
      requestDigest: 'run',
      revisionDigest: revision.digest,
      revisionId: 'draft',
      trigger: { nodeId: 'start', outputs: {} },
      variableNames: [],
    }),
  ).toMatchObject({ kind: 'accepted' })
  expect(database.connection.prepare("SELECT content FROM revisions WHERE revision_id = 'draft'").get()).toEqual({ content: revision.content })
  expect(database.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'draft'").get()).toBeUndefined()
})

it('materializes a Draft Revision when admitting a Publish operation and rolls back a failed admission', () => {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database, () => 1_000)
  const padding = 'x'.repeat(10_000)
  flow(store, { counter: 0, padding })
  const revision = body({ counter: 1, padding })
  store.flows.commitRevision({
    actorId: 'operator',
    changeId: 'change',
    content: revision.content,
    createdAt: 2,
    digest: revision.digest,
    expectedRevisionId: 'initial',
    flowId: 'flow',
    modelVersion: 3,
    requestDigest: 'change',
    revisionId: 'draft',
  })
  const input = {
    closureDigest: 'closure',
    content: revision.content,
    crons: [],
    engineContract: 'open-flow-engine/v5',
    expectedLivePublicationId: null,
    flowId: 'flow',
    idempotencyKey: 'publish',
    integrations: [],
    polls: [],
    publishedAt: 1_000,
    requestDigest: 'publish',
    revisionDigest: revision.digest,
    revisionId: 'draft',
    variableNames: [],
    webhooks: [],
  }
  database.connection.exec("CREATE TRIGGER reject_publish BEFORE INSERT ON publish_operations BEGIN SELECT RAISE(ABORT, 'write failed'); END")
  expect(() => store.publications.acceptPublishOperation(input)).toThrow('write failed')
  expect(database.connection.prepare("SELECT 1 FROM revisions WHERE revision_id = 'draft'").get()).toBeUndefined()
  expect(database.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'draft'").get()).toBeDefined()
  database.connection.exec('DROP TRIGGER reject_publish')

  expect(store.publications.acceptPublishOperation(input)).toMatchObject({ kind: 'accepted' })
  expect(database.connection.prepare("SELECT content FROM revisions WHERE revision_id = 'draft'").get()).toEqual({ content: revision.content })
  expect(database.connection.prepare("SELECT 1 FROM revision_deltas WHERE revision_id = 'draft'").get()).toBeUndefined()
})

it('rejects a damaged delta without accepting a Run', () => {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database)
  const padding = 'x'.repeat(10_000)
  flow(store, { counter: 0, padding })
  const revision = body({ counter: 1, padding })
  store.flows.commitRevision({
    actorId: 'operator',
    changeId: 'change',
    content: revision.content,
    createdAt: 2,
    digest: revision.digest,
    expectedRevisionId: 'initial',
    flowId: 'flow',
    modelVersion: 3,
    requestDigest: 'change',
    revisionId: 'draft',
  })
  database.connection.prepare('UPDATE revision_deltas SET patch = \'[{"op":"replace","path":"/counter","value":2}]\' WHERE revision_id = \'draft\'').run()
  expect(() => store.flows.draft('flow')).toThrow('Stored Revision delta does not match its digest.')
  expect(() =>
    store.runs.acceptControlRun({
      closureDigest: 'closure',
      flowId: 'flow',
      idempotencyKey: 'run',
      inputs: {},
      modelVersion: 3,
      requestDigest: 'run',
      revisionDigest: revision.digest,
      revisionId: 'draft',
      trigger: { nodeId: 'start', outputs: {} },
      variableNames: [],
    }),
  ).toThrow('Stored Revision delta does not match its digest.')
  expect(database.connection.prepare('SELECT COUNT(*) AS count FROM runs').get()).toEqual({ count: 0 })
})

it('repairs an unreadable delta as a new full Revision without changing the old one', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'revision-delta-repair-'))
  const file = path.join(directory, 'flow.sqlite')
  const service = await openService(file)
  onTestFinished(async () => {
    await closeService(service)
    await rm(directory, { recursive: true, force: true })
  })
  const created = await service.control.createFlow('operator', 'Flow', 'create')
  const changed = await service.control.changeDraft(
    'operator',
    created.flow.flowId,
    created.flow.draftRevisionId,
    [{ kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'start', node: { kind: 'manual', name: 'Start' } }],
    'change',
  )
  const database = new DatabaseSync(file)
  try {
    database.prepare("UPDATE revision_deltas SET patch = '[]' WHERE revision_id = ?").run(changed.revision.revisionId)
    expect(database.prepare('SELECT patch FROM revision_deltas WHERE revision_id = ?').get(changed.revision.revisionId)).toEqual({ patch: '[]' })
    const repaired = await service.control.repairDraft('operator', created.flow.flowId, changed.revision.revisionId, 'repair')
    expect(repaired.revision.parentRevisionId).toBe(changed.revision.revisionId)
    expect(database.prepare('SELECT content FROM revisions WHERE revision_id = ?').get(repaired.revision.revisionId)).toBeDefined()
    expect(database.prepare('SELECT patch FROM revision_deltas WHERE revision_id = ?').get(changed.revision.revisionId)).toEqual({ patch: '[]' })
    expect(service.control.getDraft(created.flow.flowId).revisionId).toBe(repaired.revision.revisionId)
  } finally {
    database.close()
  }
})

it('collects orphan deltas before their full base after a Flow is deleted', () => {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database)
  const padding = 'x'.repeat(10_000)
  flow(store, { counter: 0, padding })
  const revision = body({ counter: 1, padding })
  store.flows.commitRevision({
    actorId: 'operator',
    changeId: 'change',
    content: revision.content,
    createdAt: 2,
    digest: revision.digest,
    expectedRevisionId: 'initial',
    flowId: 'flow',
    modelVersion: 3,
    requestDigest: 'change',
    revisionId: 'draft',
  })
  store.flows.retire('flow', 3)
  expect(store.flows.delete('flow')).toBe(true)
  expect(store.flows.collectOrphanRevisions(100)).toBe(0)
  expect(store.flows.collectOrphanDeltas(100)).toBe(1)
  expect(store.flows.collectOrphanRevisions(100)).toBe(1)
  expect(store.revisions.read('draft')).toBeUndefined()
})
