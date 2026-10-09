import type { ErrorListener, Flow, FlowPage, FlowResources, Variable } from './api.ts'

import { exact, integer, invalidResponse, record, string } from './decoding.ts'

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(string) : invalidResponse()
}

function resourceReferences(input: unknown): FlowResources {
  const source = record(input)
  const draft = source.draft === null ? null : record(source.draft)
  const shared = record(source.sharedAccess)
  if (draft != null && !Array.isArray(draft.connections)) return invalidResponse()
  if (!Array.isArray(shared.bindings)) return invalidResponse()
  const accessRevision = integer(shared.accessRevision)
  if (accessRevision < 0) return invalidResponse()
  return {
    draft:
      draft == null
        ? null
        : {
            variableNames: strings(draft.variableNames),
            errorSourceFlowIds: strings(draft.errorSourceFlowIds),
            connections: (draft.connections as unknown[]).map((value) => {
              const connection = record(value)
              return { providerId: string(connection.providerId), connectionId: string(connection.connectionId) }
            }),
          },
    sharedAccess: {
      accessRevision,
      providerIds: strings(shared.providerIds),
      bindings: shared.bindings.map((value) => {
        const binding = record(value)
        return {
          providerId: string(binding.providerId),
          connectionId: binding.connectionId === null ? null : string(binding.connectionId),
          accessBindingId: string(binding.accessBindingId),
        }
      }),
    },
  }
}

export function flow(value: unknown): Flow {
  const source = record(value)
  const status = source.status
  if (source.version != 1) return invalidResponse()
  if (status != 'active' && status != 'retiring') return invalidResponse()
  const target = source.live == null ? undefined : record(source.live)
  if (target != null && typeof target.enabled != 'boolean') return invalidResponse()
  return {
    ...(target == null
      ? {}
      : { live: { enabled: target.enabled as boolean, publicationId: string(target.publicationId), revisionId: string(target.revisionId) } }),
    createdAt: string(source.createdAt),
    ...(source.connectorTeamId == null ? {} : { connectorTeamId: string(source.connectorTeamId) }),
    draftRevisionId: string(source.draftRevisionId),
    resourceReferences: resourceReferences(source.resourceReferences),
    flowId: string(source.flowId),
    name: string(source.name),
    status: status as Flow['status'],
    updatedAt: string(source.updatedAt),
    version: 1,
  }
}

export function flowPage(value: unknown): FlowPage {
  const source = record(value)
  if (source.version != 1 || !Array.isArray(source.flows)) return invalidResponse()
  const nextCursor = source.nextCursor
  const total = source.total
  if (nextCursor != null && typeof nextCursor != 'string') return invalidResponse()
  if (total != null && !Number.isSafeInteger(total)) return invalidResponse()
  return {
    ...(nextCursor == null ? {} : { nextCursor }),
    flows: source.flows.map(flow),
    ...(total == null ? {} : { total: total as number }),
    version: 1,
  }
}

export function variable(value: unknown): Variable {
  const source = record(value)
  exact(source, ['name', 'updatedAt', 'value', 'version'])
  if (source.version != 1 || typeof source.value != 'string') return invalidResponse()
  const updatedAt = string(source.updatedAt)
  try {
    if (new Date(updatedAt).toISOString() != updatedAt) return invalidResponse()
  } catch {
    return invalidResponse()
  }
  return { name: string(source.name), updatedAt, value: source.value, version: 1 }
}

export function errorListener(value: unknown): ErrorListener {
  const source = record(value)
  if (typeof source.enabled != 'boolean') return invalidResponse()
  return {
    flowId: string(source.flowId),
    flowName: string(source.flowName),
    nodeId: string(source.nodeId),
    nodeName: string(source.nodeName),
    enabled: source.enabled,
  }
}
