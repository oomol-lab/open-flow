import type { ConnectorAccess, ConnectorAccessSnapshot } from '@oomol-lab/open-flow/control-api'

import { expect, it, onTestFinished } from 'vitest'
import { publication as publicationView } from '../node/application/control-views.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'

function fixture(providerAccess?: ConnectorAccess) {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database, () => 1_000)
  if (providerAccess != null)
    database.connection
      .prepare('INSERT INTO flow_provider_access (flow_id, access_revision, bindings_json, shared_access_digest) VALUES (?, ?, ?, ?)')
      .run('flow', providerAccess.accessRevision, JSON.stringify(providerAccess.bindings), providerAccess.sharedAccessDigest)
  store.flows.createFlow({
    actorId: 'operator',
    content: '{"modelVersion":2}',
    createdAt: 1_000,
    digest: 'digest',
    flowId: 'flow',
    idempotencyKey: 'flow',
    modelVersion: 2,
    name: 'Flow',
    requestDigest: 'flow',
    revisionId: 'revision',
  })
  const input = {
    closureDigest: 'closure',
    content: '{"modelVersion":2}',
    crons: [],
    expectedLivePublicationId: null,
    engineContract: 'open-flow-engine/v5',
    flowId: 'flow',
    idempotencyKey: 'publish',
    integrations: [
      {
        connectionId: 'connection',
        reconcileAt: 2_000,
        triggerJson: '{"kind":"integration","definition":{"key":"stripe.on_event"}}',
        triggerNodeId: 'integration',
      },
    ],
    polls: [{ connectionId: 'connection', nextAt: 2_000, scheduleJson: '[]', triggerJson: '{"kind":"poll"}', triggerNodeId: 'poll' }],
    providerAccess:
      providerAccess == null
        ? undefined
        : ({
            version: 2,
            mode: providerAccess.mode,
            sharedAccessDigest: providerAccess.sharedAccessDigest,
            sharedBindings: providerAccess.bindings.map((binding) => ({
              accessBindingId: binding.accessBindingId,
              connectionId: binding.connectionId,
              providerId: binding.providerId,
              source: binding.source,
              connectionDisplayName: binding.connectionDisplayName,
              permissionGroupName: binding.permissionGroupName,
            })),
            selectedBindings: [],
          } as ConnectorAccessSnapshot),
    publishedAt: 1_000,
    requestDigest: 'publish',
    revisionDigest: 'digest',
    revisionId: 'revision',
    variableNames: [],
    webhooks: [],
  }
  const accepted = store.publications.acceptPublishOperation(input)
  if (accepted.kind != 'accepted') throw new Error('Publish was not accepted.')
  const operationId = accepted.operation.operationId
  const poll = store.polls.candidate(operationId, 'poll')
  const integration = store.integrations.candidate(operationId, 'integration')
  if (poll == null || integration == null) throw new Error('Candidates were not created.')
  store.integrations.initializeCandidate(integration, {}, {}, 1_000)
  return { database: database.connection, store, input: { ...input, operationId }, poll, integration }
}

const selectedAccess: ConnectorAccess = {
  version: 1,
  mode: 'selectable',
  accessRevision: 1,
  sharedAccessDigest: 'selected',
  bindings: [
    {
      connectionId: 'fixture-account',
      source: { kind: 'policy' as const, ruleId: null },
      providerId: 'stripe',
      accessBindingId: 'binding',
      connectionDisplayName: 'Stripe',
      permissionGroupName: null,
      status: 'active',
    },
  ],
}

it.each(['publish', 'acceptPublishOperation'] as const)(
  'rejects stale access in the %s transaction without persisting candidates or publications',
  (method) => {
    const { database, store, input } = fixture(selectedAccess)
    database.prepare('UPDATE flow_provider_access SET shared_access_digest = ?').run('changed')
    const result = store.publications[method]({ ...input, operationId: undefined, idempotencyKey: 'stale', requestDigest: 'stale' }, () => {
      expect(database.isTransaction).toBe(true)
      const row = database.prepare('SELECT shared_access_digest AS digest FROM flow_provider_access').get() as { digest: string }
      return { ...selectedAccess, sharedAccessDigest: row.digest }
    })
    expect(result).toEqual({ kind: 'access-conflict' })
    expect(database.prepare('SELECT COUNT(*) AS count FROM publications').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM publish_operations').get()).toEqual({ count: 1 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM integration_candidates').get()).toEqual({ count: 1 })
  },
)

it('keeps accepted operation and cleanup snapshots fixed when Draft access changes', () => {
  const { database, store, input, poll, integration } = fixture(selectedAccess)
  database.prepare('UPDATE flow_provider_access SET shared_access_digest = ?').run('changed')
  store.polls.completeCandidate(poll, '{}', false, 1_000)
  store.integrations.markCandidateReady(integration, 1_000)
  expect(JSON.parse(store.integrations.candidate(input.operationId, 'integration')!.providerAccessJson)).toEqual(input.providerAccess)
  const result = store.publications.publish(input)
  expect(result.kind).toBe('published')
  if (result.kind != 'published') throw new Error('Publication was not committed.')
  expect(store.publications.providerAccess(result.publicationId)).toEqual(input.providerAccess)
  const rollback = store.publications.publish({
    ...input,
    operationId: undefined,
    expectedLivePublicationId: result.publicationId,
    idempotencyKey: 'rollback',
    requestDigest: 'rollback',
    metadata: { actorId: 'operator', modelVersion: 2, operation: 'rollback', sourcePublicationId: result.publicationId },
  })
  expect(rollback.kind).toBe('published')
})

it.each(['poll', 'integration'] as const)('commits %s readiness and Publish work together, including rollback on a failed write', (kind) => {
  const { database, store, poll, integration } = fixture()
  const complete = () => (kind == 'poll' ? store.polls.completeCandidate(poll, '{}', false, 1_000) : store.integrations.markCandidateReady(integration, 1_000))
  database.exec(`CREATE TRIGGER reject_ready BEFORE UPDATE ON publish_work WHEN NEW.status = 'ready' BEGIN SELECT RAISE(ABORT, 'write failed'); END`)
  expect(complete).toThrow('write failed')
  expect(database.prepare(`SELECT status FROM ${kind}_candidates`).get()).toEqual({ status: 'preparing' })
  expect(database.prepare('SELECT status FROM publish_work WHERE node_id = ?').get(kind)).toEqual({ status: 'pending' })
  database.exec('DROP TRIGGER reject_ready')
  expect(complete()).toBe(true)
  expect(database.prepare(`SELECT status FROM ${kind}_candidates`).get()).toEqual({ status: 'ready' })
  expect(database.prepare('SELECT status FROM publish_work WHERE node_id = ?').get(kind)).toEqual({ status: 'ready' })
})

it.each(['poll', 'integration'] as const)('commits %s failure and candidate cleanup together, including rollback on a failed write', (kind) => {
  const { database, store, poll, integration } = fixture()
  const fail = () =>
    kind == 'poll'
      ? store.polls.failCandidate(poll, 'test.failure', 'Failed', 1_000)
      : store.integrations.failCandidate(integration, 'test.failure', 'Failed', 1_000)
  database.exec(
    `CREATE TRIGGER reject_cleanup BEFORE ${kind == 'poll' ? 'DELETE' : 'UPDATE'} ON ${kind}_candidates BEGIN SELECT RAISE(ABORT, 'write failed'); END`,
  )
  expect(fail).toThrow('write failed')
  expect(database.prepare(`SELECT status FROM ${kind}_candidates`).get()).toEqual({ status: 'preparing' })
  expect(database.prepare('SELECT status FROM publish_work WHERE node_id = ?').get(kind)).toEqual({ status: 'pending' })
  database.exec('DROP TRIGGER reject_cleanup')
  fail()
  expect(database.prepare(`SELECT status FROM ${kind}_candidates`).get()).toEqual(kind == 'poll' ? undefined : { status: 'cleanup' })
  expect(database.prepare('SELECT status FROM publish_work WHERE node_id = ?').get(kind)).toEqual({ status: 'failed' })
  expect(store.publications.nextPublishAt()).toBeLessThanOrEqual(1_000)
})

it('rolls back an installed Poll when Integration activation fails, then activates both atomically', () => {
  const { database, store, input, poll, integration } = fixture()
  store.polls.completeCandidate(poll, '{}', false, 1_000)
  store.integrations.markCandidateReady(integration, 1_000)
  database.exec('UPDATE integration_candidates SET subscription_json = NULL')
  expect(store.publications.publish(input)).toEqual({ kind: 'operation-pending' })
  expect(store.publications.live('flow')).toBeUndefined()
  expect(database.prepare('SELECT COUNT(*) AS count FROM publications').get()).toEqual({ count: 0 })
  expect(database.prepare('SELECT COUNT(*) AS count FROM poll_bindings').get()).toEqual({ count: 0 })
  expect(store.polls.candidate(input.operationId, 'poll')?.status).toBe('ready')
  database.exec("UPDATE integration_candidates SET subscription_json = '{}'")
  expect(store.publications.publish(input).kind).toBe('published')
  expect(store.publications.publishOperation('flow', input.operationId)?.status).toBe('succeeded')
  expect(store.polls.candidate(input.operationId, 'poll')).toBeUndefined()
  expect(store.integrations.candidate(input.operationId, 'integration')).toBeUndefined()
})

it('schedules preparation deadlines, readiness, retries, and failures from durable state', () => {
  const { database, store, input, poll, integration } = fixture()
  expect(store.publications.nextPublishAt()).toBe(1_000 + 30 * 60_000)
  expect(store.publications.nextPublishOperation(1_000)).toBeUndefined()
  store.polls.completeCandidate(poll, '{}', false, 1_000)
  expect(store.publications.nextPublishAt()).toBe(1_000 + 30 * 60_000)
  store.integrations.markCandidateReady(integration, 1_000)
  expect(store.publications.nextPublishAt()).toBeLessThanOrEqual(1_000)
  store.publications.retryPublishOperation(input.operationId, 1_000)
  expect(store.publications.nextPublishAt()).toBe(2_000)
  expect(store.publications.nextPublishOperation(1_999)).toBeUndefined()
  expect(store.publications.nextPublishOperation(2_000)?.kind).toBe('ready')
  database.exec('UPDATE publish_operations SET deadline_at = 1_500')
  expect(store.publications.nextPublishAt()).toBe(1_500)
  expect(store.publications.nextPublishOperation(1_500)).toMatchObject({ kind: 'failed', code: 'publication.deadline-exceeded' })
})

it.each([1, 2])('preserves a stored model version when publishing without metadata: %s', (modelVersion) => {
  const { database, store, input, poll, integration } = fixture()
  database.prepare('UPDATE revisions SET content = ? WHERE revision_id = ?').run(JSON.stringify({ modelVersion }), input.revisionId)
  store.polls.completeCandidate(poll, '{}', false, 1_000)
  store.integrations.markCandidateReady(integration, 1_000)
  expect(store.publications.publish(input).kind).toBe('published')
  expect(store.publications.live('flow')?.publication.modelVersion).toBe(modelVersion)
})

it('preserves explicit publication model version metadata', () => {
  const { store, input, poll, integration } = fixture()
  store.polls.completeCandidate(poll, '{}', false, 1_000)
  store.integrations.markCandidateReady(integration, 1_000)
  expect(store.publications.publish({ ...input, metadata: { actorId: 'operator', operation: 'publish', modelVersion: 7 } }).kind).toBe('published')
  expect(store.publications.live('flow')?.publication.modelVersion).toBe(7)
})

it('freezes the presentation at acceptance, including replay and asynchronous activation', () => {
  const { store, database, input, poll, integration } = fixture()
  const acceptedInput = JSON.parse(
    String(database.prepare('SELECT input_json FROM publish_operations WHERE operation_id = ?').get(input.operationId)!.input_json),
  )
  expect(acceptedInput.presentationSnapshot).toEqual({ version: 1, revision: 1, updatedAt: new Date(1_000).toISOString(), value: {} })
  store.flows.updatePresentation('flow', 1, { changed: true }, 2_000)
  expect(store.publications.acceptPublishOperation(input).kind).toBe('accepted')
  expect(
    JSON.parse(String(database.prepare('SELECT input_json FROM publish_operations WHERE operation_id = ?').get(input.operationId)!.input_json))
      .presentationSnapshot,
  ).toEqual(acceptedInput.presentationSnapshot)
  store.integrations.markCandidateReady(integration, 2_000)
  store.polls.completeCandidate(poll, '{}', false, 2_000)
  const result = store.publications.publish(input)
  expect(result.kind).toBe('published')
  if (result.kind !== 'published') throw new Error('Not published')
  expect(store.publications.presentation('flow', result.publicationId)).toEqual(acceptedInput.presentationSnapshot)
  database.prepare('UPDATE publications SET presentation_snapshot = NULL WHERE publication_id = ?').run(result.publicationId)
  expect(store.publications.presentation('flow', result.publicationId)).toBeNull()
})

it.each(['saved', 'null', 'missing'] as const)('uses the durable %s presentation snapshot when activating an operation', (snapshot) => {
  const { store, database, input, poll, integration } = fixture()
  const accepted = JSON.parse(String(database.prepare('SELECT input_json FROM publish_operations WHERE operation_id = ?').get(input.operationId)!.input_json))
  const expected = snapshot === 'saved' ? accepted.presentationSnapshot : null
  if (snapshot === 'null') accepted.presentationSnapshot = null
  if (snapshot === 'missing') delete accepted.presentationSnapshot
  database.prepare('UPDATE publish_operations SET input_json = ? WHERE operation_id = ?').run(JSON.stringify(accepted), input.operationId)
  store.flows.updatePresentation('flow', 1, { changed: true }, 2_000)
  store.integrations.markCandidateReady(integration, 2_000)
  store.polls.completeCandidate(poll, '{}', false, 2_000)
  // Even a stale deserialized payload cannot replace the operation's frozen layout.
  const activation = { ...input, presentationSnapshot: { version: 1, revision: 99, updatedAt: '', value: { stale: true } } }
  const result = store.publications.publish(activation)
  if (result.kind !== 'published') throw new Error('Not published')
  expect(store.publications.presentation('flow', result.publicationId)).toEqual(expected)
})

it.each([true, false])('inherits the rollback source presentation without changing Draft (legacy=%s)', (legacy) => {
  const { store, database, input } = fixture()
  const direct = { ...input, operationId: undefined, integrations: [], polls: [] }
  store.flows.updatePresentation('flow', 1, { original: true }, 2_000)
  const first = store.publications.publish(direct)
  if (first.kind !== 'published') throw new Error('Not published')
  if (legacy) database.prepare('UPDATE publications SET presentation_snapshot = NULL WHERE publication_id = ?').run(first.publicationId)
  const source = store.publications.presentation('flow', first.publicationId)
  expect(source?.value ?? null).toEqual(legacy ? null : { original: true })
  store.flows.updatePresentation('flow', 2, { changed: true }, 3_000)
  const draft = store.flows.presentation('flow')
  const rollback = store.publications.publish({
    ...direct,
    expectedLivePublicationId: first.publicationId,
    idempotencyKey: 'rollback-layout',
    requestDigest: 'rollback-layout',
    metadata: { actorId: 'operator', modelVersion: 2, operation: 'rollback', sourcePublicationId: first.publicationId },
  })
  if (rollback.kind !== 'published') throw new Error('Rollback failed')
  expect(store.publications.presentation('flow', rollback.publicationId)).toEqual(source)
  expect(store.flows.presentation('flow')).toEqual(draft)
})

it.each([true, false])('records Live end state atomically for publish and rollback (enabled=%s)', (enabled) => {
  const { database, store, input, poll, integration } = fixture()
  store.polls.completeCandidate(poll, '{}', false, 1_000)
  store.integrations.markCandidateReady(integration, 1_000)
  const seed = { ...input, operationId: undefined, polls: [], integrations: [], idempotencyKey: 'first', requestDigest: 'first' }
  const first = store.publications.publish(input)
  if (first.kind != 'published') throw new Error('First publication failed')
  expect(store.publications.publication('flow', first.publicationId)).toMatchObject({ liveEndedAt: null, liveEnabledAtEnd: null })
  const next = { ...seed, expectedLivePublicationId: first.publicationId, idempotencyKey: 'next', requestDigest: 'next', publishedAt: 2_000 }
  const accepted = store.publications.acceptPublishOperation(next)
  if (accepted.kind != 'accepted') throw new Error('Next publication not accepted')
  database.prepare('UPDATE flow_live SET enabled = ? WHERE flow_id = ?').run(Number(enabled), 'flow')
  database.exec(`CREATE TRIGGER fail_live BEFORE UPDATE ON flow_live BEGIN SELECT RAISE(ABORT, 'rejected'); END`)
  expect(() => store.publications.publish({ ...next, operationId: accepted.operation.operationId })).toThrow('rejected')
  expect(store.publications.publication('flow', first.publicationId)).toMatchObject({ liveEndedAt: null, liveEnabledAtEnd: null })
  database.exec('DROP TRIGGER fail_live')
  const second = store.publications.publish({ ...next, operationId: accepted.operation.operationId })
  if (second.kind != 'published') throw new Error('Next publication failed')
  expect(store.publications.publication('flow', first.publicationId)).toMatchObject({ liveEndedAt: 2_000, liveEnabledAtEnd: Number(enabled) })
  expect(publicationView(store.publications.publication('flow', first.publicationId)!).liveEnd).toEqual({ enabled, endedAt: new Date(2_000).toISOString() })
  database.prepare('UPDATE flow_live SET enabled = ? WHERE flow_id = ?').run(Number(!enabled), 'flow')
  const rollback = store.publications.publish({
    ...seed,
    expectedLivePublicationId: second.publicationId,
    idempotencyKey: 'back',
    requestDigest: 'back',
    publishedAt: 3_000,
    metadata: { actorId: 'operator', modelVersion: 2, operation: 'rollback', sourcePublicationId: first.publicationId },
  })
  if (rollback.kind != 'published') throw new Error('Rollback failed')
  expect(store.publications.publication('flow', second.publicationId)).toMatchObject({ liveEndedAt: 3_000, liveEnabledAtEnd: Number(!enabled) })
  expect(store.publications.publication('flow', rollback.publicationId)).toMatchObject({ liveEndedAt: null, liveEnabledAtEnd: null })
  store.publications.publish({ ...next, operationId: accepted.operation.operationId, publishedAt: 4_000 })
  expect(store.publications.publication('flow', first.publicationId)).toMatchObject({ liveEndedAt: 2_000, liveEnabledAtEnd: Number(enabled) })
  expect(store.publications.publication('flow', second.publicationId)).toMatchObject({ liveEndedAt: 3_000, liveEnabledAtEnd: Number(!enabled) })
})
