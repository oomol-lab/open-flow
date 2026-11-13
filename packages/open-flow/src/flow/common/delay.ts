import type { InputPort } from './model.ts'

import { z } from 'zod'

export const defaultDelayDurationMs = 5000

/** Deployment policy separately limits the lifetime of a durable delay. */
export const delayDurationSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const delayDurationInput: InputPort = {
  handle: 'durationMs',
  jsonSchema: { ...z.toJSONSchema(delayDurationSchema, { target: 'draft-07' }), 'ui:widget': 'duration' } as unknown as InputPort['jsonSchema'],
  nullable: false,
  value: defaultDelayDurationMs,
}
