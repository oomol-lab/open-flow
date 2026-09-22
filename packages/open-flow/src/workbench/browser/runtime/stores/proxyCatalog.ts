import type { ConnectorActionMetadata, ConnectorConnection, ConnectorProvider } from '../api.ts'

import { connectorActionPorts } from '../../../../connector/common/actionSchema.ts'
import { invalidResponse, jsonValue, record, string } from '../../../../control/common/decoding.ts'
import { ApiError } from '../api.ts'

export interface ProxyResponse {
  readonly success: true
  readonly data: readonly Readonly<Record<string, unknown>>[]
  readonly [key: string]: unknown
}

/** Validate the fields we consume without discarding upstream representation fields. */
export function proxyResponse(value: unknown, validate?: (item: Readonly<Record<string, unknown>>) => unknown): ProxyResponse {
  const source = record(value)
  if (source.success === false)
    throw new ApiError(
      502,
      typeof source.errorCode == 'string' ? source.errorCode : 'connector.unavailable',
      typeof source.message == 'string' ? source.message : 'Connector request failed.',
    )
  if (source.success !== true || !Array.isArray(source.data)) return invalidResponse()
  if (validate != null) for (const item of source.data) validate(record(item))
  return source as unknown as ProxyResponse
}

export function provider(source: Readonly<Record<string, unknown>>): ConnectorProvider {
  if (!Array.isArray(source.authTypes) || source.authTypes.some((item) => typeof item != 'string')) return invalidResponse()
  return {
    serviceId: string(source.service),
    serviceName: string(source.displayName),
    noSetup: source.authTypes.length == 1 && source.authTypes[0] == 'no_auth',
    ...(source.iconUrl == null || source.iconUrl === '' ? {} : { icon: string(source.iconUrl) }),
    ...(source.homepageUrl == null || source.homepageUrl === '' ? {} : { homepageUrl: string(source.homepageUrl) }),
  }
}

export function app(source: Readonly<Record<string, unknown>>): ConnectorConnection {
  if (
    typeof source.isDefault != 'boolean' ||
    typeof source.status != 'string' ||
    !['active', 'disconnected', 'error', 'reauth_required'].includes(source.status)
  )
    return invalidResponse()
  return {
    connectionId: string(source.id),
    serviceId: string(source.service),
    displayName: string(source.displayName),
    isDefault: source.isDefault,
    status: source.status as ConnectorConnection['status'],
    ...(source.alias == null ? {} : { alias: string(source.alias) }),
    ...(source.marketplace == null ? {} : { builtInAccount: true }),
  }
}

export function validateAction(source: Readonly<Record<string, unknown>>): void {
  string(source.id)
  string(source.service)
  string(source.name)
  if (typeof source.description != 'string') return invalidResponse()
  connectorActionPorts(source.inputSchema, source.outputSchema)
}

function port(item: ReturnType<typeof connectorActionPorts>['inputs'][number]) {
  return {
    nullable: item.nullable,
    jsonSchema: jsonValue(item.json_schema),
    ...(item.description == null ? {} : { description: item.description }),
    ...(item.value === undefined ? {} : { value: jsonValue(item.value) }),
  }
}

export function action(source: Readonly<Record<string, unknown>>, providers: ProxyResponse): ConnectorActionMetadata {
  const owner = providers.data.find((item) => item.service == source.service)
  if (owner == null) return invalidResponse()
  const display = provider(owner)
  const ports = connectorActionPorts(source.inputSchema, source.outputSchema)

  return {
    serviceId: display.serviceId,
    serviceName: display.serviceName,
    ...(display.icon == null ? {} : { icon: display.icon }),
    ...(display.homepageUrl == null ? {} : { homepageUrl: display.homepageUrl }),
    actionId: string(source.id),
    ...(source.operationType == null ? {} : { operationType: string(source.operationType) }),
    name: string(source.name),
    description: source.description as string,
    authenticated: !(owner.authTypes as readonly string[]).includes('no_auth'),
    inputSchema: jsonValue(source.inputSchema),
    outputSchema: jsonValue(source.outputSchema),
    inputs: Object.fromEntries(ports.inputs.map((item) => [item.handle, port(item)])),
    outputs: Object.fromEntries(ports.outputs.map((item) => [item.handle, port(item)])),
  }
}
