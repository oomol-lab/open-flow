import type { DatabaseSync } from 'node:sqlite'

export interface StoredVariable {
  readonly name: string
  readonly updatedAt: number
  readonly value: string
}

const maxVariables = 200

/** Deployment-scope configuration values, independent of any Flow. */
export class VariableStore {
  readonly #clock: () => number
  readonly #database: DatabaseSync
  readonly #transaction: <Value>(operation: () => Value) => Value

  constructor(database: DatabaseSync, transaction: <Value>(operation: () => Value) => Value, clock: () => number = Date.now) {
    this.#clock = clock
    this.#database = database
    this.#transaction = transaction
  }

  list(): readonly StoredVariable[] {
    return this.#database
      .prepare('SELECT name, updated_at AS updatedAt, value FROM variables ORDER BY name COLLATE BINARY')
      .all() as unknown as readonly StoredVariable[]
  }

  get(name: string): StoredVariable | undefined {
    return this.#database.prepare('SELECT name, updated_at AS updatedAt, value FROM variables WHERE name = ?').get(name) as StoredVariable | undefined
  }

  put(name: string, value: string): { readonly kind: 'limit-reached' } | { readonly kind: 'saved'; readonly variable: StoredVariable } {
    return this.#transaction(() => {
      const existing = this.get(name)
      if (existing != null) {
        if (existing.value == value) return { kind: 'saved', variable: existing }
        const updatedAt = this.#clock()
        this.#database.prepare('UPDATE variables SET value = ?, updated_at = ? WHERE name = ?').run(value, updatedAt, name)
        return { kind: 'saved', variable: { name, updatedAt, value } }
      }
      const count = (this.#database.prepare('SELECT COUNT(*) AS count FROM variables').get() as { readonly count: number }).count
      if (count >= maxVariables) return { kind: 'limit-reached' }
      const updatedAt = this.#clock()
      this.#database.prepare('INSERT INTO variables (name, value, updated_at) VALUES (?, ?, ?)').run(name, value, updatedAt)
      return { kind: 'saved', variable: { name, updatedAt, value } }
    })
  }

  delete(name: string): boolean {
    return this.#transaction(() => this.#database.prepare('DELETE FROM variables WHERE name = ?').run(name).changes == 1)
  }

  /**
   * Resolves bound Variable names to their current values.
   *
   * A single SELECT is already atomic, and Run admission calls this inside its own
   * transaction, so it must not open a second boundary.
   */
  resolve(bindings: Readonly<Record<string, string>>): Readonly<Record<string, string>> | undefined {
    const names = [...new Set(Object.values(bindings))]
    if (names.length == 0) return {}
    const rows = this.#database
      .prepare(`SELECT name, value FROM variables WHERE name IN (${names.map(() => '?').join(', ')})`)
      .all(...names) as unknown as readonly { readonly name: string; readonly value: string }[]
    const values = new Map(rows.map(({ name, value }) => [name, value]))
    const resolved = Object.fromEntries(
      Object.entries(bindings).flatMap(([bindingId, name]) => {
        const value = values.get(name)
        return value == null ? [] : [[bindingId, value]]
      }),
    )
    return Object.keys(resolved).length == Object.keys(bindings).length ? resolved : undefined
  }

  hasAll(names: readonly string[]): boolean {
    const unique = [...new Set(names)]
    if (unique.length == 0) return true
    const count = (
      this.#database.prepare(`SELECT COUNT(*) AS count FROM variables WHERE name IN (${unique.map(() => '?').join(', ')})`).get(...unique) as {
        readonly count: number
      }
    ).count
    return count == unique.length
  }
}
