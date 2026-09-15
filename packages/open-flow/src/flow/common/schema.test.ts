import { expect, it } from 'vitest'
import { triggerPayloadSchema } from './schema.ts'

it('describes the optional scheduled time emitted by cron runs', () => {
  expect(triggerPayloadSchema({ kind: 'cron', name: 'Schedule', cronTimes: [] })).toEqual({
    additionalProperties: false,
    properties: { scheduledAt: { format: 'date-time', type: 'string' } },
    type: 'object',
  })
})
