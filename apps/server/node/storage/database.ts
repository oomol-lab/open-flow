import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrate.ts'

/**
 * Owns the single SQLite connection for one deployment database file.
 *
 * Every store borrows this connection and the transaction boundary from the
 * same instance, so PRAGMA settings, `busy_timeout`, and transaction nesting
 * have exactly one owner. Nothing else in the deployment opens the file.
 */
export class Database {
  readonly connection: DatabaseSync

  private constructor(file: string) {
    this.connection = new DatabaseSync(file, { timeout: 5_000 })
    this.connection.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `)
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
    this.connection.close()
  }
}
