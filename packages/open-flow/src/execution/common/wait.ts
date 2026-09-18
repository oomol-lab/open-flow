import { z } from 'zod'

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
