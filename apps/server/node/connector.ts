import type { ConnectorProxyRequest, ConnectorProxyResult } from '@oomol-lab/open-flow/connector-proxy'
import type { ConnectorAction, ConnectorConnection, ConnectorProvider } from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { Logger } from 'pino'

import { connectorActionPorts } from '@oomol-lab/open-flow/connector-action'
import { errorKind, silentLogger } from './logger.ts'

const maxResponseBytes = 1024 * 1024
const maxActionCatalogBytes = 8 * 1024 * 1024
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
  execute(action: string, connectionId: string, input: Readonly<Record<string, JsonValue>>, invocationId: string, signal: AbortSignal): Promise<JsonValue>
  getAction(actionId: string, signal?: AbortSignal): Promise<ConnectorAction>
  listActions(serviceId?: string, signal?: AbortSignal): Promise<readonly ConnectorAction[]>
  listConnections(serviceId: string, signal?: AbortSignal): Promise<readonly ConnectorConnection[]>
  listProviders(signal?: AbortSignal): Promise<readonly ConnectorProvider[]>
  proxy(provider: string, connectionId: string, rateLimitId: string, request: ConnectorProxyRequest, signal: AbortSignal): Promise<ConnectorProxyResult>
  ready(): Promise<boolean>
  searchActions(query: string, signal?: AbortSignal): Promise<readonly ConnectorAction[]>
}

export type ConnectorErrorCode = 'connector.action-not-found' | 'connector.connection-required' | 'connector.unavailable'

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
    this.#timeoutMs = timeoutMs
    this.#token = token
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

  async listProviders(signal?: AbortSignal): Promise<readonly ConnectorProvider[]> {
    const response = await this.#request('providers.list', 'v1/providers', { method: 'GET' }, signal)
    if (!response.ok) throw unavailable()
    return runtimeList(runtimeData(response.value), runtimeProvider)
  }

  async listActions(serviceId?: string, signal?: AbortSignal): Promise<readonly ConnectorAction[]> {
    if (serviceId != null) {
      const [providers, connections, actions] = await Promise.all([
        this.listProviders(signal),
        this.#connections(serviceId, signal),
        this.#actions(`v1/actions?service=${encodeURIComponent(serviceId)}`, false, signal),
      ])
      return mapActions(actions, providers, connections)
    }
    const [providers, connections] = await Promise.all([this.listProviders(signal), this.#connections(undefined, signal)])
    const actions: RuntimeAction[] = []
    let bytes = 0
    for (const provider of providers) {
      const current = await this.#actions(`v1/actions?service=${encodeURIComponent(provider.serviceId)}`, false, signal)
      bytes += Buffer.byteLength(JSON.stringify(current))
      if (bytes > maxActionCatalogBytes) throw unavailable()
      actions.push(...current)
    }
    return mapActions(actions, providers, connections)
  }

  async searchActions(query: string, signal?: AbortSignal): Promise<readonly ConnectorAction[]> {
    const [providers, connections, actions] = await Promise.all([
      this.listProviders(signal),
      this.#connections(undefined, signal),
      this.#actions(`v1/actions/search?q=${encodeURIComponent(query)}`, true, signal),
    ])
    return mapActions(actions, providers, connections)
  }

  async getAction(actionId: string, signal?: AbortSignal): Promise<ConnectorAction> {
    const [providers, connections, response] = await Promise.all([
      this.listProviders(signal),
      this.#connections(undefined, signal),
      this.#request('actions.get', `v1/actions/${encodeURIComponent(actionId)}`, { method: 'GET' }, signal, maxResponseBytes, { actionId }),
    ])
    if (!response.ok) {
      const failure = record(response.value) ? response.value : undefined
      if (failure?.success === false && failure.errorCode === 'unknown_action') throw actionNotFound()
      throw unavailable()
    }
    return mapAction(runtimeAction(runtimeData(response.value)), providers, connections)
  }

  async listConnections(serviceId: string, signal?: AbortSignal): Promise<readonly ConnectorConnection[]> {
    return await this.#connections(serviceId, signal)
  }

  async execute(
    action: string,
    connectionId: string,
    input: Readonly<Record<string, JsonValue>>,
    invocationId: string,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    const separator = action.indexOf('.')
    if (separator <= 0) throw connectionRequired()
    const alias = await this.#resolveConnection(connectionId, action.slice(0, separator), signal)

    const actionResponse = await this.#request(
      'action.execute',
      `v1/actions/${encodeURIComponent(action)}`,
      {
        body: JSON.stringify({ input }),
        headers: {
          'content-type': 'application/json',
          'idempotency-key': invocationId,
          'x-oo-connector-alias': alias,
        },
        method: 'POST',
      },
      signal,
      maxResponseBytes,
      { actionId: action, connectionId, invocationId },
    )
    const response = actionResponse.value
    if (!record(response)) throw unavailable()
    if (actionResponse.ok && response.success === true && Object.hasOwn(response, 'data')) return response.data as JsonValue
    if (response.errorCode === 'connection_not_allowed' || response.errorCode === 'connection_not_found') throw connectionRequired()
    throw actionFailure(response)
  }

  async proxy(provider: string, connectionId: string, rateLimitId: string, request: ConnectorProxyRequest, signal: AbortSignal): Promise<ConnectorProxyResult> {
    const alias = await this.#resolveConnection(connectionId, provider, signal)
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
      maxResponseBytes,
      { connectionId, provider, rateLimitId },
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

  async #actions(path: string, search: boolean, signal?: AbortSignal): Promise<readonly RuntimeAction[]> {
    const response = await this.#request(
      search ? 'actions.search' : 'actions.list',
      path,
      { method: 'GET' },
      signal,
      search ? maxResponseBytes : maxActionCatalogBytes,
    )
    if (!response.ok) throw unavailable()
    return runtimeList(runtimeData(response.value), runtimeAction)
  }

  async #connections(serviceId?: string, signal?: AbortSignal): Promise<readonly ConnectorConnection[]> {
    const path = serviceId == null ? 'v1/apps' : `v1/apps/services/${encodeURIComponent(serviceId)}`
    const response = await this.#request('connections.list', path, { method: 'GET' }, signal, maxResponseBytes, serviceId == null ? {} : { serviceId })
    if (!response.ok) throw unavailable()
    const connections = runtimeList(runtimeData(response.value), runtimeConnection)
    if (serviceId != null && connections.some((connection) => connection.serviceId != serviceId)) throw unavailable()
    return connections
  }

  async #resolveConnection(connectionId: string, service: string, signal: AbortSignal): Promise<string> {
    const fields = { connectionId, provider: service }
    const appsResponse = await this.#request('connection.resolve', 'v1/apps', { method: 'GET' }, signal, maxResponseBytes, fields)
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
    maximumResponseBytes = maxResponseBytes,
    fields: Readonly<Record<string, string>> = {},
  ): Promise<{ readonly ok: boolean; readonly value: unknown }> {
    const startedAt = performance.now()
    const timeout = AbortSignal.timeout(this.#timeoutMs)
    let status: number | undefined
    try {
      const response = await fetch(new URL(path, this.#origin), {
        ...init,
        headers: {
          ...(this.#token == '' ? {} : { authorization: `Bearer ${this.#token}` }),
          ...init.headers,
        },
        redirect: 'error',
        signal: signal == null ? timeout : AbortSignal.any([signal, timeout]),
      })
      status = response.status
      const value = await readJson(response, maximumResponseBytes)
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

async function readJson(response: Response, limit: number): Promise<unknown> {
  if (response.body == null) throw unavailable()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
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

function runtimeProvider(value: unknown): ConnectorProvider {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable()
  if (source.iconUrl != null && typeof source.iconUrl != 'string') throw unavailable()
  return {
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
  providers: readonly ConnectorProvider[],
  connections: readonly ConnectorConnection[],
): readonly ConnectorAction[] {
  return actions.map((action) => mapAction(action, providers, connections))
}

function mapAction(action: RuntimeAction, providers: readonly ConnectorProvider[], connections: readonly ConnectorConnection[]): ConnectorAction {
  const provider = providers.find((candidate) => candidate.serviceId == action.service)
  if (provider == null) throw unavailable()
  const active = connections.filter((connection) => connection.serviceId == action.service && connection.status == 'active')
  const defaultConnection = active.find((connection) => connection.isDefault) ?? (active.length == 1 ? active[0] : undefined)
  let ports: ReturnType<typeof connectorActionPorts>
  try {
    ports = connectorActionPorts(action.inputSchema, action.outputSchema)
  } catch {
    throw unavailable()
  }
  return {
    actionId: action.id,
    ...(defaultConnection == null ? {} : { defaultConnection }),
    description: action.description,
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
