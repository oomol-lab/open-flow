import { describe, expect, it, vi } from 'vitest'
import { inheritedDefaultReset } from './nodeInputs.tsx'

describe('Node input reset', () => {
  it('hides inherited-default reset for editable input definitions', () => {
    const reset = vi.fn()

    expect(inheritedDefaultReset(reset, true)).toBeUndefined()
  })

  it('keeps inherited-default reset for fixed input definitions', () => {
    const reset = vi.fn()

    expect(inheritedDefaultReset(reset, false)).toBe(reset)
  })
})
