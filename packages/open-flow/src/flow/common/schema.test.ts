import { expect, it } from 'vitest'
import { triggerOutputDefinitions } from '../../trigger/common/contract.ts'

it('describes the scheduled time emitted by cron runs', () => {
  expect(triggerOutputDefinitions({ kind: 'cron', name: 'Schedule', cronTimes: [] })[0]!.jsonSchema).toEqual({
    format: 'date-time',
    type: 'string',
  })
})
