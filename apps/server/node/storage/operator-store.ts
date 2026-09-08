import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const keyBytes = 32
const retryDelayMs = 1_000
const scryptOptions = { N: 16_384, maxmem: 64 * 1024 * 1024, p: 1, r: 8 } as const

function digest(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

export class OperatorStore {
  readonly #clock: () => number
  readonly #database: DatabaseSync
  #retryAt = 0
  #verification?: { readonly digest: Buffer; readonly result: Promise<boolean> }
  #verified?: Buffer

  constructor(file: string, clock: () => number = Date.now) {
    this.#clock = clock
    this.#database = new DatabaseSync(file, { timeout: 5_000 })
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

  async matches(token: string): Promise<boolean> {
    const tokenDigest = digest(token)
    if (this.#verified != null && timingSafeEqual(tokenDigest, this.#verified)) return true
    const verification = this.#verification
    if (verification != null) return timingSafeEqual(tokenDigest, verification.digest) ? await verification.result : false
    if (this.#clock() < this.#retryAt) return false

    const result = this.#verify(token, tokenDigest)
    this.#verification = { digest: tokenDigest, result }
    try {
      return await result
    } finally {
      if (this.#verification?.result == result) this.#verification = undefined
    }
  }

  async #verify(token: string, tokenDigest: Buffer): Promise<boolean> {
    const row = this.#database.prepare('SELECT token_hash AS tokenHash, token_salt AS tokenSalt FROM operator_auth WHERE id = 1').get() as {
      readonly tokenHash: string | null
      readonly tokenSalt: string | null
    }
    if (row.tokenHash == null || row.tokenSalt == null) return false
    const expected = Buffer.from(row.tokenHash, 'base64url')
    const salt = Buffer.from(row.tokenSalt, 'base64url')
    const candidate = await new Promise<Buffer>((resolve, reject) => {
      scrypt(token, salt, keyBytes, scryptOptions, (error, value) => {
        if (error == null) resolve(value)
        else reject(error)
      })
    })
    const matches = timingSafeEqual(candidate, expected)
    if (matches) this.#verified = tokenDigest
    else this.#retryAt = this.#clock() + retryDelayMs
    return matches
  }

  claim(token: string): boolean {
    const salt = randomBytes(16)
    const hash = scryptSync(token, salt, keyBytes, scryptOptions)
    const now = this.#clock()
    const claimed =
      this.#database
        .prepare(
          `UPDATE operator_auth
           SET token_hash = ?, token_salt = ?, revision = revision + 1, claimed_at = ?, updated_at = ?
           WHERE id = 1 AND token_hash IS NULL`,
        )
        .run(hash.toString('base64url'), salt.toString('base64url'), now, now).changes == 1
    if (claimed) this.#verified = digest(token)
    return claimed
  }

  close(): void {
    this.#database.close()
  }
}
