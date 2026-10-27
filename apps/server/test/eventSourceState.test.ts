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
