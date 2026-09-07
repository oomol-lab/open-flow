import { afterEach, expect, it, vi } from 'vitest'
import { randomId } from './random.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

it('uses randomUUID when it is available', () => {
  vi.stubGlobal('crypto', { randomUUID: () => 'uuid-from-browser' })

  expect(randomId()).toBe('uuid-from-browser')
})

it('uses getRandomValues when randomUUID is unavailable', () => {
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(0)
      return bytes
    },
  })

  expect(randomId()).toBe('00000000-0000-4000-8000-000000000000')
})

it('falls back when Web Crypto is unavailable', () => {
  vi.stubGlobal('crypto', undefined)

  expect(randomId()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
})
