import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { resetProviderAccess } from '../scripts/reset-provider-access.ts'

it('refuses live work and clears only authorization in an offline reset', () => {
  const database = new DatabaseSync(':memory:')
  try {
    database.exec(`
      CREATE TABLE flow_provider_access (bindings_json TEXT, access_revision INTEGER, shared_access_digest TEXT);
      INSERT INTO flow_provider_access VALUES ('[{"accessBindingId":"old"}]', 3, 'old');
      CREATE TABLE flow_live (enabled INTEGER); INSERT INTO flow_live VALUES (1);
      CREATE TABLE publish_work (status TEXT);
    `)
    for (const table of ['source_subscriptions', 'integration_states', 'integration_candidates']) database.exec(`CREATE TABLE ${table} (id TEXT)`)
    const old = JSON.stringify({
      sharedBindings: [{ accessBindingId: 'shared' }],
      selectedBindings: [{ accessBindingId: 'selected' }],
      mode: 'selectable',
      sharedAccessDigest: 'old',
      version: 2,
    })
    for (const table of ['publications', 'publish_operations', 'runs']) {
      database.exec(`CREATE TABLE ${table} (provider_access_snapshot TEXT, shared_access_digest TEXT, status TEXT, name TEXT)`)
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
      expect(JSON.parse(String(row.provider_access_snapshot))).toEqual({
        sharedBindings: [],
        selectedBindings: [],
        mode: 'selectable',
        sharedAccessDigest: 'sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
        version: 2,
      })
    }
  } finally {
    database.close()
  }
})
