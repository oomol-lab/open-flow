import type { DatabaseSync } from 'node:sqlite'

export interface StoredVariable {
  readonly name: string
  readonly updatedAt: number
  readonly value: string
}

const maxVariables = 200

/** User-owned configuration values, independent of any Flow. */
export class VariableStore {
  readonly #clock: () => number
  readonly #database: DatabaseSync
  readonly #transaction: <Value>(operation: () => Value) => Value

  constructor(database: DatabaseSync, transaction: <Value>(operation: () => Value) => Value, clock: () => number = Date.now) {
    this.#clock = clock
    this.#database = database
    this.#transaction = transaction
  }

  list(ownerId: string): readonly StoredVariable[] {
    return this.#database
      .prepare('SELECT name, updated_at AS updatedAt, value FROM variables WHERE owner_id = ? ORDER BY name COLLATE BINARY')
      .all(ownerId) as unknown as readonly StoredVariable[]
  }

  get(ownerId: string, name: string): StoredVariable | undefined {
    return this.#database.prepare('SELECT name, updated_at AS updatedAt, value FROM variables WHERE owner_id = ? AND name = ?').get(ownerId, name) as
      | StoredVariable
      | undefined
  }

  put(ownerId: string, name: string, value: string): { readonly kind: 'limit-reached' } | { readonly kind: 'saved'; readonly variable: StoredVariable } {
    return this.#transaction(() => {
      const existing = this.get(ownerId, name)
      if (existing != null) {
        if (existing.value == value) return { kind: 'saved', variable: existing }
        const updatedAt = this.#clock()
        this.#database.prepare('UPDATE variables SET value = ?, updated_at = ? WHERE owner_id = ? AND name = ?').run(value, updatedAt, ownerId, name)
        return { kind: 'saved', variable: { name, updatedAt, value } }
      }
      const count = (this.#database.prepare('SELECT COUNT(*) AS count FROM variables WHERE owner_id = ?').get(ownerId) as { readonly count: number }).count
      if (count >= maxVariables) return { kind: 'limit-reached' }
      const updatedAt = this.#clock()
      this.#database.prepare('INSERT INTO variables (owner_id, name, value, updated_at) VALUES (?, ?, ?, ?)').run(ownerId, name, value, updatedAt)
      return { kind: 'saved', variable: { name, updatedAt, value } }
    })
  }

  delete(ownerId: string, name: string): boolean {
    return this.#transaction(() => this.#database.prepare('DELETE FROM variables WHERE owner_id = ? AND name = ?').run(ownerId, name).changes == 1)
  }

  /**
   * Resolves bound Variable names within the Flow owner’s namespace.
   *
   * A single SELECT is already atomic, and Run admission calls this inside its own
   * transaction, so it must not open a second boundary.
   */
  resolve(flowId: string, bindings: Readonly<Record<string, string>>): Readonly<Record<string, string>> | undefined {
    const names = [...new Set(Object.values(bindings))]
    if (names.length == 0) return {}
    const rows = this.#database
      .prepare(
        `SELECT name, value FROM variables WHERE owner_id = (SELECT owner_id FROM flows WHERE flow_id = ?) AND name IN (${names.map(() => '?').join(', ')})`,
      )
      .all(flowId, ...names) as unknown as readonly { readonly name: string; readonly value: string }[]
    const values = new Map(rows.map(({ name, value }) => [name, value]))
    const resolved = Object.fromEntries(
      Object.entries(bindings).flatMap(([bindingId, name]) => {
        const value = values.get(name)
        return value == null ? [] : [[bindingId, value]]
      }),
    )
    return Object.keys(resolved).length == Object.keys(bindings).length ? resolved : undefined
  }

  hasAll(flowId: string, names: readonly string[]): boolean {
    const unique = [...new Set(names)]
    if (unique.length == 0) return true
    const count = (
      this.#database
        .prepare(
          `SELECT COUNT(*) AS count FROM variables WHERE owner_id = (SELECT owner_id FROM flows WHERE flow_id = ?) AND name IN (${unique.map(() => '?').join(', ')})`,
        )
        .get(flowId, ...unique) as {
        readonly count: number
      }
    ).count
    return count == unique.length
  }
}
