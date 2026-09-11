import type { Draft, DraftChange, DraftSync, Presentation, RevisionMetadata } from './api.ts'

import { decodeRevisionContent } from '../../flow/common/encoding.ts'
import { exact, integer, invalidResponse, jsonValue, record, string } from './decoding.ts'

function revisionMetadata(value: unknown): RevisionMetadata {
  const source = record(value)
  const parentRevisionId = source.parentRevisionId
  if (source.version != 1 || (parentRevisionId !== null && typeof parentRevisionId != 'string')) return invalidResponse()
  return {
    actorId: string(source.actorId),
    createdAt: string(source.createdAt),
    digest: string(source.digest),
    flowId: string(source.flowId),
    modelVersion: integer(source.modelVersion),
    parentRevisionId,
    revisionId: string(source.revisionId),
    version: 1,
  }
}

export function draft(value: unknown): Draft {
  const source = record(value)
  try {
    return { ...revisionMetadata(source), content: decodeRevisionContent(source.content) }
  } catch {
    return invalidResponse()
  }
}

export function presentation(value: unknown): Presentation {
  const source = record(value)
  exact(source, ['revision', 'updatedAt', 'value', 'version'])
  if (source.version != 1 || integer(source.revision) < 1) return invalidResponse()
  return {
    revision: integer(source.revision),
    updatedAt: string(source.updatedAt),
    value: Object.fromEntries(Object.entries(record(source.value)).map(([key, item]) => [key, jsonValue(item)])),
    version: 1,
  }
}

export function draftChange(value: unknown): DraftChange {
  const source = record(value)
  if (source.version != 1) return invalidResponse()
  return { revision: revisionMetadata(source.revision), version: 1 }
}

export function draftSync(value: unknown): DraftSync {
  const source = record(value)
  if (source.version != 1 || source.kind != 'snapshot') return invalidResponse()
  return { draft: draft(source.draft), kind: 'snapshot', version: 1 }
}
