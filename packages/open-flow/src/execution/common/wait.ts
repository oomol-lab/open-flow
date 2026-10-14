import type { JsonValue } from '../../flow/common/change.ts'

import { z } from 'zod'
import { schemaObject } from '../../flow/common/schema.ts'

/** Shared by decision entry points, the editor, and durable decision storage. */
export const waitCommentSchema = z
  .string()
  .trim()
  .refine((value) => [...value].length <= 2000, 'Wait comment must contain at most 2,000 Unicode code points.')
  .nullable()
  .optional()

export function normalizeWaitComment(value?: string | null): string | null {
  return waitCommentSchema.parse(value) || null
}

export function withWaitNotificationMessage(value: JsonValue): JsonValue {
  const source = schemaObject(value)
  if (source == null || (source.pageUrl !== undefined && source.message !== undefined)) return value
  const pageUrl = source.pageUrl === undefined ? (source.continueUrl ?? source.approveUrl) : source.pageUrl
  if (typeof pageUrl != 'string' || typeof source.prompt != 'string' || typeof source.expiresAt != 'string') return value
  return {
    ...source,
    pageUrl,
    message: source.message === undefined ? [source.prompt, `Expires at: ${source.expiresAt}`, `Review request: ${pageUrl}`].join('\n\n') : source.message,
  }
}
