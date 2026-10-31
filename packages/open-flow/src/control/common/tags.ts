import type { FlowQuery, Tag, TagListItem } from './api.ts'

import { integer, invalidResponse, record, string } from './decoding.ts'

export function normalizeFlowQuery(query: FlowQuery = {}): Required<FlowQuery> {
  return { query: query.query?.trim().toLowerCase() ?? '', tagIds: [...new Set(query.tagIds ?? [])].toSorted(), untagged: query.untagged ?? false }
}

export function decodeTag(value: unknown): Tag {
  const source = record(value)
  if (source.version != 1) return invalidResponse()
  return { tagId: string(source.tagId), name: string(source.name), version: 1 }
}

export function decodeTagListItem(value: unknown): TagListItem {
  const source = record(value)
  const referenceCount = integer(source.referenceCount)
  if (referenceCount < 0) return invalidResponse()
  return { ...decodeTag(source), referenceCount }
}
