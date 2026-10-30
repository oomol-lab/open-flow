import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { createBase64 } from '../src/runtime/common/runtime.ts'

describe('guest base64', () => {
  const { decode, encode } = createBase64()

  it('matches standard base64 for every padding length and byte value', () => {
    for (const size of [0, 1, 2, 3, 4, 5, 0x6000 - 1, 0x6000, 0x6000 + 1, 100_000]) {
      const bytes = Uint8Array.from({ length: size }, (_, index) => (index * 37 + size) % 256)
      const text = Buffer.from(bytes).toString('base64')
      expect(encode(bytes)).toBe(text)
      expect([...decode(text)]).toEqual([...bytes])
    }
  })

  it('rejects malformed base64', () => {
    for (const text of ['abc', 'ab$=', '=abc', 'a===', 'é123']) expect(() => decode(text)).toThrow(TypeError)
  })
})
