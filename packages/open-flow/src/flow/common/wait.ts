import type { WaitAutoContinue } from './change.ts'

import { z } from 'zod'
import { isTimeZone } from '../../localization/common/timeZone.ts'

/** Drafts retain incomplete values; semantic validation gates publication and execution. */
export const waitAutoContinueDraftSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('after'), durationMs: z.number().nullable() }),
  z.strictObject({
    kind: z.literal('at'),
    at: z.string(),
    timezone: z.string().optional(),
  }),
])

/** Static business configuration; the deployment owns the allowed wait lifetime. */
export const waitAutoContinueSchema = z.discriminatedUnion('kind', [
  waitAutoContinueDraftSchema.options[0].extend({ durationMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  waitAutoContinueDraftSchema.options[1].extend({
    at: z.iso.datetime({ offset: true }),
    timezone: z.string().refine(isTimeZone, 'Select a valid IANA timezone.').optional(),
  }),
])

/** Resolve one registration's intent; the deployment separately enforces its lifetime. */
export function waitAutoContinueAt(config: WaitAutoContinue, waitingSince: number): number {
  const timing = waitAutoContinueSchema.parse(config)
  const at = timing.kind == 'after' ? waitingSince + timing.durationMs : Date.parse(timing.at)
  return Math.max(waitingSince, at)
}
