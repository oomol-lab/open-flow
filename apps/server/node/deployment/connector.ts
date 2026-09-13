import type { ConnectorProxyRequest, ConnectorProxyResult } from '@oomol-lab/open-flow/connector-proxy'
import type { ConnectorAction, ConnectorConnection, ConnectorProvider } from '@oomol-lab/open-flow/control-api'
import type { ConnectorCapability, JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { Logger } from 'pino'

import { connectorActionPorts } from '@oomol-lab/open-flow/connector-action'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import { errorKind, silentLogger } from '../logger.ts'

const maxResponseBytes = 1024 * 1024
const maxActionResponseBytes = 32 * 1024 * 1024
const maxActionCatalogBytes = 8 * 1024 * 1024
const catalogConcurrency = 16
const readinessTimeoutMs = 1_000
const responseDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

interface ResponseBudget {
  readonly exhaust: (responseBytes: number) => ConnectorTaskError
  readonly limit: number
  used: number
}
interface ConditionalOptions {
  readonly fields?: Readonly<Record<string, string>>
  readonly teamId?: string
  readonly locale?: string
  readonly budget?: ResponseBudget
  readonly maximumResponseBytes?: number
  readonly failure?: (data: unknown) => ConnectorTaskError
}

interface RuntimeAction {
  readonly description: string
  readonly id: string
  readonly inputSchema: JsonValue
  readonly name: string
  readonly outputSchema: JsonValue
  readonly service: string
}

export interface ConnectorHost {
  execute(
    action: string,
    connectionId: string | undefined,
    input: Readonly<Record<string, JsonValue>>,
    invocationId: string,
    signal: AbortSignal,
    teamId?: string,
  ): Promise<JsonValue>
  getAction(actionId: string, signal?: AbortSignal, teamId?: string, locale?: string): Promise<ConnectorAction>
  listActions(serviceId?: string, signal?: AbortSignal, teamId?: string, locale?: string): Promise<readonly ConnectorAction[]>
  listAllConnections(signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorConnection[]>
  listConnections(serviceId: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorConnection[]>
  listProviders(signal?: AbortSignal, teamId?: string, locale?: string): Promise<readonly ConnectorProvider[]>
  proxy(
    provider: string,
    connectionId: string,
    rateLimitId: string,
    request: ConnectorProxyRequest,
    signal: AbortSignal,
    teamId?: string,
  ): Promise<ConnectorProxyResult>
  ready(): Promise<boolean>
  searchActions(query: string, signal?: AbortSignal, teamId?: string, locale?: string): Promise<readonly ConnectorAction[]>
}

export type ConnectorErrorCode =
  | 'connector.input-invalid'
  | 'connector.indeterminate'
  | 'connector.action-not-found'
  | 'connector.connection-required'
  | 'connector.unavailable'
  | 'connector.unconfigured'

export class ConnectorTaskError extends Error {
  readonly code: ConnectorErrorCode

  constructor(code: ConnectorErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'ConnectorTaskError'
  }
}

class RequestError extends ConnectorTaskError {
  readonly reason: string
  readonly status: number | undefined

  constructor(cause: ConnectorTaskError, reason: string, status: number | undefined) {
    super(cause.code, cause.message)
    this.cause = cause
    this.reason = reason
    this.status = status
  }
}

export class ConnectorClient implements ConnectorHost {
  readonly #logger: Logger
  readonly #origin: URL
  readonly #teamOrigin?: URL
  readonly #timeoutMs: number
  readonly #token: string
  // Origin and credentials are fixed by this client; each request representation is independent.
  readonly #responses = new Map<string, { readonly etag: string; readonly data: unknown; readonly bytes: number }>()
  readonly #requests = new Map<string, symbol>()
  #cachedBytes = 0

  constructor(origin: string, token: string, timeoutMs = 30_000, logger: Logger = silentLogger) {
    const url = new URL(origin)
    if (url.protocol != 'http:' && url.protocol != 'https:') throw new Error('Connector origin must use HTTP.')
    if (url.username != '' || url.password != '' || url.search != '' || url.hash != '') {
      throw new Error('Connector origin must not contain credentials, a query, or a fragment.')
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Connector timeout must be a positive integer.')
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
    this.#logger = logger.child({ component: 'connector' })
    this.#origin = url
    if (url.hostname == 'connector.oomol.com' || url.hostname == 'connector.oomol.dev') {
      this.#teamOrigin = new URL(`https://relation-control.${url.hostname.slice('connector.'.length)}/`)
    }
    this.#timeoutMs = timeoutMs
    this.#token = token
  }

  teamSupported(): boolean {
    return this.#teamOrigin != null && this.#token.length > 0
  }

  async listTeams(signal?: AbortSignal): Promise<readonly { readonly id: string; readonly name: string; readonly systemCreated: boolean }[]> {
    if (this.#teamOrigin == null || this.#token.length == 0) throw unavailable()
    const response = await this.#request('teams.list', 'v1/me/teams', { method: 'GET' }, signal, { origin: this.#teamOrigin })
    if (!response.ok) throw unavailable()
    return this.#decode('teams.list', {}, () => {
      if (!record(response.value) || !Array.isArray(response.value.teams)) throw unavailable()
      return response.value.teams.map(runtimeTeam)
    })
  }

  async ready(): Promise<boolean> {
    try {
      const response = await fetch(new URL('health', this.#origin), {
        redirect: 'error',
        signal: AbortSignal.timeout(readinessTimeoutMs),
      })
      await response.body?.cancel()
      return response.ok
    } catch {
      return false
    }
  }

  async listProviders(signal?: AbortSignal, teamId?: string, locale?: string): Promise<readonly ConnectorProvider[]> {
    return (await this.#providers(signal, teamId, locale)).map((provider) =>
      Object.assign(
        { serviceId: provider.serviceId, serviceName: provider.serviceName },
        provider.homepageUrl == null ? {} : { homepageUrl: provider.homepageUrl },
        provider.icon == null ? {} : { icon: provider.icon },
      ),
    )
  }

  async #providers(signal?: AbortSignal, teamId?: string, locale?: string) {
    return this.#conditionalGet('providers.list', 'v1/providers', (data) => runtimeList(runtimeData(data), runtimeProvider), signal, { teamId, locale })
  }

  async listActions(serviceId?: string, signal?: AbortSignal, teamId?: string, locale?: string): Promise<readonly ConnectorAction[]> {
    if (serviceId != null) {
      const [providers, connections, actions] = await Promise.all([
        this.#providers(signal, teamId, locale),
        this.#connections(serviceId, signal, teamId),
        this.#actions(`v1/actions?service=${encodeURIComponent(serviceId)}`, false, signal, teamId, { serviceId }, undefined, locale),
      ])
      return this.#decode('actions.list', { serviceId }, () => mapActions(actions, providers, connections))
    }
    return await Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        const [providers, connections] = yield* Effect.all(
          [
            Effect.tryPromise({ try: (requestSignal) => this.#providers(requestSignal, teamId, locale), catch: (error) => error }),
            Effect.tryPromise({ try: (requestSignal) => this.#connections(undefined, requestSignal, teamId), catch: (error) => error }),
          ],
          { concurrency: 'unbounded' },
        )
        const exhausted = Deferred.makeUnsafe<never, ConnectorTaskError>()
        let catalogError: ConnectorTaskError | undefined
        const budget = {
          exhaust: (responseBytes: number) => {
            if (catalogError != null) return catalogError
            catalogError = unavailable()
            this.#logger.warn(
              {
                category: 'connector.request.failed',
                failure: 'response-too-large',
                limitBytes: maxActionCatalogBytes,
                operation: 'actions.list',
                responseBytes,
              },
              'Connector Action catalog was too large.',
            )
            Deferred.doneUnsafe(exhausted, Effect.fail(catalogError))
            return catalogError
          },
          limit: maxActionCatalogBytes,
          used: 0,
        }
        const catalogs = yield* Effect.forEach(
          providers,
          (provider) =>
            Effect.tryPromise({
              try: (requestSignal) =>
                this.#actions(
                  `v1/actions?service=${encodeURIComponent(provider.serviceId)}`,
                  false,
                  requestSignal,
                  teamId,
                  { serviceId: provider.serviceId },
                  budget,
                  locale,
                ),
              catch: (error) => error,
            }),
          { concurrency: catalogConcurrency },
        ).pipe(Effect.raceFirst(Deferred.await(exhausted)))
        return this.#decode('actions.list', {}, () => mapActions(catalogs.flat(), providers, connections))
      }),
      { signal },
    )
  }

  async searchActions(query: string, signal?: AbortSignal, teamId?: string, locale?: string): Promise<readonly ConnectorAction[]> {
    const [providers, connections, actions] = await Promise.all([
      this.#providers(signal, teamId, locale),
      this.#connections(undefined, signal, teamId),
      this.#actions(`v1/actions/search?q=${encodeURIComponent(query)}`, true, signal, teamId, {}, undefined, locale),
    ])
    return this.#decode('actions.search', {}, () => mapActions(actions, providers, connections))
  }

  async getAction(actionId: string, signal?: AbortSignal, teamId?: string, locale?: string): Promise<ConnectorAction> {
    const [providers, connections, action] = await Promise.all([
      this.#providers(signal, teamId, locale),
      this.#connections(undefined, signal, teamId),
      this.#conditionalGet('actions.get', `v1/actions/${encodeURIComponent(actionId)}`, (data) => runtimeAction(runtimeData(data)), signal, {
        fields: { actionId },
        teamId,
        locale,
        failure: (data) => (record(data) && data.success === false && data.errorCode === 'unknown_action' ? actionNotFound() : unavailable()),
      }),
    ])
    return this.#decode('actions.get', { actionId }, () => mapAction(action, providers, connections))
  }

  async listAllConnections(signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorConnection[]> {
    return await this.#connections(undefined, signal, teamId)
  }

  async listConnections(serviceId: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorConnection[]> {
    return await this.#connections(serviceId, signal, teamId)
  }

  async execute(
    action: string,
    connectionId: string | undefined,
    input: Readonly<Record<string, JsonValue>>,
    invocationId: string,
    signal: AbortSignal,
    teamId?: string,
  ): Promise<JsonValue> {
    const separator = action.indexOf('.')
    if (separator <= 0) throw connectionRequired()
    const alias = connectionId == null ? undefined : await this.#resolveConnection(connectionId, action.slice(0, separator), signal, teamId)

    const actionResponse = await this.#request(
      'action.execute',
      `v1/actions/${encodeURIComponent(action)}`,
      {
        body: JSON.stringify({ input }),
        headers: {
          'content-type': 'application/json',
          'idempotency-key': invocationId,
          ...(alias == null ? {} : { 'x-oo-connector-alias': alias }),
        },
        method: 'POST',
      },
      signal,
      { fields: { actionId: action, ...(connectionId == null ? {} : { connectionId }), invocationId }, maximumResponseBytes: maxActionResponseBytes, teamId },
    ).catch((error: unknown) => {
      if (signal.aborted) throw signal.reason
      if (!(error instanceof RequestError)) throw error
      throw new ConnectorTaskError(
        'connector.indeterminate',
        `${error.reason}${error.status == null ? '' : ` (HTTP ${error.status})`}. The action outcome is unknown.`,
      )
    })
    const response = actionResponse.value
    if (!record(response))
      throw new ConnectorTaskError(
        'connector.indeterminate',
        `Connector returned an invalid action response (HTTP ${actionResponse.status}). The action outcome is unknown.`,
      )
    if (actionResponse.ok && response.success === true && Object.hasOwn(response, 'data')) return response.data as JsonValue
    if (response.errorCode === 'connection_not_allowed' || response.errorCode === 'connection_not_found') throw connectionRequired()
    const failure = actionFailure(response)
    if (failure.code == 'connector.input-invalid') throw failure
    throw new ConnectorTaskError(
      'connector.indeterminate',
      `Connector ${response.success === false ? 'reported an action failure' : 'returned an unexpected action response'} (HTTP ${actionResponse.status}). The action outcome is unknown.`,
    )
  }

  async proxy(
    provider: string,
    connectionId: string,
    rateLimitId: string,
    request: ConnectorProxyRequest,
    signal: AbortSignal,
    teamId?: string,
  ): Promise<ConnectorProxyResult> {
    const alias = await this.#resolveConnection(connectionId, provider, signal, teamId)
    const proxyResponse = await this.#request(
      'proxy.execute',
      `v1/proxy/${encodeURIComponent(provider)}`,
      {
        body: JSON.stringify(request),
        headers: {
          'content-type': 'application/json',
          'x-oo-connector-alias': alias,
          'x-oomol-rate-limit-id': rateLimitId,
        },
        method: 'POST',
      },
      signal,
      { fields: { connectionId, provider, rateLimitId }, teamId },
    )
    const response = proxyResponse.value
    if (!record(response)) throw unavailable()
    if (proxyResponse.ok && response.success === true && record(response.data)) {
      const status = response.data.status
      if (Number.isSafeInteger(status) && Number(status) >= 100 && Number(status) <= 599 && Object.hasOwn(response.data, 'data')) {
        return { data: response.data.data, status: Number(status) }
      }
    }
    if (response.errorCode === 'connection_not_allowed' || response.errorCode === 'connection_not_found') throw connectionRequired()
    throw unavailable()
  }

  async #actions(
    path: string,
    search: boolean,
    signal?: AbortSignal,
    teamId?: string,
    fields: Readonly<Record<string, string>> = {},
    budget?: ResponseBudget,
    locale?: string,
  ): Promise<readonly RuntimeAction[]> {
    return this.#conditionalGet(
      search ? 'actions.search' : 'actions.list',
      path,
      (data) => runtimeList(runtimeData(data), (value) => runtimeAction(value, search)),
      signal,
      { budget, fields, maximumResponseBytes: search ? maxResponseBytes : maxActionCatalogBytes, locale, teamId },
    )
  }

  async #connections(serviceId?: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorConnection[]> {
    const path = serviceId == null ? 'v1/apps' : `v1/apps/services/${encodeURIComponent(serviceId)}`
    return this.#conditionalGet(
      'connections.list',
      path,
      (data) => {
        const connections = runtimeList(runtimeData(data), runtimeConnection)
        if (serviceId != null && connections.some((connection) => connection.serviceId != serviceId)) throw unavailable()
        return connections
      },
      signal,
      { fields: serviceId == null ? {} : { serviceId }, teamId },
    )
  }

  async #conditionalGet<Value>(
    operation: string,
    path: string,
    decode: (data: unknown) => Value,
    signal?: AbortSignal,
    options: ConditionalOptions = {},
  ): Promise<Value> {
    signal?.throwIfAborted()
    const key = JSON.stringify([path, options.teamId, options.locale])
    const cached = this.#responses.get(key)
    const requestId = Symbol()
    this.#requests.set(key, requestId)
    try {
      const response = await this.#request(
        operation,
        path,
        {
          method: 'GET',
          headers: cached == null ? {} : { 'if-none-match': cached.etag },
        },
        signal,
        { ...options, allowNotModified: cached != null },
      )
      if (!response.ok) throw options.failure?.(response.value) ?? unavailable()
      signal?.throwIfAborted()
      const data = response.status == 304 ? cached!.data : response.value
      const bytes = response.status == 304 ? cached!.bytes : response.bytes
      if (response.status == 304) {
        if (bytes > (options.maximumResponseBytes ?? maxResponseBytes)) throw unavailable('Cached Connector response exceeds the size limit.')
        if (options.budget != null) {
          const total = options.budget.used + bytes
          if (total > options.budget.limit) throw options.budget.exhaust(total)
          options.budget.used = total
        }
      }
      const value = this.#decode(operation, options.fields ?? {}, () => decode(data))
      if (this.#requests.get(key) == requestId) {
        const previous = this.#responses.get(key)
        if (previous) this.#cachedBytes -= previous.bytes
        this.#responses.delete(key)
        const etag = response.etag ?? (response.status == 304 ? cached!.etag : undefined)
        if (etag) {
          this.#responses.set(key, { data, bytes, etag })
          this.#cachedBytes += bytes
        }
        // Bound memory across arbitrary searches, locales and Team scopes.
        while (this.#cachedBytes > maxActionResponseBytes) {
          const oldest = this.#responses.entries().next().value!
          this.#cachedBytes -= oldest[1].bytes
          this.#responses.delete(oldest[0])
        }
      }
      return value
    } finally {
      if (this.#requests.get(key) == requestId) this.#requests.delete(key)
    }
  }

  #decode<Value>(operation: string, fields: Readonly<Record<string, string>>, decode: () => Value): Value {
    try {
      return decode()
    } catch (error) {
      this.#logger.warn(
        {
          category: 'connector.request.failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          failure: 'response-invalid',
          operation,
          ...fields,
          ...errorKind(error),
        },
        'Connector response was invalid.',
      )
      if (error instanceof ConnectorTaskError) throw error
      throw unavailable()
    }
  }

  async #resolveConnection(connectionId: string, service: string, signal: AbortSignal, teamId?: string): Promise<string> {
    const fields = { connectionId, provider: service }
    const apps = await this.#conditionalGet(
      'connection.resolve',
      'v1/apps',
      (data) => {
        const values = runtimeData(data)
        if (!Array.isArray(values)) throw unavailable()
        return values as unknown[]
      },
      signal,
      { fields, teamId },
    )
    const connection = apps.find((value) => record(value) && value.id === connectionId)
    if (
      !record(connection) ||
      connection.status !== 'active' ||
      connection.service !== service ||
      typeof connection.alias != 'string' ||
      connection.alias.length == 0
    ) {
      this.#logger.warn({ category: 'connector.connection.unavailable', ...fields }, 'Connector Connection is unavailable.')
      throw connectionRequired()
    }
    return connection.alias
  }

  async #request(
    operation: string,
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
    {
      budget,
      allowNotModified = false,
      fields = {},
      maximumResponseBytes = maxResponseBytes,
      origin = this.#origin,
      teamId,
      locale,
    }: {
      readonly allowNotModified?: boolean
      readonly budget?: ResponseBudget
      readonly fields?: Readonly<Record<string, string>>
      readonly maximumResponseBytes?: number
      readonly locale?: string
      readonly origin?: URL
      readonly teamId?: string
    } = {},
  ): Promise<{ readonly ok: boolean; readonly status: number; readonly value: unknown; readonly etag: string | null; readonly bytes: number }> {
    const startedAt = performance.now()
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    let status: number | undefined
    try {
      const response = await fetch(new URL(path, origin), {
        ...init,
        headers: {
          ...(this.#token == '' ? {} : { authorization: `Bearer ${this.#token}` }),
          ...(origin == this.#origin && teamId != null ? { 'x-oo-team-id': teamId } : {}),
          ...(locale == null ? {} : { 'Accept-Language': locale }),
          ...init.headers,
        },
        redirect: 'error',
        signal: signal == null ? timeout : AbortSignal.any([signal, timeout]),
      })
      status = response.status
      const etag = response.headers.get('etag')?.trim() || null
      if (status == 304 && allowNotModified) {
        await response.body?.cancel()
        return { ok: true, status, value: undefined, etag, bytes: 0 }
      }
      const { value, bytes } = await readJson(response, maximumResponseBytes, budget)
      if (!response.ok) {
        this.#logger.warn(
          {
            category: 'connector.request.failed',
            durationMs: Math.round(performance.now() - startedAt),
            failure: 'upstream-status',
            method: init.method ?? 'GET',
            operation,
            status,
            ...fields,
          },
          'Connector request failed.',
        )
      }
      return { ok: response.ok, status: response.status, value, etag, bytes }
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      let failure = 'transport'
      if (error instanceof ConnectorTaskError) failure = 'response-invalid'
      else if (timeout.aborted) failure = 'timeout'
      this.#logger.warn(
        {
          category: 'connector.request.failed',
          durationMs: Math.round(performance.now() - startedAt),
          failure,
          errorMessage: error instanceof Error ? error.message : String(error),
          method: init.method ?? 'GET',
          operation,
          ...(status == null ? {} : { status }),
          ...fields,
          ...errorKind(error),
        },
        'Connector request failed.',
      )
      let reason = 'Connector connection failed while sending the request or receiving its response'
      if (failure == 'timeout') reason = `Connector request timed out after ${this.#timeoutMs} ms`
      else if (error instanceof ConnectorTaskError) reason = error.message
      throw new RequestError(error instanceof ConnectorTaskError ? error : unavailable(), reason, status)
    }
  }
}

function connectionRequired(): ConnectorTaskError {
  return new ConnectorTaskError('connector.connection-required', 'The selected Connector Connection must be reconnected or replaced.')
}

function actionNotFound(): ConnectorTaskError {
  return new ConnectorTaskError('connector.action-not-found', 'The Connector Action was not found.')
}

function actionFailure(response: Record<string, unknown>): ConnectorTaskError {
  if (response.success !== false || response.errorCode != 'invalid_input') return unavailable()
  const details = (Array.isArray(response.data) ? response.data : [])
    .flatMap((value) => {
      const item = record(value) ? value : undefined
      return typeof item?.error == 'string' && item.error.length > 0 ? [item.error.slice(0, 300)] : []
    })
    .slice(0, 8)
  const message = details.length == 0 ? 'The Connector Action input is invalid.' : `The Connector Action input is invalid. ${details.join(' ')}`
  return new ConnectorTaskError('connector.input-invalid', message)
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value == 'object' && !Array.isArray(value)
}

async function readJson(response: Response, limit: number, budget?: ResponseBudget): Promise<{ readonly value: unknown; readonly bytes: number }> {
  if (response.body == null) throw unavailable('Connector response has no body')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (budget != null) {
        const responseBytes = budget.used + value.byteLength
        if (responseBytes > budget.limit) throw budget.exhaust(responseBytes)
        budget.used = responseBytes
      }
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel()
        throw unavailable(`Connector response exceeds the ${limit}-byte size limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return { value: JSON.parse(responseDecoder.decode(Buffer.concat(chunks, bytes))) as unknown, bytes }
  } catch {
    throw unavailable('Connector response is not valid JSON')
  }
}

function string(value: unknown, field: string): string {
  if (typeof value != 'string' || value.length == 0) throw unavailable(`Connector response field "${field}" must be a non-empty string.`)
  return value
}

function runtimeData(value: unknown): unknown {
  const source = record(value) ? value : undefined
  if (source == null || source.success !== true || !Object.hasOwn(source, 'data')) {
    throw unavailable('Connector response must contain successful data.')
  }
  return source.data
}

function runtimeList<Value>(value: unknown, decode: (value: unknown) => Value): readonly Value[] {
  if (!Array.isArray(value)) throw unavailable('Connector response data must be an array.')
  return value.map(decode)
}

function runtimeProvider(value: unknown) {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable('Connector Provider must be an object.')
  if (!Array.isArray(source.authTypes) || source.authTypes.some((authType) => typeof authType != 'string')) {
    throw unavailable('Connector Provider authTypes must be an array of strings.')
  }
  if (source.homepageUrl != null && typeof source.homepageUrl != 'string') throw unavailable('Connector Provider homepageUrl must be a string.')
  if (source.iconUrl != null && typeof source.iconUrl != 'string') throw unavailable('Connector Provider iconUrl must be a string.')
  return {
    authenticated: !source.authTypes.includes('no_auth'),
    ...(source.homepageUrl == null || source.homepageUrl.length == 0 ? {} : { homepageUrl: source.homepageUrl }),
    ...(source.iconUrl == null || source.iconUrl.length == 0 ? {} : { icon: source.iconUrl }),
    serviceId: string(source.service, 'provider.service'),
    serviceName: string(source.displayName, 'provider.displayName'),
  }
}

function runtimeAction(value: unknown, search = false): RuntimeAction {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable('Connector Action must be an object.')
  if (typeof source.description != 'string') throw unavailable('Connector Action description must be a string.')
  const name = string(source.name, 'action.name')
  const service = string(source.service, 'action.service')
  return {
    description: source.description,
    id: search ? `${service}.${name}` : string(source.id, 'action.id'),
    inputSchema: source.inputSchema as JsonValue,
    name,
    outputSchema: source.outputSchema as JsonValue,
    service,
  }
}

function runtimeConnection(value: unknown): ConnectorConnection {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable('Connector Connection must be an object.')
  const status = connectionStatus(source.status)
  if (typeof source.isDefault != 'boolean') throw unavailable('Connector Connection isDefault must be a boolean.')
  return {
    ...(source.alias == null ? {} : { alias: string(source.alias, 'connection.alias') }),
    connectionId: string(source.id, 'connection.id'),
    displayName: string(source.displayName, 'connection.displayName'),
    isDefault: source.isDefault,
    serviceId: string(source.service, 'connection.service'),
    status,
  }
}

function runtimeTeam(value: unknown): { readonly id: string; readonly name: string; readonly systemCreated: boolean } {
  if (!record(value)) throw unavailable('Connector Team must be an object.')
  return {
    id: string(value.id, 'team.id'),
    name: string(value.name, 'team.name'),
    systemCreated: value.system_created === true,
  }
}

function connectionStatus(value: unknown): 'active' | 'disconnected' {
  switch (value) {
    case 'active':
      return 'active'
    case 'disconnected':
      return 'disconnected'
    default:
      throw unavailable('Connector Connection status was invalid.')
  }
}

function mapActions(
  actions: readonly RuntimeAction[],
  providers: readonly ReturnType<typeof runtimeProvider>[],
  connections: readonly ConnectorConnection[],
): readonly ConnectorAction[] {
  return actions.map((action) => mapAction(action, providers, connections))
}

function mapAction(
  action: RuntimeAction,
  providers: readonly ReturnType<typeof runtimeProvider>[],
  connections: readonly ConnectorConnection[],
): ConnectorAction {
  const provider = providers.find((candidate) => candidate.serviceId == action.service)
  if (provider == null) throw unavailable('Connector Action referenced an unknown service.')
  const active = connections.filter((connection) => connection.serviceId == action.service && connection.status == 'active')
  const defaultConnection = provider.authenticated
    ? (active.find((connection) => connection.isDefault) ?? (active.length == 1 ? active[0] : undefined))
    : undefined
  let ports: ReturnType<typeof connectorActionPorts>
  try {
    ports = connectorActionPorts(action.inputSchema, action.outputSchema)
  } catch {
    throw unavailable('Connector response is not valid JSON')
  }
  return {
    actionId: action.id,
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
    authenticated: provider.authenticated,
    ...(defaultConnection == null ? {} : { defaultConnection }),
    description: action.description,
    ...(provider.homepageUrl == null ? {} : { homepageUrl: provider.homepageUrl }),
    ...(provider.icon == null ? {} : { icon: provider.icon }),
    inputs: Object.fromEntries(
      ports.inputs.map((port) => {
        if (port.nullable == null) throw unavailable('Connector Action input schema did not declare nullability.')
        return [
          port.handle,
          {
            ...(port.description == null ? {} : { description: port.description }),
            jsonSchema: port.json_schema as JsonValue,
            nullable: port.nullable,
            ...(port.value === undefined ? {} : { value: port.value as JsonValue }),
          },
        ]
      }),
    ),
    name: action.name,
    outputs: Object.fromEntries(
      ports.outputs.map((port) => {
        if (port.nullable == null) throw unavailable('Connector Action output schema did not declare nullability.')
        return [
          port.handle,
          {
            ...(port.description == null ? {} : { description: port.description }),
            jsonSchema: port.json_schema as JsonValue,
            nullable: port.nullable,
          },
        ]
      }),
    ),
    serviceId: action.service,
    serviceName: provider.serviceName,
  }
}

function unavailable(message = 'The Connector request could not be completed.'): ConnectorTaskError {
  return new ConnectorTaskError('connector.unavailable', message)
}

export async function checkCodeActions(
  declarations: readonly ConnectorCapability[],
  connector: ConnectorHost | undefined,
  teamId?: string,
  signal?: AbortSignal,
): Promise<void> {
  if (declarations.length == 0) return
  if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
  const actions = new Map<string, Promise<ConnectorAction>>()
  const catalogs = new Map<string, Promise<readonly ConnectorConnection[]>>()
  for (const declaration of declarations) {
    let action = actions.get(declaration.action)
    if (action == null) {
      action = connector.getAction(declaration.action, signal, teamId)
      actions.set(declaration.action, action)
    }
    const definition = await action
    if (definition.authenticated && declaration.connections.length == 0) throw connectionRequired()
    if (declaration.connections.length == 0) continue
    let catalog = catalogs.get(definition.serviceId)
    if (catalog == null) {
      catalog = connector.listConnections(definition.serviceId, signal, teamId)
      catalogs.set(definition.serviceId, catalog)
    }
    const connections = await catalog
    for (const allowed of declaration.connections) {
      if (
        !connections.some(
          (connection) => connection.connectionId == allowed.connectionId && connection.serviceId == definition.serviceId && connection.status == 'active',
        )
      )
        throw connectionRequired()
    }
  }
}
