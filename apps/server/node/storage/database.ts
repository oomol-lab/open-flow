import type { StatementSync } from 'node:sqlite'

import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrate.ts'

const maxCachedStatements = 512
const maxCachedBindingBytes = 1024 * 1024
const executions = ['all', 'get', 'iterate', 'run'] as const

function bindingBytes(parameters: readonly unknown[]): number {
  let bytes = 0
  for (const parameter of parameters) {
    if (typeof parameter == 'string') bytes += parameter.length * 2
    else if (ArrayBuffer.isView(parameter)) bytes += parameter.byteLength
    else if (parameter != null && typeof parameter == 'object') bytes += bindingBytes(Object.values(parameter))
  }
  return bytes
}

/**
 * Owns the single SQLite connection for one deployment database file.
 *
 * Every store borrows this connection and the transaction boundary from the
 * same instance, so PRAGMA settings, `busy_timeout`, and transaction nesting
 * have exactly one owner. Nothing else in the deployment opens the file.
 */
export class Database {
  readonly connection: DatabaseSync
  readonly #statements = new Map<string, StatementSync>()

  private constructor(file: string) {
    this.connection = new DatabaseSync(file, { timeout: 5_000 })
    this.connection.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `)
    // Stores prepare SQL at each call site; the connection reuses compiled statements, which reset after every execution.
    // A reset statement keeps its last bindings, so large payloads bind to a one-off statement instead.
    const prepare = (sql: string): StatementSync => DatabaseSync.prototype.prepare.call(this.connection, sql)
    this.connection.prepare = (sql, options) => {
      if (options != null) return DatabaseSync.prototype.prepare.call(this.connection, sql, options)
      let statement = this.#statements.get(sql)
      if (statement == null) {
        const cached = prepare(sql)
        for (const name of executions) {
          const execute = cached[name]
          Object.assign(cached, {
            [name]: (...parameters: unknown[]) =>
              bindingBytes(parameters) > maxCachedBindingBytes ? Reflect.apply(execute, prepare(sql), parameters) : Reflect.apply(execute, cached, parameters),
          })
        }
        statement = cached
        if (this.#statements.size >= maxCachedStatements) this.#statements.delete(this.#statements.keys().next().value!)
      } else this.#statements.delete(sql)
      this.#statements.set(sql, statement)
      return statement
    }
  }

  /** Opens a database file and brings its schema to the current version. */
  static open(file: string): Database {
    const database = new Database(file)
    try {
      migrate(database)
      return database
    } catch (error) {
      database.close()
      throw error
    }
  }

  /**
   * Runs `operation` inside one `BEGIN IMMEDIATE` transaction.
   *
   * SQLite has no nested transactions, so callers must own the outermost
   * boundary: an operation that may also run inside one must not open another.
   */
  transaction<Value>(operation: () => Value): Value {
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.connection.exec('COMMIT')
      return value
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.#statements.clear()
    this.connection.close()
  }
}
