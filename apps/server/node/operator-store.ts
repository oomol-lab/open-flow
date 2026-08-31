import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

export class OperatorStore {
  readonly #clock: () => number
  readonly #database: DatabaseSync

  constructor(file: string, clock: () => number = Date.now) {
    this.#clock = clock
    this.#database = new DatabaseSync(file)
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `)
    const now = this.#clock()
    this.#database
      .prepare('INSERT OR IGNORE INTO operator_auth (id, session_secret, revision, updated_at) VALUES (1, ?, 1, ?)')
      .run(randomBytes(32).toString('base64url'), now)
  }

  state(): { readonly claimed: boolean; readonly revision: number; readonly sessionSecret: string } {
    const row = this.#database.prepare('SELECT token_hash AS tokenHash, revision, session_secret AS sessionSecret FROM operator_auth WHERE id = 1').get() as {
      readonly revision: number
      readonly sessionSecret: string
      readonly tokenHash: string | null
    }
    return { claimed: row.tokenHash != null, revision: row.revision, sessionSecret: row.sessionSecret }
  }

  matches(token: string): boolean {
    const row = this.#database.prepare('SELECT token_hash AS tokenHash, token_salt AS tokenSalt FROM operator_auth WHERE id = 1').get() as {
      readonly tokenHash: string | null
      readonly tokenSalt: string | null
    }
    if (row.tokenHash == null || row.tokenSalt == null) return false
    const expected = Buffer.from(row.tokenHash, 'base64url')
    const candidate = scryptSync(token, Buffer.from(row.tokenSalt, 'base64url'), expected.byteLength)
    return timingSafeEqual(candidate, expected)
  }

  claim(token: string): boolean {
    const salt = randomBytes(16)
    const hash = scryptSync(token, salt, 32)
    const now = this.#clock()
    return (
      this.#database
        .prepare(
          `UPDATE operator_auth
           SET token_hash = ?, token_salt = ?, revision = revision + 1, claimed_at = ?, updated_at = ?
           WHERE id = 1 AND token_hash IS NULL`,
        )
        .run(hash.toString('base64url'), salt.toString('base64url'), now, now).changes == 1
    )
  }

  close(): void {
    this.#database.close()
  }
}
