import { expect, it, onTestFinished } from 'vitest'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'

function fixture() {
  const database = Database.open(':memory:')
  onTestFinished(() => database.close())
  const store = new Store(database, () => 1_000)
  store.flows.createFlow({
    actorId: 'operator',
    content: '{}',
    createdAt: 1_000,
    digest: 'digest',
    flowId: 'flow',
    idempotencyKey: 'flow',
    name: 'Flow',
    requestDigest: 'flow',
    revisionId: 'revision',
  })
  const input = {
    closureDigest: 'closure',
    content: '{}',
    crons: [],
    expectedLivePublicationId: null,
    engineContract: 'open-flow-engine/v2',
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
