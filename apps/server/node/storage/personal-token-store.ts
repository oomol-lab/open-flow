import type { DatabaseSync } from 'node:sqlite'
import type { UserToken } from '../../common/users.ts'

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ControlError, serverErrorCode } from '../error.ts'

const validOwner = `((t.user_id = 'operator' AND t.operator_fingerprint = ?)
  OR (t.operator_fingerprint IS NULL AND u.enabled = 1 AND u.revision = t.user_revision))`

export class PersonalTokenStore {
  readonly #database: DatabaseSync

  constructor(database: DatabaseSync) {
    this.#database = database
  }

  listTokens(userId: string, operatorFingerprint?: string): readonly UserToken[] {
    return this.#database
      .prepare(`
      SELECT t.token_id AS tokenId, t.name, t.created_at AS createdAt FROM user_tokens t
      LEFT JOIN users u ON u.user_id = t.user_id
      WHERE t.user_id = ? AND ${validOwner} ORDER BY t.created_at, t.token_id
    `)
      .all(userId, operatorFingerprint ?? null) as unknown as UserToken[]
  }

  createToken(userId: string, name: string, operatorFingerprint?: string): { readonly credential: UserToken; readonly token: string } {
    const token = `ofp_${randomBytes(32).toString('base64url')}`
    const credential = { tokenId: randomUUID(), name, createdAt: Date.now() }
    const hash = createHash('sha256').update(token).digest('hex')
    if (userId == 'operator' && operatorFingerprint != null) {
      this.#database
        .prepare(`
        INSERT INTO user_tokens (token_id, user_id, name, token_hash, user_revision, created_at, operator_fingerprint)
        VALUES (?, 'operator', ?, ?, 0, ?, ?)
      `)
        .run(credential.tokenId, name, hash, credential.createdAt, operatorFingerprint)
    } else {
      const inserted = this.#database
        .prepare(`
        INSERT INTO user_tokens (token_id, user_id, name, token_hash, user_revision, created_at)
        SELECT ?, user_id, ?, ?, revision, ? FROM users WHERE user_id = ? AND enabled = 1
      `)
        .run(credential.tokenId, name, hash, credential.createdAt, userId)
      if (inserted.changes == 0) throw new ControlError(serverErrorCode.authenticationInvalid, 'The account is unavailable.')
    }
    return { credential, token }
  }

  tokenActor(token: string, operatorFingerprint?: string): string | undefined {
    if (!/^ofp_[A-Za-z0-9_-]{43}$/.test(token)) return
    const row = this.#database
      .prepare(`
      SELECT t.user_id AS userId FROM user_tokens t
      LEFT JOIN users u ON u.user_id = t.user_id
      WHERE t.token_hash = ? AND ${validOwner}
    `)
      .get(createHash('sha256').update(token).digest('hex'), operatorFingerprint ?? null) as { readonly userId: string } | undefined
    return row?.userId
  }

  revokeToken(userId: string, tokenId: string): void {
    this.#database.prepare('DELETE FROM user_tokens WHERE user_id = ? AND token_id = ?').run(userId, tokenId)
  }
}
