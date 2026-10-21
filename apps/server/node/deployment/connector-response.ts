import type { ConnectorActionMetadata, ConnectorConnection } from '@oomol-lab/open-flow/control-api'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorTaskError } from './connector-contract.ts'

import { connectorActionPorts } from '@oomol-lab/open-flow/connector-action'
import { providerIconAppearance } from '@oomol-lab/open-flow/control-api'
import { unavailable } from './connector-contract.ts'

const responseDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

export interface ResponseBudget {
  readonly exhaust: (responseBytes: number) => ConnectorTaskError
  readonly limit: number
  used: number
}
export interface RuntimeAction {
  readonly operationType?: string
  readonly description: string
  readonly id: string
  readonly inputSchema: JsonValue
  readonly name: string
  readonly outputSchema: JsonValue
  readonly service: string
}

export function connectorFailureDetails(value: unknown, token: string): { upstreamErrorCode?: string; upstreamErrorMessage?: string } {
  if (!record(value)) return {}
  const sanitize = (text: string): string => {
    const masked = token == '' ? text : text.replaceAll(token, '[Redacted]')
    if (/(?:authorization|cookie|credential|password|(?:access|refresh|api)[_-]?(?:token|key))\s*["']?\s*[:=]|bearer\s+\S+/i.test(masked)) return '[Redacted]'
    return masked.slice(0, 1_000)
  }
  return {
    ...(typeof value.errorCode == 'string' ? { upstreamErrorCode: sanitize(value.errorCode) } : {}),
    ...(typeof value.message == 'string' ? { upstreamErrorMessage: sanitize(value.message) } : {}),
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value == 'object' && !Array.isArray(value)
}

export async function readJson(response: Response, limit: number, budget?: ResponseBudget): Promise<unknown> {
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
    return JSON.parse(responseDecoder.decode(Buffer.concat(chunks, bytes))) as unknown
  } catch {
    throw unavailable('Connector response is not valid JSON')
  }
}

function string(value: unknown, field: string): string {
  if (typeof value != 'string' || value.length == 0) throw unavailable(`Connector response field "${field}" must be a non-empty string.`)
  return value
}

export function runtimeData(value: unknown): unknown {
  const source = record(value) ? value : undefined
  if (source == null || source.success !== true || !Object.hasOwn(source, 'data')) {
    throw unavailable('Connector response must contain successful data.')
  }
  return source.data
}

export function runtimeList<Value>(value: unknown, decode: (value: unknown) => Value): readonly Value[] {
  if (!Array.isArray(value)) throw unavailable('Connector response data must be an array.')
  return value.map(decode)
}

export function runtimeProvider(value: unknown, metadata?: unknown) {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable('Connector Provider must be an object.')
  if (!Array.isArray(source.authTypes) || source.authTypes.some((authType) => typeof authType != 'string')) {
    throw unavailable('Connector Provider authTypes must be an array of strings.')
  }
  if (source.homepageUrl != null && typeof source.homepageUrl != 'string') throw unavailable('Connector Provider homepageUrl must be a string.')
  if (source.iconUrl != null && typeof source.iconUrl != 'string') throw unavailable('Connector Provider iconUrl must be a string.')
  return {
    ...providerIconAppearance(metadata, source.iconSpritePosition),
    authenticated: !source.authTypes.includes('no_auth'),
    noSetup: source.authTypes.length == 1 && source.authTypes[0] == 'no_auth',
    ...(source.homepageUrl == null || source.homepageUrl.length == 0 ? {} : { homepageUrl: source.homepageUrl }),
    ...(source.iconUrl == null || source.iconUrl.length == 0 ? {} : { icon: source.iconUrl }),
    serviceId: string(source.service, 'provider.service'),
    serviceName: string(source.displayName, 'provider.displayName'),
  }
}

export function runtimeAction(value: unknown, search = false): RuntimeAction {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable('Connector Action must be an object.')
  if (typeof source.description != 'string') throw unavailable('Connector Action description must be a string.')
  const name = string(source.name, 'action.name')
  const service = string(source.service, 'action.service')
  return {
    ...(source.operationType == null ? {} : { operationType: string(source.operationType, 'action.operationType') }),
    description: source.description,
    id: search ? `${service}.${name}` : string(source.id, 'action.id'),
    inputSchema: source.inputSchema as JsonValue,
    name,
    outputSchema: source.outputSchema as JsonValue,
    service,
  }
}

export function runtimeConnection(value: unknown): ConnectorConnection {
  const source = record(value) ? value : undefined
  if (source == null) throw unavailable('Connector Connection must be an object.')
  const status = connectionStatus(source.status)
  if (typeof source.isDefault != 'boolean') throw unavailable('Connector Connection isDefault must be a boolean.')
  return {
    ...(source.providerAccountId == null ? {} : { providerAccountId: string(source.providerAccountId, 'connection.providerAccountId') }),
    ...(source.alias == null ? {} : { alias: string(source.alias, 'connection.alias') }),
    ...(source.marketplace == null ? {} : { builtInAccount: true }),
    connectionId: string(source.id, 'connection.id'),
    displayName: string(source.displayName, 'connection.displayName'),
    isDefault: source.isDefault,
    serviceId: string(source.service, 'connection.service'),
    status,
  }
}

export function runtimeTeam(value: unknown): { readonly id: string; readonly name: string; readonly systemCreated: boolean } {
  if (!record(value)) throw unavailable('Connector Team must be an object.')
  return {
    id: string(value.id, 'team.id'),
    name: string(value.name, 'team.name'),
    systemCreated: value.system_created === true,
  }
}

function connectionStatus(value: unknown): ConnectorConnection['status'] {
  switch (value) {
    case 'active':
    case 'disconnected':
    case 'error':
    case 'reauth_required':
      return value
    default:
      throw unavailable('Connector Connection status was invalid.')
  }
}

export function mapActions(actions: readonly RuntimeAction[], providers: readonly ReturnType<typeof runtimeProvider>[]): readonly ConnectorActionMetadata[] {
  return actions.map((action) => mapAction(action, providers))
}

export function mapAction(action: RuntimeAction, providers: readonly ReturnType<typeof runtimeProvider>[]): ConnectorActionMetadata {
  const provider = providers.find((candidate) => candidate.serviceId == action.service)
  if (provider == null) throw unavailable('Connector Action referenced an unknown service.')
  let ports: ReturnType<typeof connectorActionPorts>
  try {
    ports = connectorActionPorts(action.inputSchema, action.outputSchema)
  } catch {
    throw unavailable('Connector response is not valid JSON')
  }
  return {
    actionId: action.id,
    ...(action.operationType == null ? {} : { operationType: action.operationType }),
    inputSchema: action.inputSchema,
    outputSchema: action.outputSchema,
    authenticated: provider.authenticated,
    description: action.description,
    ...(provider.homepageUrl == null ? {} : { homepageUrl: provider.homepageUrl }),
    ...(provider.icon == null ? {} : { icon: provider.icon }),
    ...(provider.iconSprite == null ? {} : { iconSprite: provider.iconSprite, iconSpritePosition: provider.iconSpritePosition }),
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
