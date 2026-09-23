import { expect, it, onTestFinished } from 'vitest'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'
import { openService } from './serviceFixture.ts'

function fixture() {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database)
  const connection = database.connection
  connection
    .prepare(`INSERT INTO flows (flow_id, name, status, draft_revision_id, create_idempotency_key, create_request_digest, created_at, updated_at)
              VALUES ('flow', 'Flow', 'active', 'head', 'create', 'create', 1, 1)`)
    .run()
  const revision = (id: string, at: number) => {
    connection.prepare('INSERT INTO revisions (revision_id, digest, content) VALUES (?, ?, ?)').run(id, id, '{"modelVersion":3}')
    connection
      .prepare(`INSERT INTO flow_revisions (revision_id, flow_id, parent_revision_id, actor_id, created_at, digest, model_version)
                VALUES (?, 'flow', NULL, 'operator', ?, ?, 3)`)
      .run(id, at, id)
  }
  const run = (id: string, revisionId: string, at: number, status = 'completed') => {
    connection
      .prepare(`INSERT INTO runs (run_id, idempotency_key, request_digest, flow_id, revision_id, revision_digest,
                closure_digest, model_version, engine_contract, engine_digest, inputs, source, status, created_at)
                VALUES (?, ?, ?, 'flow', ?, ?, 'closure', 3, 'engine', 'digest', '{}', 'draft', ?, ?) `)
      .run(id, id, id, revisionId, revisionId, status, at)
  }
  revision('head', 0)
  return { connection, revision, run, store }
}

it('keeps the revisions of the latest 50 Draft Runs, including a reused revision', () => {
  const { connection, revision, run, store } = fixture()
  for (let index = 1; index <= 51; index += 1) {
    revision(`revision-${index}`, index)
    run(`run-${index}`, `revision-${index}`, index)
  }
  run('run-52', 'revision-1', 52)

  expect(store.flows.pruneDraftRevisions(100)).toBe(1)
  expect(store.flows.revision('flow', 'revision-1')).toBeDefined()
  expect(store.flows.revision('flow', 'revision-2')).toBeUndefined()
  expect(store.flows.revision('flow', 'revision-3')).toBeDefined()
  expect(store.flows.revision('flow', 'head')).toBeDefined()
  expect(store.runViews.run('run-2')).toMatchObject({ status: 'completed' })
  expect(connection.prepare('SELECT revision_id FROM flow_revisions WHERE revision_id = ?').get('revision-2')).toBeDefined()
})

it('keeps active and published revisions outside the recent Run window', () => {
  const { connection, revision, run, store } = fixture()
  for (const id of ['old', 'active', 'published', 'publishing']) revision(id, 1)
  run('run-old', 'old', 1)
  run('run-active', 'active', 2, 'waiting')
  connection
    .prepare(`INSERT INTO publications (publication_id, flow_id, revision_id, revision_digest, closure_digest, engine_contract,
              idempotency_key, request_digest, actor_id, operation, model_version, created_at)
              VALUES ('published', 'flow', 'published', 'published', 'closure', 'engine', 'publish', 'publish', 'operator', 'publish', 3, 1)`)
    .run()
  connection
    .prepare(`INSERT INTO publish_operations (operation_id, flow_id, revision_id, revision_digest, closure_digest, engine_contract,
              idempotency_key, request_digest, input_json, status, deadline_at, created_at, updated_at, expires_at)
              VALUES ('pending', 'flow', 'publishing', 'publishing', 'closure', 'engine', 'pending', 'pending', '{}', 'pending', 100, 1, 1, 100)`)
    .run()
  for (let index = 1; index <= 50; index += 1) {
    revision(`recent-${index}`, index + 2)
    run(`recent-run-${index}`, `recent-${index}`, index + 2)
  }

  expect(store.flows.pruneDraftRevisions(100)).toBe(1)
  expect(store.flows.revision('flow', 'old')).toBeUndefined()
  for (const id of ['head', 'active', 'published', 'publishing', 'recent-1']) {
    expect(store.flows.revision('flow', id), id).toBeDefined()
  }
})

it('replays an accepted Draft change after its full Revision was pruned', () => {
  const { store } = fixture()
  const first = {
    actorId: 'operator',
    changeId: 'change-1',
    content: '{"modelVersion":3}',
    createdAt: 1,
    digest: 'first',
    expectedRevisionId: 'head',
    flowId: 'flow',
    modelVersion: 3,
    requestDigest: 'request-1',
    revisionId: 'first',
  }
  expect(store.flows.commitRevision(first)).toMatchObject({ kind: 'committed' })
  expect(store.flows.commitRevision({ ...first, changeId: 'change-2', expectedRevisionId: 'first', revisionId: 'second', forceFull: true })).toMatchObject({
    kind: 'committed',
  })
  expect(store.flows.pruneDraftDeltas(100)).toBe(1)
  expect(store.flows.pruneDraftRevisions(100)).toBe(1)
  expect(store.flows.revision('flow', 'first')).toBeUndefined()
  expect(store.flows.commitRevision(first)).toMatchObject({ kind: 'committed', revision: { revisionId: 'first', modelVersion: 3 } })
  expect(store.flows.commitRevision({ ...first, requestDigest: 'different' })).toEqual({ kind: 'request-conflict' })
})

it('returns a pruned Revision as missing while preserving Draft change replay', async () => {
  const service = await openService(':memory:')
  const flow = (await service.control.createFlow('operator', 'Flow', 'create')).flow
  const firstChange = [{ kind: 'graph.node.create', target: { kind: 'flow' }, nodeId: 'first', node: { kind: 'manual', name: 'First' } }] as const
  const first = await service.control.changeDraft('operator', flow.flowId, flow.draftRevisionId, firstChange, 'first-change')
  const second = await service.control.changeDraft(
    'operator',
    flow.flowId,
    first.revision.revisionId,
    [{ kind: 'graph.node.delete', target: { kind: 'flow' }, nodeId: 'first' }],
    'second-change',
  )
  await service.control.repairDraft('operator', flow.flowId, second.revision.revisionId, 'checkpoint')
  await service.tickMaintenance()
  await service.tickMaintenance()

  expect(() => service.control.getRevision(flow.flowId, first.revision.revisionId)).toThrow('The Flow or Revision was not found.')
  expect(await service.control.changeDraft('operator', flow.flowId, flow.draftRevisionId, firstChange, 'first-change')).toEqual(first)
})
