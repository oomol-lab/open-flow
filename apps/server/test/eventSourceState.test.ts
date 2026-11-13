import { expect, it } from 'vitest'
import { runEnvironment } from '../node/application/run-environment.ts'
import { isolatedVmEngineDigest } from '../node/runtime/isolated-vm.ts'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'

it('rolls back reference projection persistence and rejects stale local revisions', () => {
  const database = Database.open(':memory:')
  try {
    const store = new Store(database, runEnvironment(isolatedVmEngineDigest), Date.now)
    const source = store.eventSources.reserve(
      {
        kind: 'zoom',
        version: 1,
        name: 'Zoom',
        connectionId: 'connection',
        teamId: null,
        appId: 'A1',
        signingSecret: 'secret',
        eventTypes: ['recording.completed'],
      },
      'create',
    )
    const snapshot = {
      reference: { applicationId: 'app', sourceId: 'remote' },
      revision: 1,
      eventTypes: source.eventTypes,
      ready: true,
      view: {
        appId: 'A1',
        manageSubscriptions: false,
        verificationTokenConfigured: false,
        encryptKeyConfigured: false,
        verifiedAt: new Date(100).toISOString(),
      },
    }
    database.connection.exec("CREATE TRIGGER reject_source_state BEFORE UPDATE OF state_json ON event_sources BEGIN SELECT RAISE(ABORT, 'write failed'); END")
    expect(() => store.eventSources.saveReference(source, snapshot, 'create')).toThrow('write failed')
    expect(store.eventSources.require(source.sourceId).connector?.reference).toBeUndefined()
    database.connection.exec('DROP TRIGGER reject_source_state')
    expect(store.eventSources.saveReference(source, snapshot, 'create')).toBe(true)
    expect(store.eventSources.saveReference({ ...source, revision: source.revision + 1 }, snapshot)).toBe(false)
    expect(database.connection.prepare('SELECT * FROM event_source_apps').all()).toEqual([])
  } finally {
    database.close()
  }
})

it('guards resource subscription transitions against demands that return during deletion', () => {
  const database = Database.open(':memory:')
  try {
    let now = 1_000
    const store = new Store(database, runEnvironment(isolatedVmEngineDigest), () => now)
    const sources = store.eventSources
    const access = { version: 2, mode: 'implicit', sharedAccessDigest: 'implicit', sharedBindings: [], selectedBindings: [] } as const
    const status = () => sources.subscription('source', 'resource')?.status
    const demand = (bindingId: string) => sources.demand('source', 'resource', '{"key":"resource"}', bindingId, access, now)

    expect(demand('first').status).toBe('creating')
    expect(sources.beginSubscriptionDelete('source', 'resource', now)).toBe(false)
    expect(sources.subscriptionReady('source', 'resource', now)).toBe(true)
    sources.release('first')
    expect(sources.unusedSubscriptions(now).map((subscription) => subscription.status)).toEqual(['ready'])
    expect(sources.beginSubscriptionDelete('source', 'resource', now)).toBe(true)

    expect(demand('second').status).toBe('creating')
    expect(sources.deleteSubscription('source', 'resource')).toBe(false)
    expect(status()).toBe('creating')

    sources.release('second')
    expect(sources.beginSubscriptionDelete('source', 'resource', now)).toBe(true)
    expect(sources.subscriptionReady('source', 'resource', now)).toBe(false)
    sources.subscriptionFailed('source', 'resource', 'deleting', now)
    expect(status()).toBe('deleting')
    expect(sources.unusedSubscriptions(now)).toEqual([])
    now += 60_000
    expect(sources.unusedSubscriptions(now).map((subscription) => subscription.status)).toEqual(['deleting'])
    expect(sources.deleteSubscription('source', 'resource')).toBe(true)
    expect(status()).toBeUndefined()
  } finally {
    database.close()
  }
})
