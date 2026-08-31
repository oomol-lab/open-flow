import type { Context } from 'hono'
import type { CookieOptions } from 'hono/utils/cookie'

import { Hono } from 'hono'
import { deleteCookie, setSignedCookie } from 'hono/cookie'
import { parseSigned } from 'hono/utils/cookie'
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { serverErrorCode } from './error.ts'
import { OperatorStore } from './operator-store.ts'

const actorId = 'operator'
const cookieName = 'open_flow_operator_session'
const setupCookieName = 'open_flow_operator_setup'
const maxRequestBytes = 4 * 1024
const sessionLifetimeSeconds = 12 * 60 * 60
const setupLifetimeSeconds = 10 * 60
const defaultLoginAttemptsPerMinute = 10
const encoder = new TextEncoder()

export class OperatorSession {
  readonly #cookie: CookieOptions
  readonly #envFingerprint?: string
  readonly #envToken?: Uint8Array
  readonly #now: () => number
  readonly #setupCookie: CookieOptions
  readonly #setupFingerprint?: string
  readonly #store: OperatorStore
  #setupCode?: Uint8Array

  constructor(store: OperatorStore, token: string | undefined, secure: boolean, setupCode?: string, now: () => number = Date.now) {
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
  }

  async actor(request: Request): Promise<string | undefined> {
    const authorization = request.headers.get('authorization')
    if (authorization?.startsWith('Bearer ') && (await this.matches(authorization.slice(7)))) return actorId

    const fingerprint = this.#fingerprint()
    if (fingerprint == null) return
    const cookie = request.headers.get('cookie')
    if (cookie == null) return
    const value = (await parseSigned(cookie, this.#store.state().sessionSecret, cookieName))[cookieName]
    if (typeof value != 'string') return
    const [version, expiresAt, credential, nonce, extra] = value.split(':')
    if (version != '2' || extra != null || credential != fingerprint || nonce == null || nonce.length == 0) return
    const expiration = Number(expiresAt)
    return Number.isSafeInteger(expiration) && expiration > this.#now() ? actorId : undefined
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
  }

  clearCookie(context: Context): void {
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
    return json(200, {
      authenticated: session == null ? false : (await session.actor(context.req.raw)) != null,
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
    if (!admitted()) return limited()
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

async function tokenRequest(request: Request, key: 'code' | 'token'): Promise<string | undefined> {
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
  const body = value as Record<string, unknown>
  if (Object.keys(body).length != 2 || body.version !== 1 || typeof body[key] != 'string' || body[key].length == 0) return
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
