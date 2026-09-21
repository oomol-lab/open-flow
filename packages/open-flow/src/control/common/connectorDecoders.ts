import type { InputPortDefinition } from '../../flow/common/change.ts'
import type {
  ConnectorAccess,
  ConnectorAccessCandidates,
  ConnectorAction,
  ConnectorActionMetadata,
  ConnectorConnection,
  ConnectorProvider,
  ProviderAccessBinding,
  ProviderAccessBindingCandidate,
} from './api.ts'

import { exact, integer, invalidResponse, jsonValue, record, string } from './decoding.ts'

function accessPermissions(value: unknown): NonNullable<ProviderAccessBindingCandidate['permissions']> {
  const source = record(value)
  exact(source, ['actionIds', 'allActions', 'configured', 'proxy'])
  if (!Array.isArray(source.actionIds) || typeof source.allActions != 'boolean' || typeof source.configured != 'boolean' || typeof source.proxy != 'boolean') {
    return invalidResponse()
  }
  const actionIds = source.actionIds.map(string)
  if (
    new Set(actionIds).size != actionIds.length ||
    source.allActions != (actionIds.length == 0) ||
    source.proxy != (source.allActions && !source.configured)
  ) {
    return invalidResponse()
  }
  return { actionIds, allActions: source.allActions, configured: source.configured, proxy: source.proxy }
}

function accessBinding(value: unknown, candidate: true): ProviderAccessBindingCandidate
function accessBinding(value: unknown, candidate: false): ProviderAccessBinding
function accessBinding(value: unknown, candidate: boolean): ProviderAccessBinding | ProviderAccessBindingCandidate {
  const source = record(value)
  const policyRevision = source.policyRevision
  const status = source.status
  const isDefault = source.isDefault
  const legacy = Object.hasOwn(source, 'displayName') && !Object.hasOwn(source, 'connectionDisplayName')
  const permissions = candidate && Object.hasOwn(source, 'permissions') ? accessPermissions(source.permissions) : undefined
  const permissionGroupName = source.permissionGroupName
  exact(source, [
    'accessBindingId',
    legacy ? 'displayName' : 'connectionDisplayName',
    ...(candidate && Object.hasOwn(source, 'isDefault') ? ['isDefault'] : []),
    ...(candidate && permissions != null ? ['permissions'] : []),
    ...(Object.hasOwn(source, 'permissionGroupName') ? ['permissionGroupName'] : []),
    ...(policyRevision == null ? [] : ['policyRevision']),
    'providerId',
    ...(candidate ? [] : ['status']),
  ])
  if (policyRevision != null && typeof policyRevision != 'string') return invalidResponse()
  if (candidate && isDefault !== undefined && typeof isDefault != 'boolean') return invalidResponse()
  if (permissionGroupName !== undefined && permissionGroupName !== null && typeof permissionGroupName != 'string') return invalidResponse()
  if (!candidate && status != 'active' && status != 'forbidden' && status != 'invalid' && status != 'missing') return invalidResponse()
  return {
    accessBindingId: string(source.accessBindingId),
    connectionDisplayName: string(legacy ? source.displayName : source.connectionDisplayName),
    ...(candidate && typeof isDefault == 'boolean' ? { isDefault } : {}),
    ...(permissions == null ? {} : { permissions }),
    ...(permissionGroupName === undefined ? {} : { permissionGroupName }),
    ...(policyRevision == null ? {} : { policyRevision }),
    providerId: string(source.providerId),
    ...(candidate ? {} : { status: status as ProviderAccessBinding['status'] }),
  }
}

function accessMode(value: unknown): ConnectorAccess['mode'] {
  if (value != 'implicit' && value != 'selectable') return invalidResponse()
  return value as ConnectorAccess['mode']
}

export function connectorAccess(value: unknown): ConnectorAccess {
  const source = record(value)
  exact(source, ['accessRevision', 'bindings', 'mode', 'providerAccessDigest', 'version'])
  const accessRevision = integer(source.accessRevision)
  if (source.version != 1 || accessRevision < 0 || !Array.isArray(source.bindings)) return invalidResponse()
  const bindings = source.bindings.map((binding) => accessBinding(binding, false))
  if (new Set(bindings.map((binding) => binding.accessBindingId)).size != bindings.length) return invalidResponse()
  return {
    accessRevision,
    bindings,
    mode: accessMode(source.mode),
    providerAccessDigest: string(source.providerAccessDigest),
    version: 1,
  }
}

export function connectorAccessCandidates(value: unknown, providerId: string): ConnectorAccessCandidates {
  const source = record(value)
  exact(source, ['candidates', 'mode', 'providerId', 'version'])
  if (source.version != 1 || string(source.providerId) != providerId || !Array.isArray(source.candidates)) return invalidResponse()
  const candidates = source.candidates.map((candidate) => accessBinding(candidate, true))
  if (candidates.some((candidate) => candidate.providerId != providerId)) return invalidResponse()
  if (new Set(candidates.map((candidate) => candidate.accessBindingId)).size != candidates.length) return invalidResponse()
  return { candidates, mode: accessMode(source.mode), providerId, version: 1 }
}

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
