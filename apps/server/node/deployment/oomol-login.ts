import { randomBytes, randomUUID } from 'node:crypto'
import { ControlError, serverErrorCode } from '../error.ts'
import { Settings } from './settings.ts'

interface Login {
  readonly actorId: string
  readonly controller: AbortController
  readonly endpoint: 'oomol.com' | 'oomol.dev'
  readonly id: string
  readonly revision: number
  readonly stat: string
  expiresAt: number
  polling: boolean
}

export class OomolLogin {
  readonly #settings: Settings
  #login?: Login

  constructor(settings: Settings) {
    this.#settings = settings
  }

  async start(actorId: string, revision: number, signal: AbortSignal) {
    const current = this.#settings.status()
    if (current.connector.runtime.source == 'environment')
      throw new ControlError(serverErrorCode.configurationEnvironmentManaged, 'Configuration is managed by the environment.')
    if (current.revision != revision) throw new ControlError(serverErrorCode.configurationConflict, 'Configuration changed.')
    this.#login?.controller.abort()
    const login: Login = {
      actorId,
      controller: new AbortController(),
      endpoint: current.connector.runtime.configured && new URL(current.connector.runtime.origin).hostname == 'connector.oomol.dev' ? 'oomol.dev' : 'oomol.com',
      expiresAt: Date.now() + 10 * 60_000,
      id: randomUUID(),
      polling: false,
      revision,
      stat: deviceLoginState(),
    }
    this.#login = login
    try {
      const value = await this.#request(login, 'code', signal)
      if (
        value.status != 'waiting' ||
        typeof value.code != 'string' ||
        !/^[A-Z0-9]{6}$/.test(value.code) ||
        !Number.isSafeInteger(value.expires_in) ||
        Number(value.expires_in) <= 0 ||
        typeof value.verify_code_url != 'string'
      )
        throw unavailable()
      const url = new URL(value.verify_code_url)
      if (
        url.protocol != 'https:' ||
        ![`console.${login.endpoint}`, login.endpoint].includes(url.hostname) ||
        url.port != '' ||
        url.username != '' ||
        url.password != '' ||
        !['/login/device', '/login/device/'].includes(url.pathname) ||
        url.hash != ''
      )
        throw unavailable()
      url.searchParams.set('user_code', value.code)
      login.expiresAt = Math.min(login.expiresAt, Date.now() + Number(value.expires_in) * 1_000)
      return { code: value.code, id: login.id, url: url.href, version: 1 as const }
    } catch (error) {
      if (this.#login === login) this.#login = undefined
      throw error instanceof ControlError ? error : unavailable()
    }
  }

  async poll(actorId: string, id: string, signal: AbortSignal) {
    const login = this.#current(actorId, id)
    if (login.polling) return { status: 'waiting' as const, version: 1 as const }
    login.polling = true
    try {
      const value = await this.#request(login, 'result', signal)
      if (value.status == 'waiting') return { status: 'waiting' as const, version: 1 as const }
      if (value.status != 'verified' || value.endpoint !== login.endpoint || typeof value.api_key != 'string' || value.api_key.length == 0) throw unavailable()
      this.#current(actorId, id)
      this.#login = undefined
      const result = this.#settings.putConnector(login.revision, `https://connector.${login.endpoint}`, value.api_key)
      if (result == 'environment') throw new ControlError(serverErrorCode.configurationEnvironmentManaged, 'Configuration is managed by the environment.')
      if (result == 'conflict') throw new ControlError(serverErrorCode.configurationConflict, 'Configuration changed.')
      return { status: 'saved' as const, configuration: this.#settings.status(), version: 1 as const }
    } finally {
      login.polling = false
    }
  }

  cancel(actorId: string, id: string): void {
    if (this.#login?.actorId != actorId || this.#login.id != id) return
    this.#login.controller.abort()
    this.#login = undefined
  }

  #current(actorId: string, id: string): Login {
    const login = this.#login
    if (login == null || login.actorId != actorId || login.id != id) throw expired()
    if (Date.now() >= login.expiresAt) {
      this.cancel(actorId, id)
      throw expired()
    }
    return login
  }

  async #request(login: Login, operation: 'code' | 'result', signal: AbortSignal): Promise<Record<string, unknown>> {
    const url = new URL(`https://api.${login.endpoint}/v1/auth/device_login/${operation}`)
    if (operation == 'result') url.searchParams.set('stat', login.stat)
    try {
      const response = await fetch(url, {
        ...(operation == 'code' ? { body: JSON.stringify({ stat: login.stat }), headers: { 'content-type': 'application/json' } } : {}),
        method: operation == 'code' ? 'POST' : 'GET',
        redirect: 'error',
        signal: AbortSignal.any([signal, login.controller.signal, AbortSignal.timeout(10_000)]),
      })
      this.#current(login.actorId, login.id)
      if (response.status == 404) {
        this.cancel(login.actorId, login.id)
        throw expired()
      }
      if (!response.ok) throw unavailable()
      const value: unknown = await response.json()
      if (value == null || typeof value != 'object' || Array.isArray(value)) throw unavailable()
      this.#current(login.actorId, login.id)
      return value as Record<string, unknown>
    } catch (error) {
      throw error instanceof ControlError ? error : unavailable()
    }
  }
}

function deviceLoginState(): string {
  // OOMOL's device-login API requires UUIDv7.
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Date.now(), 0, 6)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function expired(): ControlError {
  return new ControlError(serverErrorCode.configurationLoginExpired, 'OOMOL authorization expired. Start again.')
}

function unavailable(): ControlError {
  return new ControlError(serverErrorCode.configurationLoginUnavailable, 'OOMOL authorization could not be completed.')
}
