import { z } from 'zod'

export const triggerScheduleSchema = z.array(
  z.union([
    z.object({ type: z.literal('cron'), expression: z.string(), timezone: z.string() }),
    z.object({ type: z.literal('every'), unit: z.enum(['day', 'hour', 'minute', 'month', 'week']), value: z.number() }),
  ]),
)
