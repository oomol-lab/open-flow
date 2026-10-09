import type { DatabaseSync } from 'node:sqlite'
import type { User, UserToken } from '../../common/users.ts'

import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { ControlError, serverErrorCode } from '../error.ts'

const columns = 'user_id AS userId, email, role, enabled, revision, created_at AS createdAt'
const options = { N: 131_072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const dummySalt = randomBytes(16).toString('base64url')

function hash(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, options, (error, value) => {
      if (error == null) resolve(value)
      else reject(error)
    })
  })
}

function user(row: Omit<User, 'enabled'> & { readonly enabled: number }): User {
  return { ...row, enabled: row.enabled == 1 }
}

export class UserStore {
  readonly #database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.#database = database
  }

  get(userId: string): User | undefined {
    const row = this.#database.prepare(`SELECT ${columns} FROM users WHERE user_id = ?`).get(userId) as
      | (Omit<User, 'enabled'> & { readonly enabled: number })
      | undefined
    return row == null ? undefined : user(row)
  }

  list(): readonly User[] {
    return (
      this.#database.prepare(`SELECT ${columns} FROM users ORDER BY created_at, user_id`).all() as unknown as (Omit<User, 'enabled'> & {
        readonly enabled: number
      })[]
    ).map(user)
  }

  async create(email: string, role: User['role']): Promise<{ readonly user: User; readonly password: string }> {
    const password = randomBytes(18).toString('base64url')
    const salt = randomBytes(16).toString('base64url')
    const passwordHash = await hash(password, salt)
    const userId = `user_${randomUUID().replaceAll('-', '')}`
    const created = this.#database
      .prepare('INSERT INTO users (user_id, email, role, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
      .run(userId, email, role, passwordHash.toString('base64url'), salt, Date.now())
    if (created.changes == 0) throw new ControlError(serverErrorCode.userConflict, 'A user with this email already exists.')
    return { user: this.get(userId)!, password }
  }

  async verify(email: string, password: string): Promise<User | undefined> {
    const stored = this.#database
      .prepare('SELECT user_id AS userId, password_hash AS hash, password_salt AS salt, revision FROM users WHERE email = ?')
      .get(email) as { readonly userId: string; readonly hash: string; readonly salt: string; readonly revision: number } | undefined
    const candidate = await hash(password, stored?.salt ?? dummySalt)
    const expected = stored == null ? Buffer.alloc(32) : Buffer.from(stored.hash, 'base64url')
    if (!timingSafeEqual(candidate, expected) || stored == null) return
    const current = this.get(stored.userId)
    return current?.enabled && current.revision == stored.revision ? current : undefined
  }

  setEnabled(userId: string, enabled: boolean, revision: number): User {
    this.#update(userId, revision, 'enabled = ?', enabled ? 1 : 0)
    return this.get(userId)!
  }

  async resetPassword(userId: string, revision: number): Promise<{ readonly user: User; readonly password: string }> {
    const password = randomBytes(18).toString('base64url')
    const salt = randomBytes(16).toString('base64url')
    const passwordHash = await hash(password, salt)
    this.#update(userId, revision, 'password_hash = ?, password_salt = ?', passwordHash.toString('base64url'), salt)
    return { user: this.get(userId)!, password }
  }

  listTokens(userId: string): readonly UserToken[] {
    return this.#database
      .prepare(`
      SELECT t.token_id AS tokenId, t.name, t.created_at AS createdAt FROM user_tokens t
      JOIN users u ON u.user_id = t.user_id AND u.revision = t.user_revision
      WHERE t.user_id = ? AND u.enabled = 1 ORDER BY t.created_at, t.token_id
    `)
      .all(userId) as unknown as UserToken[]
  }

  createToken(userId: string, name: string): { readonly credential: UserToken; readonly token: string } {
    const token = `ofp_${randomBytes(32).toString('base64url')}`
    const credential = { tokenId: randomUUID(), name, createdAt: Date.now() }
    const inserted = this.#database
      .prepare(`
      INSERT INTO user_tokens (token_id, user_id, name, token_hash, user_revision, created_at)
      SELECT ?, user_id, ?, ?, revision, ? FROM users WHERE user_id = ? AND enabled = 1
    `)
      .run(credential.tokenId, name, createHash('sha256').update(token).digest('hex'), credential.createdAt, userId)
    if (inserted.changes == 0) throw new ControlError(serverErrorCode.authenticationInvalid, 'The account is unavailable.')
    return { credential, token }
  }

  tokenActor(token: string): string | undefined {
    if (!/^ofp_[A-Za-z0-9_-]{43}$/.test(token)) return
    const row = this.#database
      .prepare(`
      SELECT t.user_id AS userId FROM user_tokens t
      JOIN users u ON u.user_id = t.user_id AND u.revision = t.user_revision
      WHERE t.token_hash = ? AND u.enabled = 1
    `)
      .get(createHash('sha256').update(token).digest('hex')) as { readonly userId: string } | undefined
    return row?.userId
  }

  revokeToken(userId: string, tokenId: string): void {
    this.#database.prepare('DELETE FROM user_tokens WHERE user_id = ? AND token_id = ?').run(userId, tokenId)
  }

  #update(userId: string, revision: number, assignment: string, ...values: (string | number)[]): void {
    const changed = this.#database
      .prepare(`UPDATE users SET ${assignment}, revision = revision + 1 WHERE user_id = ? AND revision = ?`)
      .run(...values, userId, revision)
    if (changed.changes != 0) return
    if (this.get(userId) == null) throw new ControlError(serverErrorCode.userNotFound, 'The user was not found.')
    throw new ControlError(serverErrorCode.userConflict, 'The user changed concurrently. Reload and retry.')
  }
}
