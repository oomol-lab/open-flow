import { z } from 'zod'

export const defaultDelayDurationMs = 5000

/** Deployment policy separately limits the lifetime of a durable delay. */
export const delayDurationSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
