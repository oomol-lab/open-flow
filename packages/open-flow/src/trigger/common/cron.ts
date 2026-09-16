import type { JsonValue, TriggerSchedule } from '../../flow/common/change.ts'

import { Cron } from 'croner'

const minuteMs = 60_000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs
const weekAnchorMs = 4 * dayMs
const maximumIntervalMs = 366 * dayMs
const encoder = new TextEncoder()

const unitMs = {
  day: dayMs,
  hour: hourMs,
  minute: minuteMs,
  week: 7 * dayMs,
} as const

export function validateTriggerSchedule(rules: readonly TriggerSchedule[]): void {
  if (rules.length == 0) throw new TypeError('At least one schedule rule is required.')
  for (const rule of rules) {
    if (rule.type == 'every') {
      if (!Number.isSafeInteger(rule.value) || rule.value < 1) throw new TypeError('Every rule value must be a positive integer.')
      if ((rule.unit == 'month' && rule.value > 12) || (rule.unit != 'month' && rule.value * unitMs[rule.unit] > maximumIntervalMs)) {
        throw new TypeError('Every rule interval must not exceed one year.')
      }
      continue
    }
    try {
      Intl.DateTimeFormat('en-US', { timeZone: rule.timezone })
    } catch {
      throw new TypeError(`Invalid IANA timezone: ${rule.timezone}`)
    }
    validateCronExpression(rule.expression, rule.timezone)
  }
}

export function validateCronExpression(expression: string, timezone: string): void {
  if (expression.trim().split(/\s+/).length != 5) throw new TypeError('Cron expression must have exactly five fields.')
  let cron: Cron
  try {
    cron = new Cron(expression, { timezone })
  } catch (error) {
    throw new TypeError(`Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
  if (cron.nextRun() == null) throw new TypeError('Cron expression has no future occurrence.')
}

export function nextTriggerScheduledAt(rules: readonly TriggerSchedule[], afterMs: number): number {
  let earliest = Infinity
  for (const rule of rules) earliest = Math.min(earliest, nextForRule(rule, afterMs))
  if (!Number.isFinite(earliest)) throw new Error('Schedule has no future occurrence.')
  return earliest
}

export async function scheduledTriggerOccurrenceId(bindingId: string, runtimeVersion: number, scheduledAt: string): Promise<string> {
  const value = encoder.encode(`${bindingId}\0${runtimeVersion}\0${scheduledAt}`)
  const digest = await crypto.subtle.digest('SHA-256', value)
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export interface CronConformanceFixture {
  readonly publishedAt: string
  readonly rules: readonly TriggerSchedule[]
}

export interface CronConformanceHarness {
  dispose(): Promise<void>
  payloads(): Promise<readonly JsonValue[]>
  republish(at: string, rules: readonly TriggerSchedule[]): Promise<void>
  retire(at: string): Promise<void>
  tick(at: string): Promise<void>
}

export interface CronConformanceCase {
  readonly fixture: CronConformanceFixture
  readonly name: string
  verify(harness: CronConformanceHarness): Promise<void>
}

const hourly: readonly TriggerSchedule[] = [{ type: 'every', unit: 'hour', value: 1 }]
const minutely: readonly TriggerSchedule[] = [{ type: 'every', unit: 'minute', value: 1 }]

export const cronConformanceCases: readonly CronConformanceCase[] = [
  {
    fixture: { publishedAt: '2026-08-21T00:30:00.000Z', rules: hourly },
    name: 'admits an exact schedule grid once',
    async verify(harness) {
      await harness.tick('2026-08-21T01:00:00.000Z')
      await harness.tick('2026-08-21T01:00:00.000Z')
      equal(await harness.payloads(), [{ scheduledAt: '2026-08-21T01:00:00.000Z' }], 'Exact schedule payloads')
    },
  },
  {
    fixture: { publishedAt: '2026-08-21T00:00:30.000Z', rules: minutely },
    name: 'coalesces missed grids and preserves the earliest due time',
    async verify(harness) {
      await harness.tick('2026-08-21T00:03:30.000Z')
      equal(await harness.payloads(), [{ scheduledAt: '2026-08-21T00:01:00.000Z' }], 'Delayed schedule payloads')
      await harness.tick('2026-08-21T00:04:00.000Z')
      equal(await harness.payloads(), [{ scheduledAt: '2026-08-21T00:01:00.000Z' }, { scheduledAt: '2026-08-21T00:04:00.000Z' }], 'Advanced schedule payloads')
    },
  },
  {
    fixture: { publishedAt: '2026-08-21T00:00:30.000Z', rules: minutely },
    name: 'resets the schedule when its publication changes',
    async verify(harness) {
      await harness.republish('2026-08-21T00:00:45.000Z', hourly)
      await harness.tick('2026-08-21T00:01:00.000Z')
      equal(await harness.payloads(), [], 'Payloads from the previous publication')
      await harness.tick('2026-08-21T01:00:00.000Z')
      equal(await harness.payloads(), [{ scheduledAt: '2026-08-21T01:00:00.000Z' }], 'Republished schedule payloads')
    },
  },
  {
    fixture: { publishedAt: '2026-08-21T00:30:00.000Z', rules: hourly },
    name: 'stops admitting runs after retirement',
    async verify(harness) {
      await harness.retire('2026-08-21T00:45:00.000Z')
      await harness.tick('2026-08-21T01:00:00.000Z')
      equal(await harness.payloads(), [], 'Retired schedule payloads')
    },
  },
]

function nextForRule(rule: TriggerSchedule, afterMs: number): number {
  if (rule.type == 'cron') {
    const next = new Cron(rule.expression, { timezone: rule.timezone }).nextRun(new Date(afterMs))
    return next?.getTime() ?? Infinity
  }
  if (rule.unit == 'month') {
    const after = new Date(afterMs)
    const monthIndex = (after.getUTCFullYear() - 1970) * 12 + after.getUTCMonth()
    let gridMonth = Math.floor(monthIndex / rule.value) * rule.value
    let candidate = Date.UTC(1970, gridMonth, 1)
    while (candidate <= afterMs) {
      gridMonth += rule.value
      candidate = Date.UTC(1970, gridMonth, 1)
    }
    return candidate
  }
  const period = rule.value * unitMs[rule.unit]
  const anchor = rule.unit == 'week' ? weekAnchorMs : 0
  return anchor + (Math.floor((afterMs - anchor) / period) + 1) * period
}

function equal(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) != JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`)
  }
}
