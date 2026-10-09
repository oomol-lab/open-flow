import type { Context } from 'hono'
import type { CookieOptions } from 'hono/utils/cookie'
import type { SessionUser } from '../../common/users.ts'
import type { UserStore } from '../storage/user-store.ts'

import { Hono } from 'hono'
import { deleteCookie, setSignedCookie } from 'hono/cookie'
import { parseSigned } from 'hono/utils/cookie'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { serverErrorCode } from '../error.ts'
import { OperatorStore } from '../storage/operator-store.ts'

const actorId = 'operator'
const userCookieName = 'open_flow_user_session'
const emailSchema = z.string().trim().max(254).toLowerCase().pipe(z.email())
const loginSchema = z.strictObject({ version: z.literal(1), email: emailSchema, password: z.string().min(1).max(1024) })
const createUserSchema = z.strictObject({ version: z.literal(1), email: emailSchema, role: z.enum(['admin', 'user']) })
const createTokenSchema = z.strictObject({ version: z.literal(1), name: z.string().trim().min(1).max(100) })
const userRevisionSchema = z.strictObject({ version: z.literal(1), expectedRevision: z.number().int().positive() })
const enabledSchema = userRevisionSchema.extend({ enabled: z.boolean() })
const cookieName = 'open_flow_operator_session'
const setupCookieName = 'open_flow_operator_setup'
const maxRequestBytes = 4 * 1024
const sessionLifetimeSeconds = 30 * 24 * 60 * 60
const setupLifetimeSeconds = 10 * 60
const defaultLoginAttemptsPerMinute = 10
const encoder = new TextEncoder()

export class OperatorSession {
  readonly users?: UserStore
  readonly #cookie: CookieOptions
  readonly #envFingerprint?: string
  readonly #envToken?: Uint8Array
  readonly #now: () => number
  readonly #setupCookie: CookieOptions
  readonly #setupFingerprint?: string
  readonly #store: OperatorStore
  #setupCode?: Uint8Array

  constructor(store: OperatorStore, token: string | undefined, secure: boolean, setupCode?: string, now: () => number = Date.now, users?: UserStore) {
    if (token != null) {
      const bytes = encoder.encode(token)
      if (bytes.byteLength < 32) throw new Error('OPEN_FLOW_TOKEN must contain at least 32 UTF-8 bytes.')
      this.#envFingerprint = `e-${digest(bytes)}`
      this.#envToken = bytes
    }
    if (setupCode != null) {
      this.#setupCode = encoder.encode(setupCode)
      this.#setupFingerprint = digest(this.#setupCode)
    }
    this.#cookie = { httpOnly: true, path: '/', sameSite: 'Strict', secure }
    this.#now = now
    this.#setupCookie = { ...this.#cookie, path: '/auth' }
    this.#store = store
    this.users = users
  }

  async actor(request: Request): Promise<string | undefined> {
    const authorization = request.headers.get('authorization')
    if (authorization != null) {
      if (!authorization.startsWith('Bearer ')) return
      const token = authorization.slice(7)
      const userId = this.users?.tokenActor(token)
      return userId ?? ((await this.matches(token)) ? actorId : undefined)
    }

    const cookie = request.headers.get('cookie')
    if (cookie == null) return
    const userValue = (await parseSigned(cookie, this.#store.state().sessionSecret, userCookieName))[userCookieName]
    if (typeof userValue == 'string') {
      const [version, expiresAt, userId, revision, nonce, extra] = userValue.split(':')
      if (version == '1' && extra == null && nonce != null && nonce.length > 0 && Number.isSafeInteger(Number(expiresAt)) && Number(expiresAt) > this.#now()) {
        const user = this.users?.get(userId ?? '')
        if (user?.enabled && user.revision == Number(revision)) return user.userId
      }
    }
    const fingerprint = this.#fingerprint()
    if (fingerprint == null) return
    const value = (await parseSigned(cookie, this.#store.state().sessionSecret, cookieName))[cookieName]
    if (typeof value != 'string') return
    const [version, expiresAt, credential, nonce, extra] = value.split(':')
    if (version != '2' || extra != null || credential != fingerprint || nonce == null || nonce.length == 0) return
    const expiration = Number(expiresAt)
    return Number.isSafeInteger(expiration) && expiration > this.#now() ? actorId : undefined
  }

  async currentUser(request: Request): Promise<SessionUser | undefined> {
    const id = await this.actor(request)
    if (id == actorId) return { userId: actorId, email: null, role: 'admin' }
    const user = id == null ? undefined : this.users?.get(id)
    return user == null ? undefined : { userId: user.userId, email: user.email, role: user.role }
  }

  async setUserCookie(context: Context, userId: string, revision: number): Promise<void> {
    const expiresAt = this.#now() + sessionLifetimeSeconds * 1_000
    await setSignedCookie(context, userCookieName, `1:${expiresAt}:${userId}:${revision}:${randomUUID()}`, this.#store.state().sessionSecret, {
      ...this.#cookie,
      maxAge: sessionLifetimeSeconds,
    })
    deleteCookie(context, cookieName, this.#cookie)
    deleteCookie(context, setupCookieName, this.#setupCookie)
  }

  async matches(token: string): Promise<boolean> {
    if (this.#envToken == null) return await this.#store.matches(token)
    const candidate = encoder.encode(token)
    return candidate.byteLength == this.#envToken.byteLength && timingSafeEqual(candidate, this.#envToken)
  }

  source(): 'environment' | 'none' | 'settings' {
    if (this.#envToken != null) return 'environment'
    return this.#store.state().claimed ? 'settings' : 'none'
  }

  async setupAuthorized(request: Request): Promise<boolean> {
    if (this.source() != 'none' || this.#setupFingerprint == null) return false
    const cookie = request.headers.get('cookie')
    if (cookie == null) return false
    const value = (await parseSigned(cookie, this.#store.state().sessionSecret, setupCookieName))[setupCookieName]
    if (typeof value != 'string') return false
    const [version, expiresAt, fingerprint, nonce, extra] = value.split(':')
    if (version != '1' || extra != null || fingerprint != this.#setupFingerprint || nonce == null || nonce.length == 0) return false
    const expiration = Number(expiresAt)
    return Number.isSafeInteger(expiration) && expiration > this.#now()
  }

  async authorizeSetup(context: Context, code: string): Promise<boolean> {
    if (this.source() != 'none' || this.#setupCode == null || this.#setupFingerprint == null) return false
    const candidate = encoder.encode(code)
    if (candidate.byteLength != this.#setupCode.byteLength || !timingSafeEqual(candidate, this.#setupCode)) return false
    const expiresAt = this.#now() + setupLifetimeSeconds * 1_000
    await setSignedCookie(context, setupCookieName, `1:${expiresAt}:${this.#setupFingerprint}:${randomUUID()}`, this.#store.state().sessionSecret, {
      ...this.#setupCookie,
      maxAge: setupLifetimeSeconds,
    })
    return true
  }

  async claim(context: Context, token: string): Promise<'conflict' | 'created' | 'invalid'> {
    if (encoder.encode(token).byteLength < 32 || !(await this.setupAuthorized(context.req.raw))) return 'invalid'
    if (!this.#store.claim(token)) return 'conflict'
    this.#setupCode = undefined
    deleteCookie(context, setupCookieName, this.#setupCookie)
    await this.setCookie(context)
    return 'created'
  }

  async setCookie(context: Context): Promise<void> {
    const fingerprint = this.#fingerprint()
    if (fingerprint == null) return
    const expiresAt = this.#now() + sessionLifetimeSeconds * 1_000
    await setSignedCookie(context, cookieName, `2:${expiresAt}:${fingerprint}:${randomUUID()}`, this.#store.state().sessionSecret, {
      ...this.#cookie,
      maxAge: sessionLifetimeSeconds,
    })
    deleteCookie(context, userCookieName, this.#cookie)
  }

  clearCookie(context: Context): void {
    deleteCookie(context, userCookieName, this.#cookie)
    deleteCookie(context, cookieName, this.#cookie)
    deleteCookie(context, setupCookieName, this.#setupCookie)
  }

  #fingerprint(): string | undefined {
    if (this.#envFingerprint != null) return this.#envFingerprint
    const state = this.#store.state()
    return state.claimed ? `s-${state.revision}` : undefined
  }
}

export function createOperatorApp(session?: OperatorSession, attemptsPerMinute = defaultLoginAttemptsPerMinute, clock: () => number = Date.now): Hono {
  if (!Number.isSafeInteger(attemptsPerMinute) || attemptsPerMinute <= 0) {
    throw new TypeError('Operator login attempts per minute must be a positive safe integer.')
  }
  const app = new Hono()
  let attempts = 0
  let resetAt = 0
  let loggingIn = false

  const admitted = (): boolean => {
    const now = clock()
    if (resetAt <= now) {
      attempts = 0
      resetAt = now + 60_000
    }
    if (attempts >= attemptsPerMinute) return false
    attempts += 1
    return true
  }
  const limited = (): Response =>
    json(
      429,
      { error: { code: serverErrorCode.authenticationInvalid, message: 'Operator authentication rate limit exceeded.' }, version: 1 },
      new Headers({ 'retry-after': String(Math.max(1, Math.ceil((resetAt - clock()) / 1_000))) }),
    )

  app.get('/session', async (context) => {
    const source = session?.source() ?? 'none'
    const currentUser = await session?.currentUser(context.req.raw)
    return json(200, {
      authenticated: currentUser != null,
      user: currentUser ?? null,
      configured: source != 'none',
      setupAuthorized: session == null ? false : await session.setupAuthorized(context.req.raw),
      setupRequired: session != null && source == 'none',
      source,
      version: 1,
    })
  })

  app.post('/session', async (context) => {
    if (session == null || session.source() == 'none') {
      return json(503, {
        error: { code: serverErrorCode.operatorNotConfigured, message: 'Operator authentication is not configured.' },
        version: 1,
      })
    }
    if (!admitted()) return limited()
    const body = await tokenRequest(context.req.raw, 'token')
    if (body == null) return json(400, { error: { code: serverErrorCode.operatorInvalid, message: 'Session request is invalid.' }, version: 1 })
    if (!(await session.matches(body))) {
      return json(401, { error: { code: serverErrorCode.authenticationInvalid, message: 'Operator token is invalid.' }, version: 1 })
    }
    await session.setCookie(context)
    return json(200, { authenticated: true, configured: true, version: 1 }, context.res.headers)
  })

  app.post('/user-session', async (context) => {
    if (session?.users == null || session.source() == 'none') {
      return json(503, { error: { code: serverErrorCode.operatorNotConfigured, message: 'User authentication is not configured.' }, version: 1 })
    }
    if (!admitted()) return limited()
    const body = loginSchema.safeParse(await objectRequest(context.req.raw))
    if (!body.success) return json(400, { error: { code: serverErrorCode.requestInvalid, message: 'Login request is invalid.' }, version: 1 })
    if (loggingIn) return limited()
    loggingIn = true
    try {
      const user = await session.users.verify(body.data.email, body.data.password)
      if (user == null) return json(401, { error: { code: serverErrorCode.authenticationInvalid, message: 'Email or password is invalid.' }, version: 1 })
      await session.setUserCookie(context, user.userId, user.revision)
      return json(200, { authenticated: true, version: 1 }, context.res.headers)
    } finally {
      loggingIn = false
    }
  })

  const tokens = new Hono<{ Variables: { userId: string } }>()
  tokens.use('*', async (context, next) => {
    const origin = context.req.header('origin')
    if (origin != null && origin != new URL(context.req.url).origin)
      return json(403, { error: { code: serverErrorCode.authorizationDenied, message: 'Cross-origin requests are not allowed.' }, version: 1 })
    const user = context.req.header('authorization') == null ? await session?.currentUser(context.req.raw) : undefined
    if (user == null) return json(401, { error: { code: serverErrorCode.authenticationInvalid, message: 'Sign in to manage personal tokens.' }, version: 1 })
    if (user.email == null || session?.users == null)
      return json(403, { error: { code: serverErrorCode.authorizationDenied, message: 'Personal tokens require an email account.' }, version: 1 })
    context.set('userId', user.userId)
    await next()
  })
  tokens.get('/', (context) => json(200, { tokens: session!.users!.listTokens(context.get('userId')), version: 1 }))
  tokens.post('/', async (context) => {
    const body = createTokenSchema.safeParse(await objectRequest(context.req.raw))
    if (!body.success) return json(400, { error: { code: serverErrorCode.requestInvalid, message: 'Token name is invalid.' }, version: 1 })
    if ((await session!.actor(context.req.raw)) != context.get('userId'))
      return json(401, { error: { code: serverErrorCode.authenticationInvalid, message: 'Sign in to manage personal tokens.' }, version: 1 })
    return json(201, { ...session!.users!.createToken(context.get('userId'), body.data.name), version: 1 })
  })
  tokens.delete('/:tokenId', (context) => {
    session!.users!.revokeToken(context.get('userId'), context.req.param('tokenId'))
    return new Response(null, { status: 204, headers: noStore(new Headers()) })
  })
  app.route('/tokens', tokens)

  app.use('/users*', async (context, next) => {
    const user = await session?.currentUser(context.req.raw)
    if (user == null) return json(401, { error: { code: serverErrorCode.authenticationInvalid, message: 'Authentication is required.' }, version: 1 })
    if (user.role != 'admin')
      return json(403, { error: { code: serverErrorCode.authorizationDenied, message: 'Administrator permission is required.' }, version: 1 })
    await next()
  })
  app.get('/users', () => json(200, { users: session?.users?.list() ?? [], version: 1 }))
  app.post('/users', async (context) => {
    const body = createUserSchema.safeParse(await objectRequest(context.req.raw))
    if (!body.success || session?.users == null)
      return json(400, { error: { code: serverErrorCode.requestInvalid, message: 'User request is invalid.' }, version: 1 })
    return json(201, { ...(await session.users.create(body.data.email, body.data.role)), version: 1 })
  })
  app.put('/users/:userId', async (context) => {
    const body = enabledSchema.safeParse(await objectRequest(context.req.raw))
    if (!body.success || session?.users == null)
      return json(400, { error: { code: serverErrorCode.requestInvalid, message: 'User request is invalid.' }, version: 1 })
    if (context.req.param('userId') == (await session.actor(context.req.raw))) {
      return json(403, { error: { code: serverErrorCode.authorizationDenied, message: 'You cannot disable your own account.' }, version: 1 })
    }
    return json(200, { user: session.users.setEnabled(context.req.param('userId'), body.data.enabled, body.data.expectedRevision), version: 1 })
  })
  app.post('/users/:userId/password', async (context) => {
    const body = userRevisionSchema.safeParse(await objectRequest(context.req.raw))
    if (!body.success || session?.users == null)
      return json(400, { error: { code: serverErrorCode.requestInvalid, message: 'User request is invalid.' }, version: 1 })
    return json(200, { ...(await session.users.resetPassword(context.req.param('userId'), body.data.expectedRevision)), version: 1 })
  })

  app.post('/setup/session', async (context) => {
    if (session == null) {
      return json(503, { error: { code: serverErrorCode.operatorNotConfigured, message: 'Operator setup is not available.' }, version: 1 })
    }
    if (session.source() != 'none') {
      return json(409, { error: { code: serverErrorCode.operatorAlreadyConfigured, message: 'Operator authentication is already configured.' }, version: 1 })
    }
    if (!admitted()) return limited()
    const code = await tokenRequest(context.req.raw, 'code')
    if (code == null) return json(400, { error: { code: serverErrorCode.operatorInvalid, message: 'Setup request is invalid.' }, version: 1 })
    if (!(await session.authorizeSetup(context, code))) {
      return json(401, { error: { code: serverErrorCode.authenticationInvalid, message: 'Setup code is invalid.' }, version: 1 })
    }
    return json(200, { authorized: true, version: 1 }, context.res.headers)
  })

  app.post('/setup', async (context) => {
    if (session == null) {
      return json(503, { error: { code: serverErrorCode.operatorNotConfigured, message: 'Operator setup is not available.' }, version: 1 })
    }
    if (session.source() != 'none') {
      return json(409, { error: { code: serverErrorCode.operatorAlreadyConfigured, message: 'Operator authentication is already configured.' }, version: 1 })
    }
    if (!(await session.setupAuthorized(context.req.raw))) {
      return json(401, { error: { code: serverErrorCode.authenticationInvalid, message: 'Setup authorization or operator token is invalid.' }, version: 1 })
    }
    const token = await tokenRequest(context.req.raw, 'token')
    if (token == null) return json(400, { error: { code: serverErrorCode.operatorInvalid, message: 'Setup request is invalid.' }, version: 1 })
    const result = await session.claim(context, token)
    if (result == 'conflict') {
      return json(409, { error: { code: serverErrorCode.operatorAlreadyConfigured, message: 'Operator authentication is already configured.' }, version: 1 })
    }
    if (result == 'invalid') {
      return json(401, { error: { code: serverErrorCode.authenticationInvalid, message: 'Setup authorization or operator token is invalid.' }, version: 1 })
    }
    return json(201, { authenticated: true, configured: true, version: 1 }, context.res.headers)
  })

  app.delete('/session', (context) => {
    session?.clearCookie(context)
    return new Response(null, { headers: noStore(context.res.headers), status: 204 })
  })

  return app
}

async function objectRequest(request: Request): Promise<Record<string, unknown> | undefined> {
  if (request.body == null) return
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request.body) {
    size += chunk.byteLength
    if (size > maxRequestBytes) return
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return
  }
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  return value as Record<string, unknown>
}

async function tokenRequest(request: Request, key: 'code' | 'token'): Promise<string | undefined> {
  const body = await objectRequest(request)
  if (body == null || Object.keys(body).length != 2 || body.version !== 1 || typeof body[key] != 'string' || body[key].length == 0) return
  return body[key]
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('base64url')
}

function json(status: number, body: unknown, headers?: Headers): Response {
  const source = JSON.stringify(body)
  const responseHeaders = noStore(headers)
  responseHeaders.set('content-length', String(encoder.encode(source).byteLength))
  responseHeaders.set('content-type', 'application/json; charset=utf-8')
  return new Response(source, { headers: responseHeaders, status })
}

function noStore(headers?: Headers): Headers {
  const values = new Headers(headers)
  values.set('cache-control', 'no-store')
  return values
}
