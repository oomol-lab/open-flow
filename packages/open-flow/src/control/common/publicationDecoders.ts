import type { Live, Publication, PublicationPage, PublishOperation } from './api.ts'

import { exact, integer, invalidResponse, record, string } from './decoding.ts'

export function publication(value: unknown): Publication {
  const source = record(value)
  const operation = source.operation
  const sourcePublicationId = source.sourcePublicationId
  if (source.version != 1) return invalidResponse()
  if (operation != 'publish' && operation != 'rollback') return invalidResponse()
  if (sourcePublicationId != null && typeof sourcePublicationId != 'string') return invalidResponse()
  return {
    actorId: string(source.actorId),
    closureDigest: string(source.closureDigest),
    createdAt: string(source.createdAt),
    engineContract: string(source.engineContract),
    flowId: string(source.flowId),
    modelVersion: integer(source.modelVersion),
    operation: operation as Publication['operation'],
    publicationId: string(source.publicationId),
    revisionDigest: string(source.revisionDigest),
    revisionId: string(source.revisionId),
    ...(sourcePublicationId == null ? {} : { sourcePublicationId }),
    version: 1,
  }
}

export function publishOperation(value: unknown): PublishOperation {
  const source = record(value)
  const status = source.status
  const common = {
    createdAt: string(source.createdAt),
    flowId: string(source.flowId),
    operationId: string(source.operationId),
    revisionId: string(source.revisionId),
    updatedAt: string(source.updatedAt),
    version: 1 as const,
  }
  if (source.version != 1) return invalidResponse()
  switch (status) {
    case 'pending':
      exact(source, ['createdAt', 'flowId', 'operationId', 'revisionId', 'status', 'updatedAt', 'version'])
      return { ...common, status }
    case 'succeeded':
      exact(source, ['createdAt', 'flowId', 'operationId', 'publicationId', 'revisionId', 'status', 'updatedAt', 'version'])
      return { ...common, publicationId: string(source.publicationId), status }
    case 'failed': {
      exact(source, ['createdAt', 'flowId', 'issue', 'operationId', 'revisionId', 'status', 'updatedAt', 'version'])
      const issue = record(source.issue)
      const nodeId = issue.nodeId
      exact(issue, ['code', 'message', ...(nodeId == null ? [] : ['nodeId'])])
      return {
        ...common,
        issue: { code: string(issue.code), message: string(issue.message), ...(nodeId == null ? {} : { nodeId: string(nodeId) }) },
        status,
      }
    }
    default:
      return invalidResponse()
  }
}

export function live(value: unknown): Live {
  const source = record(value)
  const status = source.status
  const candidate = source.publication
  if (source.version != 1 || typeof source.hasUnpublishedChanges != 'boolean') return invalidResponse()
  if (status != 'not-published' && status != 'runnable' && status != 'suspended') return invalidResponse()
  if (status == 'not-published' && candidate !== null) return invalidResponse()
  if (status != 'not-published' && candidate === null) return invalidResponse()
  return {
    flowId: string(source.flowId),
    hasUnpublishedChanges: source.hasUnpublishedChanges,
    publication: candidate === null ? null : publication(candidate),
    revision: integer(source.revision),
    status: status as Live['status'],
    version: 1,
  }
}

export function publicationPage(value: unknown): PublicationPage {
  const source = record(value)
  const nextCursor = source.nextCursor
  const total = source.total
  if (source.version != 1 || !Array.isArray(source.publications)) return invalidResponse()
  if (nextCursor != null && typeof nextCursor != 'string') return invalidResponse()
  if (total != null && !Number.isSafeInteger(total)) return invalidResponse()
  return {
    ...(nextCursor == null ? {} : { nextCursor }),
    publications: source.publications.map(publication),
    ...(total == null ? {} : { total: total as number }),
    version: 1,
  }
}
