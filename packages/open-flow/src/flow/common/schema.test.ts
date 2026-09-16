import { expect, it } from 'vitest'
import { triggerOutputDefinitions } from '../../trigger/common/contract.ts'

it('describes the optional scheduled time emitted by cron runs', () => {
  expect(triggerOutputDefinitions({ kind: 'cron', name: 'Schedule', cronTimes: [] })[0]!.jsonSchema).toEqual({
    additionalProperties: false,
    properties: { scheduledAt: { format: 'date-time', type: 'string' } },
    type: 'object',
  })
})
