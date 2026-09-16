import { describe, expect, it } from 'vitest'
import { nextTriggerScheduledAt, scheduledTriggerOccurrenceId, validateCronExpression, validateTriggerSchedule } from '../src/trigger/common/cron.ts'

describe('Cron Trigger protocol', () => {
  it('preserves canonical interval grids', () => {
    expect(nextTriggerScheduledAt([{ type: 'every', unit: 'minute', value: 5 }], Date.UTC(2026, 7, 21, 1, 2))).toBe(Date.UTC(2026, 7, 21, 1, 5))
    expect(nextTriggerScheduledAt([{ type: 'every', unit: 'week', value: 1 }], Date.UTC(2026, 7, 21))).toBe(Date.UTC(2026, 7, 24))
    expect(nextTriggerScheduledAt([{ type: 'every', unit: 'month', value: 3 }], Date.UTC(2026, 7, 21))).toBe(Date.UTC(2026, 9, 1))
  })

  it('validates cron expressions, timezones, and interval bounds', () => {
    expect(() => validateTriggerSchedule([])).toThrow('At least one schedule rule')
    expect(() => validateTriggerSchedule([{ expression: '0 */5 * * * *', timezone: 'UTC', type: 'cron' }])).toThrow('exactly five fields')
    expect(() => validateTriggerSchedule([{ expression: '*/5 * * * *', timezone: 'Not/AZone', type: 'cron' }])).toThrow('Invalid IANA timezone')
    expect(() => validateTriggerSchedule([{ type: 'every', unit: 'month', value: 13 }])).toThrow('must not exceed one year')
  })

  it('validates individual five-field cron expressions for editors', () => {
    expect(() => validateCronExpression('0 9 * * *', 'UTC')).not.toThrow()
    expect(() => validateCronExpression('0 0 9 * * *', 'UTC')).toThrow('exactly five fields')
    expect(() => validateCronExpression('0 99 * * *', 'UTC')).toThrow('Invalid cron expression')
  })

  it('preserves the deployed scheduled occurrence identity', async () => {
    await expect(scheduledTriggerOccurrenceId('binding-a', 7, '2026-08-21T01:00:00.000Z')).resolves.toBe(
      'sha256:274f2e261e4e60fc00181bc250fc5fcbf50ab49da985101f35f90329bd2bf7f6',
    )
  })
})
