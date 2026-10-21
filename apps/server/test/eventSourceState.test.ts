import { expect, it } from 'vitest'
import { Database } from '../node/storage/database.ts'
import { Store } from '../node/storage/store.ts'

it('rolls back application verification when source state persistence fails', () => {
  const database = Database.open(':memory:')
  try {
    const store = new Store(database, Date.now)
    const source = store.eventSources.create(
      {
        kind: 'slack',
        version: 1,
        name: 'Slack',
        connectionId: 'connection',
        teamId: null,
        appId: 'A1',
        workspaceId: 'T1',
        signingSecret: 'secret',
        eventTypes: ['app_mention'],
      },
      'slack',
      {
        identity: 'workspace',
        config: { appId: 'A1' },
        secrets: { signingSecret: 'secret' },
        state: {},
        eventTypes: ['app_mention'],
      },
    )
    database.connection.exec("CREATE TRIGGER reject_source_state BEFORE UPDATE OF state_json ON event_sources BEGIN SELECT RAISE(ABORT, 'write failed'); END")
    expect(() => store.eventSources.saveState(source, { verifiedAt: 100 })).toThrow('write failed')
    expect(database.connection.prepare('SELECT verified_at FROM event_source_apps').get()).toEqual({ verified_at: null })
    database.connection.exec('DROP TRIGGER reject_source_state')
    expect(store.eventSources.saveState(source, { verifiedAt: 100 })).toBe(true)
    expect(database.connection.prepare('SELECT verified_at FROM event_source_apps').get()).toEqual({ verified_at: 100 })
    expect(store.eventSources.saveState({ ...source, revision: source.revision + 1 }, { verifiedAt: 200 })).toBe(false)
    expect(database.connection.prepare('SELECT verified_at FROM event_source_apps').get()).toEqual({ verified_at: 100 })
  } finally {
    database.close()
  }
})
