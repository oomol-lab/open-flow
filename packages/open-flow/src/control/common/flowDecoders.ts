import type { Flow, FlowPage, Variable } from './api.ts'

import { exact, invalidResponse, record, string } from './decoding.ts'

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
    draftRevisionId: string(source.draftRevisionId),
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
