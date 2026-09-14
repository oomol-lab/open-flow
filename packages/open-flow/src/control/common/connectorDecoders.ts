import type { InputPortDefinition } from '../../flow/common/change.ts'
import type { ConnectorAction, ConnectorActionMetadata, ConnectorConnection, ConnectorProvider } from './api.ts'

import { exact, invalidResponse, jsonValue, record, string } from './decoding.ts'

export function connection(value: unknown): ConnectorConnection {
  const source = record(value)
  exact(source, [
    ...(Object.hasOwn(source, 'providerAccountId') ? ['providerAccountId'] : []),
    ...(Object.hasOwn(source, 'alias') ? ['alias'] : []),
    ...(Object.hasOwn(source, 'builtInAccount') ? ['builtInAccount'] : []),
    'connectionId',
    'displayName',
    'isDefault',
    'serviceId',
    'status',
  ])
  if (source.builtInAccount !== undefined && typeof source.builtInAccount != 'boolean') return invalidResponse()
  const status = source.status
  if (status != 'active' && status != 'disconnected' && status != 'error' && status != 'reauth_required') return invalidResponse()
  if (typeof source.isDefault != 'boolean') return invalidResponse()
  return {
    ...(source.providerAccountId === undefined ? {} : { providerAccountId: string(source.providerAccountId) }),
    ...(source.alias === undefined ? {} : { alias: string(source.alias) }),
    ...(source.builtInAccount === undefined ? {} : { builtInAccount: source.builtInAccount }),
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

export function connectorActionMetadata(value: unknown): ConnectorActionMetadata {
  const source = record(value)
  const homepageUrl = source.homepageUrl
  const icon = source.icon
  exact(source, [
    'actionId',
    ...(Object.hasOwn(source, 'operationType') ? ['operationType'] : []),
    ...(Object.hasOwn(source, 'inputSchema') ? ['inputSchema'] : []),
    ...(Object.hasOwn(source, 'outputSchema') ? ['outputSchema'] : []),
    'authenticated',
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
  const result: ConnectorActionMetadata = {
    ...(source.inputSchema === undefined ? {} : { inputSchema: jsonValue(source.inputSchema) }),
    ...(source.outputSchema === undefined ? {} : { outputSchema: jsonValue(source.outputSchema) }),
    actionId: string(source.actionId),
    ...(source.operationType == null ? {} : { operationType: string(source.operationType) }),
    authenticated: typeof source.authenticated == 'boolean' ? source.authenticated : invalidResponse(),
    description: typeof source.description == 'string' ? source.description : invalidResponse(),
    ...(homepageUrl == null ? {} : { homepageUrl }),
    ...(icon == null ? {} : { icon }),
    inputs: ports(source.inputs, inputPort),
    name: string(source.name),
    outputs: ports(source.outputs, port),
    serviceId: string(source.serviceId),
    serviceName: string(source.serviceName),
  }
  return result
}

export function connectorAction(value: unknown): ConnectorAction {
  const { defaultConnection, ...metadata } = record(value)
  const action = connectorActionMetadata(metadata)
  if (defaultConnection == null) return action
  const preferred = connection(defaultConnection)
  if (preferred.serviceId != action.serviceId || preferred.status != 'active') return invalidResponse()
  return { ...action, defaultConnection: preferred }
}

export function connectorProvider(value: unknown): ConnectorProvider {
  const source = record(value)
  const homepageUrl = source.homepageUrl
  const icon = source.icon
  if (source.noSetup !== undefined && typeof source.noSetup != 'boolean') return invalidResponse()
  exact(source, [
    ...(Object.hasOwn(source, 'noSetup') ? ['noSetup'] : []),
    'serviceId',
    'serviceName',
    ...(homepageUrl == null ? [] : ['homepageUrl']),
    ...(icon == null ? [] : ['icon']),
  ])
  if ((homepageUrl != null && typeof homepageUrl != 'string') || (icon != null && typeof icon != 'string')) return invalidResponse()
  return {
    ...(homepageUrl == null ? {} : { homepageUrl }),
    ...(icon == null ? {} : { icon }),
    serviceId: string(source.serviceId),
    serviceName: string(source.serviceName),
    ...(source.noSetup === undefined ? {} : { noSetup: source.noSetup }),
  }
}
