import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { resetProviderAccess } from '../scripts/reset-provider-access.ts'

it('refuses live work and clears only authorization in an offline reset', () => {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec(`
      CREATE TABLE flow_provider_access (bindings_json TEXT, access_revision INTEGER, provider_access_digest TEXT);
      INSERT INTO flow_provider_access VALUES ('[{"accessBindingId":"old"}]', 3, 'old');
      CREATE TABLE flow_live (enabled INTEGER); INSERT INTO flow_live VALUES (1);
      CREATE TABLE publish_work (status TEXT);
    `)
    for (const table of ['source_subscriptions', 'integration_states', 'integration_candidates']) database.exec(`CREATE TABLE ${table} (id TEXT)`)
    const old = JSON.stringify({ bindings: [{ accessBindingId: 'old' }], mode: 'selectable', providerAccessDigest: 'old', accessRevision: 3, version: 1 })
    for (const table of ['publications', 'publish_operations', 'runs']) {
      database.exec(`CREATE TABLE ${table} (provider_access_snapshot TEXT, provider_access_digest TEXT, status TEXT, name TEXT)`)
    }
    for (const table of ['publications', 'publish_operations', 'runs']) {
      database.prepare(`INSERT INTO ${table} VALUES (?, 'old', 'completed', 'retained')`).run(old)
    }
    expect(() => resetProviderAccess(database, true)).toThrow('enabled Live: 1')
    expect(database.prepare('SELECT access_revision FROM flow_provider_access').get()?.access_revision).toBe(3)
    database.exec('UPDATE flow_live SET enabled = 0')
    resetProviderAccess(database, false)
    expect(database.prepare('SELECT access_revision FROM flow_provider_access').get()?.access_revision).toBe(3)
    database.exec("UPDATE runs SET status = 'waiting'")
    expect(() => resetProviderAccess(database, true)).toThrow('unfinished Runs: 1')
    database.exec("UPDATE runs SET status = 'completed'")
    resetProviderAccess(database, true)
    resetProviderAccess(database, true)
    expect(database.prepare('SELECT access_revision FROM flow_provider_access').get()?.access_revision).toBe(4)
    for (const table of ['publications', 'publish_operations', 'runs']) {
      const row = database.prepare(`SELECT * FROM ${table}`).get()!
      expect(row.name).toBe('retained')
      expect(JSON.parse(String(row.provider_access_snapshot))).toMatchObject({ bindings: [], mode: 'selectable', accessRevision: 3 })
    }
  } finally {
    database.close()
  }
})
