import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'
import * as zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createNodejsPrimitives } from '../src/runtime/common/nodejsCompat.ts'

const create = () => createNodejsPrimitives({ Buffer, createHash, createHmac, zlib })

describe('Node.js compatibility primitives', () => {
  it('supports direct string inputs and encoded digests for Hash and HMAC', () => {
    const primitives = create()
    try {
      const hashId = JSON.parse(primitives.call(JSON.stringify({ operation: 'hash.create', algorithm: 'sha256', hmac: false, offset: 0, length: 0 })) as string)
        .value as number
      expect(JSON.parse(primitives.call(JSON.stringify({ operation: 'hash.update', id: hashId, text: 'hello ', encoding: 'utf8' })) as string)).toEqual({})
      expect(JSON.parse(primitives.call(JSON.stringify({ operation: 'hash.update', id: hashId, text: '776f726c64', encoding: 'hex' })) as string)).toEqual({})
      expect(JSON.parse(primitives.call(JSON.stringify({ operation: 'hash.digest', id: hashId, encoding: 'hex' })) as string).value).toBe(
        createHash('sha256').update('hello world').digest('hex'),
      )

      const hmacId = JSON.parse(primitives.call(JSON.stringify({ operation: 'hash.create', algorithm: 'sha256', hmac: true, text: 'secret-key' })) as string)
        .value as number
      primitives.call(JSON.stringify({ operation: 'hash.update', id: hmacId, text: 'payload', encoding: 'utf8' }))
      expect(JSON.parse(primitives.call(JSON.stringify({ operation: 'hash.digest', id: hmacId, encoding: 'base64' })) as string).value).toBe(
        createHmac('sha256', 'secret-key').update('payload').digest('base64'),
      )
    } finally {
      primitives.close()
    }
  })

  it('supports direct string input for zlib without a dictionary buffer', () => {
    const primitives = create()
    try {
      const compressed = primitives.call(JSON.stringify({ operation: 'zlib', method: 'gzipSync', text: 'hello open-flow', options: {} }))
      expect(compressed).toBeInstanceOf(ArrayBuffer)
      const decompressed = primitives.call(
        JSON.stringify({ operation: 'zlib', method: 'gunzipSync', offset: 0, length: (compressed as ArrayBuffer).byteLength, options: {} }),
        compressed as ArrayBuffer,
      )
      expect(Buffer.from(decompressed as ArrayBuffer).toString('utf8')).toBe('hello open-flow')
    } finally {
      primitives.close()
    }
  })

  it('rejects malformed primitive requests with TypeError envelopes', () => {
    const primitives = create()
    try {
      for (const payload of [
        null,
        [],
        { operation: 'unknown' },
        { operation: 'random', length: 65537 },
        { operation: 'random', length: -1 },
        { operation: 'hash.create', algorithm: 'sha256', hmac: true, text: 'a'.repeat(65537) },
        { operation: 'buffer.from', text: 'abc', encoding: 'not-an-encoding' },
        { operation: 'zlib', method: 'gzipSync', offset: 0, length: 0, options: { chunkSize: 1 } },
      ]) {
        const result = JSON.parse(primitives.call(JSON.stringify(payload)) as string) as { error?: { name: string } }
        expect(result.error?.name).toBe('TypeError')
      }
    } finally {
      primitives.close()
    }
  })
})
