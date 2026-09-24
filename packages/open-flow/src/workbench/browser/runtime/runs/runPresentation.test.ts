import { describe, expect, it, vi } from 'vitest'
import { duration } from './runPresentation.ts'

const startedAt = '2026-09-24T00:00:00Z'

function timedRun(milliseconds: number): NonNullable<Parameters<typeof duration>[0]> {
  return { startedAt, finishedAt: new Date(Date.parse(startedAt) + milliseconds).toISOString() }
}

describe('run duration', () => {
  it.each([
    [0, '0ms'],
    [128, '128ms'],
    [999, '999ms'],
    [1000, '1s'],
    [2350, '2s 350ms'],
    [60_000, '1m'],
    [192_000, '3m 12s'],
    [3_600_000, '1h'],
    [3_723_456, '1h 2m'],
    [86_400_000, '1d'],
    [93_600_000, '1d 2h'],
    [-1, '0ms'],
  ])('formats %i milliseconds as %s', (milliseconds, expected) => {
    expect(duration(timedRun(milliseconds))).toBe(expected)
  })

  it('shows a placeholder before a run starts', () => {
    expect(duration(undefined)).toBe('—')
    expect(duration({})).toBe('—')
  })

  it('uses the current time for an unfinished run', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(startedAt) + 61_000)
    try {
      expect(duration({ startedAt })).toBe('1m 1s')
    } finally {
      now.mockRestore()
    }
  })
})
