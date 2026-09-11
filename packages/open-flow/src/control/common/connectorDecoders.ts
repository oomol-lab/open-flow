import type { InputPortDefinition } from '../../flow/common/change.ts'
import type { ConnectorAction, ConnectorConnection, ConnectorProvider } from './api.ts'

import { exact, invalidResponse, jsonValue, record, string } from './decoding.ts'

export function connection(value: unknown): ConnectorConnection {
  const source = record(value)
  exact(source, [...(Object.hasOwn(source, 'alias') ? ['alias'] : []), 'connectionId', 'displayName', 'isDefault', 'serviceId', 'status'])
  const status = source.status
  if (status != 'active' && status != 'disconnected' && status != 'error' && status != 'reauth_required') return invalidResponse()
  if (typeof source.isDefault != 'boolean') return invalidResponse()
  return {
    ...(source.alias === undefined ? {} : { alias: string(source.alias) }),
    connectionId: string(source.connectionId),
    displayName: string(source.displayName),
    isDefault: source.isDefault,
    serviceId: string(source.serviceId),
    status: status as ConnectorConnection['status'],
  }
}

function port(value: unknown, input = false): InputPortDefinition {
  const source = record(value)
  const description = source.description
  const hasValue = input && Object.hasOwn(source, 'value')
  exact(source, ['jsonSchema', 'nullable', ...(description == null ? [] : ['description']), ...(hasValue ? ['value'] : [])])
  if (description != null && typeof description != 'string') return invalidResponse()
  if (typeof source.nullable != 'boolean') return invalidResponse()
  return {
    ...(description == null ? {} : { description }),
    jsonSchema: jsonValue(source.jsonSchema),
    nullable: source.nullable,
    ...(hasValue ? { value: jsonValue(source.value) } : {}),
  }
}

function inputPort(value: unknown): InputPortDefinition {
  return port(value, true)
}

function ports<Value>(value: unknown, decode: (value: unknown) => Value): Readonly<Record<string, Value>> {
  return Object.fromEntries(Object.entries(record(value)).map(([handle, candidate]) => [handle, decode(candidate)]))
}

export function connectorAction(value: unknown): ConnectorAction {
  const source = record(value)
  const homepageUrl = source.homepageUrl
  const icon = source.icon
  const hasConnection = source.defaultConnection != null
  exact(source, [
    'actionId',
    ...(Object.hasOwn(source, 'inputSchema') ? ['inputSchema'] : []),
    ...(Object.hasOwn(source, 'outputSchema') ? ['outputSchema'] : []),
    'authenticated',
    ...(hasConnection ? ['defaultConnection'] : []),
    'description',
    ...(homepageUrl == null ? [] : ['homepageUrl']),
    ...(icon == null ? [] : ['icon']),
    'inputs',
    'name',
    'outputs',
    'serviceId',
    'serviceName',
  ])
  if ((homepageUrl != null && typeof homepageUrl != 'string') || (icon != null && typeof icon != 'string')) return invalidResponse()
  const result: ConnectorAction = {
    ...(source.inputSchema === undefined ? {} : { inputSchema: jsonValue(source.inputSchema) }),
    ...(source.outputSchema === undefined ? {} : { outputSchema: jsonValue(source.outputSchema) }),
    actionId: string(source.actionId),
    authenticated: typeof source.authenticated == 'boolean' ? source.authenticated : invalidResponse(),
    ...(hasConnection ? { defaultConnection: connection(source.defaultConnection) } : {}),
    description: typeof source.description == 'string' ? source.description : invalidResponse(),
    ...(homepageUrl == null ? {} : { homepageUrl }),
    ...(icon == null ? {} : { icon }),
    inputs: ports(source.inputs, inputPort),
    name: string(source.name),
    outputs: ports(source.outputs, port),
    serviceId: string(source.serviceId),
    serviceName: string(source.serviceName),
  }
  if (result.defaultConnection != null && (result.defaultConnection.serviceId != result.serviceId || result.defaultConnection.status != 'active')) {
    return invalidResponse()
  }
  return result
}

export function connectorProvider(value: unknown): ConnectorProvider {
  const source = record(value)
  const homepageUrl = source.homepageUrl
  const icon = source.icon
  exact(source, ['serviceId', 'serviceName', ...(homepageUrl == null ? [] : ['homepageUrl']), ...(icon == null ? [] : ['icon'])])
  if ((homepageUrl != null && typeof homepageUrl != 'string') || (icon != null && typeof icon != 'string')) return invalidResponse()
  return {
    ...(homepageUrl == null ? {} : { homepageUrl }),
    ...(icon == null ? {} : { icon }),
    serviceId: string(source.serviceId),
    serviceName: string(source.serviceName),
  }
}
