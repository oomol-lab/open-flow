import { describe, expect, it } from 'vitest'
import { readRunDrawerOpen, writeRunDrawerOpen, runDrawerPreferenceKey } from './runDrawerPreference.ts'

describe('run drawer preference', () => {
  it.each([null, '', 'invalid', 'null'])('treats %s as unset', (value) => {
    expect(readRunDrawerOpen({ getItem: () => value, setItem() {} })).toBeUndefined()
  })
  it.each([true, false])('round trips %s without a Flow-specific key', (open) => {
    const values = new Map<string, string>()
    const preferences = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }
    writeRunDrawerOpen(preferences, open)
    expect(values.get(runDrawerPreferenceKey)).toBe(String(open))
    expect(readRunDrawerOpen(preferences)).toBe(open)
  })
  it('tolerates unavailable storage', () => {
    const preferences = {
      getItem(): string {
        throw new Error('Unavailable')
      },
      setItem() {
        throw new Error('Unavailable')
      },
    }
    expect(readRunDrawerOpen(preferences)).toBeUndefined()
    expect(() => writeRunDrawerOpen(preferences, false)).not.toThrow()
  })
})
