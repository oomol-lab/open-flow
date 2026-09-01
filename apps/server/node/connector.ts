import type { ConnectorProxyRequest, ConnectorProxyResult } from '@oomol-lab/open-flow/connector-proxy'
import type { ConnectorAction, ConnectorConnection, ConnectorProvider } from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { Logger } from 'pino'

import { connectorActionPorts } from '@oomol-lab/open-flow/connector-action'
import { errorKind, silentLogger } from './logger.ts'

const maxResponseBytes = 1024 * 1024
const maxActionCatalogBytes = 8 * 1024 * 1024
const catalogConcurrency = 16
const readinessTimeoutMs = 1_000

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
  getAction(actionId: string, signal?: AbortSignal, teamId?: string): Promise<ConnectorAction>
  listActions(serviceId?: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorAction[]>
  listConnections(serviceId: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorConnection[]>
  listProviders(signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorProvider[]>
  proxy(
    provider: string,
    connectionId: string,
    rateLimitId: string,
    request: ConnectorProxyRequest,
    signal: AbortSignal,
    teamId?: string,
  ): Promise<ConnectorProxyResult>
  ready(): Promise<boolean>
  searchActions(query: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorAction[]>
}

export type ConnectorErrorCode = 'connector.action-not-found' | 'connector.connection-required' | 'connector.unavailable' | 'connector.unconfigured'

export class ConnectorTaskError extends Error {
  readonly code: ConnectorErrorCode

  constructor(code: ConnectorErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'ConnectorTaskError'
  }
}

export class ConnectorClient implements ConnectorHost {
  readonly #logger: Logger
  readonly #origin: URL
  readonly #teamOrigin?: URL
  readonly #timeoutMs: number
  readonly #token: string

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

  async listProviders(signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorProvider[]> {
    return (await this.#providers(signal, teamId)).map((provider) =>
      Object.assign(
        { serviceId: provider.serviceId, serviceName: provider.serviceName },
        provider.homepageUrl == null ? {} : { homepageUrl: provider.homepageUrl },
        provider.icon == null ? {} : { icon: provider.icon },
      ),
    )
  }

  async #providers(signal?: AbortSignal, teamId?: string) {
    const response = await this.#request('providers.list', 'v1/providers', { method: 'GET' }, signal, { teamId })
    if (!response.ok) throw unavailable()
    return this.#decode('providers.list', {}, () => runtimeList(runtimeData(response.value), runtimeProvider))
  }

  async listActions(serviceId?: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorAction[]> {
    if (serviceId != null) {
      const [providers, connections, actions] = await Promise.all([
        this.#providers(signal, teamId),
        this.#connections(serviceId, signal, teamId),
        this.#actions(`v1/actions?service=${encodeURIComponent(serviceId)}`, false, signal, teamId, { serviceId }),
      ])
      return this.#decode('actions.list', { serviceId }, () => mapActions(actions, providers, connections))
    }
    const [providers, connections] = await Promise.all([this.#providers(signal, teamId), this.#connections(undefined, signal, teamId)])
    const catalogs: (readonly RuntimeAction[])[] = []
    const controller = new AbortController()
    const requestSignal = signal == null ? controller.signal : AbortSignal.any([signal, controller.signal])
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
        controller.abort(catalogError)
        return catalogError
      },
      limit: maxActionCatalogBytes,
      used: 0,
    }
    let next = 0
    try {
      await Promise.all(
        Array.from({ length: Math.min(catalogConcurrency, providers.length) }, async () => {
          while (next < providers.length) {
            const index = next++
            const provider = providers[index]
            if (provider == null) return
            const current = await this.#actions(
              `v1/actions?service=${encodeURIComponent(provider.serviceId)}`,
              false,
              requestSignal,
              teamId,
              {
                serviceId: provider.serviceId,
              },
              budget,
            )
            catalogs[index] = current
          }
        }),
      )
    } catch (error) {
      controller.abort(error)
      throw error
    }
    const actions = catalogs.flat()
    return this.#decode('actions.list', {}, () => mapActions(actions, providers, connections))
  }

  async searchActions(query: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorAction[]> {
    const [providers, connections, actions] = await Promise.all([
      this.#providers(signal, teamId),
      this.#connections(undefined, signal, teamId),
      this.#actions(`v1/actions/search?q=${encodeURIComponent(query)}`, true, signal, teamId),
    ])
    return this.#decode('actions.search', {}, () => mapActions(actions, providers, connections))
  }

  async getAction(actionId: string, signal?: AbortSignal, teamId?: string): Promise<ConnectorAction> {
    const [providers, connections, response] = await Promise.all([
      this.#providers(signal, teamId),
      this.#connections(undefined, signal, teamId),
      this.#request('actions.get', `v1/actions/${encodeURIComponent(actionId)}`, { method: 'GET' }, signal, { fields: { actionId }, teamId }),
    ])
    if (!response.ok) {
      const failure = record(response.value) ? response.value : undefined
      if (failure?.success === false && failure.errorCode === 'unknown_action') throw actionNotFound()
      throw unavailable()
    }
    return this.#decode('actions.get', { actionId }, () => mapAction(runtimeAction(runtimeData(response.value)), providers, connections))
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
      { fields: { actionId: action, ...(connectionId == null ? {} : { connectionId }), invocationId }, teamId },
    )
    const response = actionResponse.value
    if (!record(response)) throw unavailable()
    if (actionResponse.ok && response.success === true && Object.hasOwn(response, 'data')) return response.data as JsonValue
    if (response.errorCode === 'connection_not_allowed' || response.errorCode === 'connection_not_found') throw connectionRequired()
    throw actionFailure(response)
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
    budget?: { readonly exhaust: (responseBytes: number) => ConnectorTaskError; readonly limit: number; used: number },
  ): Promise<readonly RuntimeAction[]> {
    const response = await this.#request(search ? 'actions.search' : 'actions.list', path, { method: 'GET' }, signal, {
      budget,
      fields,
      maximumResponseBytes: search ? maxResponseBytes : maxActionCatalogBytes,
      teamId,
    })
    if (!response.ok) throw unavailable()
    return this.#decode(search ? 'actions.search' : 'actions.list', fields, () => runtimeList(runtimeData(response.value), runtimeAction))
  }

  async #connections(serviceId?: string, signal?: AbortSignal, teamId?: string): Promise<readonly ConnectorConnection[]> {
    const path = serviceId == null ? 'v1/apps' : `v1/apps/services/${encodeURIComponent(serviceId)}`
    const response = await this.#request('connections.list', path, { method: 'GET' }, signal, {
      fields: serviceId == null ? {} : { serviceId },
      teamId,
    })
    if (!response.ok) throw unavailable()
    const fields: Readonly<Record<string, string>> = serviceId == null ? {} : { serviceId }
    return this.#decode('connections.list', fields, () => {
      const connections = runtimeList(runtimeData(response.value), runtimeConnection)
      if (serviceId != null && connections.some((connection) => connection.serviceId != serviceId)) throw unavailable()
      return connections
    })
  }

  #decode<Value>(operation: string, fields: Readonly<Record<string, string>>, decode: () => Value): Value {
    try {
      return decode()
    } catch (error) {
      this.#logger.warn(
        { category: 'connector.request.failed', failure: 'response-invalid', operation, ...fields, ...errorKind(error) },
        'Connector response was invalid.',
      )
      if (error instanceof ConnectorTaskError) throw error
      throw unavailable()
    }
  }

  async #resolveConnection(connectionId: string, service: string, signal: AbortSignal, teamId?: string): Promise<string> {
    const fields = { connectionId, provider: service }
    const appsResponse = await this.#request('connection.resolve', 'v1/apps', { method: 'GET' }, signal, { fields, teamId })
    const apps = appsResponse.value
    if (!appsResponse.ok || !record(apps) || apps.success !== true || !Array.isArray(apps.data)) throw unavailable()
    const connection = apps.data.find((value) => record(value) && value.id === connectionId)
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
      fields = {},
      maximumResponseBytes = maxResponseBytes,
      origin = this.#origin,
      teamId,
    }: {
      readonly budget?: { readonly exhaust: (responseBytes: number) => ConnectorTaskError; readonly limit: number; used: number }
      readonly fields?: Readonly<Record<string, string>>
      readonly maximumResponseBytes?: number
      readonly origin?: URL
      readonly teamId?: string
    } = {},
  ): Promise<{ readonly ok: boolean; readonly value: unknown }> {
    const startedAt = performance.now()
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    let status: number | undefined
    try {
      const response = await fetch(new URL(path, origin), {
        ...init,
        headers: {
          ...(this.#token == '' ? {} : { authorization: `Bearer ${this.#token}` }),
          ...(origin == this.#origin && teamId != null ? { 'x-oo-team-id': teamId } : {}),
          ...init.headers,
        },
        redirect: 'error',
        signal: signal == null ? timeout : AbortSignal.any([signal, timeout]),
      })
      status = response.status
      const value = await readJson(response, maximumResponseBytes, budget)
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
      return { ok: response.ok, value }
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
          method: init.method ?? 'GET',
          operation,
          ...(status == null ? {} : { status }),
          ...fields,
          ...errorKind(error),
        },
        'Connector request failed.',
      )
      if (error instanceof ConnectorTaskError) throw error
      throw unavailable()
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
  if (response.errorCode != 'invalid_input' || !Array.isArray(response.data)) return unavailable()
  const details = response.data
    .flatMap((value) => {
      const item = record(value) ? value : undefined
      return typeof item?.error == 'string' && item.error.length > 0 ? [item.error.slice(0, 300)] : []
    })
    .slice(0, 8)
  const message = details.length == 0 ? 'The Connector Action input is invalid.' : `The Connector Action input is invalid. ${details.join(' ')}`
  return new ConnectorTaskError('connector.unavailable', message)
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value == 'object' && !Array.isArray(value)
}

async function readJson(
  response: Response,
  limit: number,
  budget?: { readonly exhaust: (responseBytes: number) => ConnectorTaskError; readonly limit: number; used: number },
): Promise<unknown> {
  if (response.body == null) throw unavailable()
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
        throw unavailable()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown
  } catch {
    throw unavailable()
  }
}

function string(value: unknown): string {
  if (typeof value != 'string' || value.length == 0) throw unavailable()
  return value
}

function runtimeData(value: unknown): unknown {
  const source = record(value) ? value : undefined
  if (source == null || source.success !== true || !Object.hasOwn(source, 'data')) throw unavailable()
  return source.data
}

function runtimeList<Value>(value: unknown, decode: (value: unknown) => Value): readonly Value[] {
  if (!Array.isArray(value)) throw unavailable()
  return value.map(decode)
}

function runtimeProvider(value: unknown) {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable()
  if (!Array.isArray(source.authTypes) || source.authTypes.some((authType) => typeof authType != 'string')) throw unavailable()
  if (source.homepageUrl != null && typeof source.homepageUrl != 'string') throw unavailable()
  if (source.iconUrl != null && typeof source.iconUrl != 'string') throw unavailable()
  return {
    authenticated: !source.authTypes.includes('no_auth'),
    ...(source.homepageUrl == null || source.homepageUrl.length == 0 ? {} : { homepageUrl: source.homepageUrl }),
    ...(source.iconUrl == null || source.iconUrl.length == 0 ? {} : { icon: source.iconUrl }),
    serviceId: string(source.service),
    serviceName: string(source.displayName),
  }
}

function runtimeAction(value: unknown): RuntimeAction {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable()
  if (typeof source.description != 'string') throw unavailable()
  return {
    description: source.description,
    id: string(source.id),
    inputSchema: source.inputSchema as JsonValue,
    name: string(source.name),
    outputSchema: source.outputSchema as JsonValue,
    service: string(source.service),
  }
}

function runtimeConnection(value: unknown): ConnectorConnection {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable()
  const status = connectionStatus(source.status)
  if (typeof source.isDefault != 'boolean') throw unavailable()
  return {
    connectionId: string(source.id),
    displayName: string(source.displayName),
    isDefault: source.isDefault,
    serviceId: string(source.service),
    status,
  }
}

function runtimeTeam(value: unknown): { readonly id: string; readonly name: string; readonly systemCreated: boolean } {
  if (!record(value)) throw unavailable()
  return {
    id: string(value.id),
    name: string(value.name),
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
      throw unavailable()
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
  if (provider == null) throw unavailable()
  const active = connections.filter((connection) => connection.serviceId == action.service && connection.status == 'active')
  const defaultConnection = provider.authenticated
    ? (active.find((connection) => connection.isDefault) ?? (active.length == 1 ? active[0] : undefined))
    : undefined
  let ports: ReturnType<typeof connectorActionPorts>
  try {
    ports = connectorActionPorts(action.inputSchema, action.outputSchema)
  } catch {
    throw unavailable()
  }
  return {
    actionId: action.id,
    authenticated: provider.authenticated,
    ...(defaultConnection == null ? {} : { defaultConnection }),
    description: action.description,
    ...(provider.homepageUrl == null ? {} : { homepageUrl: provider.homepageUrl }),
    ...(provider.icon == null ? {} : { icon: provider.icon }),
    inputs: Object.fromEntries(
      ports.inputs.map((port) => {
        if (port.nullable == null) throw unavailable()
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
        if (port.nullable == null) throw unavailable()
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

function unavailable(): ConnectorTaskError {
  return new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.')
}
