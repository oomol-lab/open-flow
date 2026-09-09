import { describe, expect, it } from 'vitest'
import { decodeResultRead, readResult } from '../src/control/common/results.ts'

describe('stored result pages', () => {
  it('keeps small values complete and distinguishes omitted data', () => {
    expect(readResult({ complete: false })).toMatchObject({ complete: true, value: { complete: false } })
    const page = readResult({ large: 'x'.repeat(2 * 1024 * 1024), small: 1 })
    expect(page.complete).toBe(false)
    expect(page.entries).toEqual([
      { pointer: '/large', type: 'string', complete: false },
      { pointer: '/small', type: 'number', complete: true, value: 1 },
    ])
    expect(JSON.stringify(page).length).toBeLessThan(16384)
  })

  it('pages huge members without skipping them and resolves escaped keys', () => {
    const data = { 'a/b~': Array.from({ length: 30 }, () => 'x'.repeat(20000)) }
    const first = readResult(data, { pointer: '/a~1b~0', limit: 10 })
    expect(first.entries).toHaveLength(10)
    expect(first.nextOffset).toBe(10)
    expect(first.entries?.[0]).toMatchObject({ pointer: '/a~1b~0/0', complete: false })
    expect(readResult(data, { pointer: '/a~1b~0', offset: 20 }).nextOffset).toBeUndefined()
    expect(() => readResult(data, { pointer: '/a~1b~0/length' })).toThrow()
    expect(() => readResult(data, { pointer: '/a~2' })).toThrow()
    expect(() => readResult(data, { pointer: '/constructor' })).toThrow()
  })

  it('reassembles Unicode string pages without losing characters', () => {
    const text = '你😀\\"'.repeat(4000)
    let offset = 0
    let actual = ''
    do {
      const page = readResult(text, { offset })
      expect(new TextEncoder().encode(JSON.stringify(page)).length).toBeLessThan(16384)
      actual += page.value
      if (page.nextOffset == null) break
      expect(page.nextOffset).toBeGreaterThan(offset)
      offset = page.nextOffset
    } while (actual.length < text.length)
    expect(actual).toBe(text)
    expect(() => readResult(text, { offset: 999999 })).toThrow()
  })
})

it('honors explicit member paging even when the complete result is small', () => {
  const first = readResult([1, 2, 3], { limit: 1 })
  expect(first.complete).toBe(false)
  expect(first.value).toBeUndefined()
  expect(first.entries?.map((entry) => entry.value)).toEqual([1])
  expect(first.nextOffset).toBe(1)
  expect(readResult([1, 2, 3], { offset: 1 }).entries?.map((entry) => entry.value)).toEqual([2, 3])
})

it('returns a complete result above 2 KiB when it fits in one page', () => {
  const value = { messages: Array.from({ length: 30 }, (_, id) => ({ id, subject: '邮件'.repeat(30) })) }
  expect(readResult(value)).toMatchObject({ complete: true, value })
})

it('pages complete array members by byte budget without rereading individual items', () => {
  const value = Array.from({ length: 12 }, (_, id) => ({ id, body: '你😀'.repeat(600) }))
  let offset = 0
  const actual = []
  do {
    const page = readResult(value, { offset })
    expect(new TextEncoder().encode(JSON.stringify(page)).length).toBeLessThan(16384)
    expect(page.entries?.length).toBeGreaterThan(1)
    for (const entry of page.entries ?? []) {
      expect(entry.complete).toBe(true)
      actual.push(entry.value)
    }
    if (page.nextOffset == null) break
    expect(page.nextOffset).toBeGreaterThan(offset)
    offset = page.nextOffset
  } while (offset < value.length)
  expect(actual).toEqual(value)
})

it('omits only oversized members and still includes complete siblings', () => {
  const value = { large: 'x'.repeat(20000), message: { body: 'x'.repeat(5000) } }
  const page = readResult(value)
  expect(page.entries).toEqual([
    { pointer: '/large', type: 'string', complete: false },
    { pointer: '/message', type: 'object', length: 1, complete: true, value: value.message },
  ])
  expect(page.nextOffset).toBeUndefined()
})

it('decodes explicit result sources and rejects ambiguous code metadata', () => {
  const value = {
    version: 1,
    runId: 'run',
    result: {
      resultId: 'result',
      callId: 'call',
      toolId: 'run_code',
      source: { kind: 'code' },
      bytes: 1,
      digest: 'a'.repeat(64),
      createdAt: '2026-09-09T00:00:00.000Z',
    },
    page: readResult(1),
  }
  expect(decodeResultRead(value).result.source).toEqual({ kind: 'code' })
  expect(() => decodeResultRead({ ...value, result: { ...value.result, source: { kind: 'code', action: 'mail.send' } } })).toThrow()
  expect(() => decodeResultRead({ ...value, result: { ...value.result, source: { kind: 'connector' } } })).toThrow()
})

it('uses the requested budget for complete values and Unicode string pages', () => {
  const text = '你😀\\"'.repeat(12000)
  const value = { text }
  expect(readResult(value).entries?.[0]?.complete).toBe(false)
  expect(readResult(value, { maxBytes: 1024 * 1024 })).toMatchObject({ complete: true, value })
  for (const maxBytes of [256, 15000, 64 * 1024]) {
    let offset = 0
    let actual = ''
    do {
      const page = readResult(value, { pointer: '/text', offset, maxBytes })
      expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThanOrEqual(maxBytes)
      actual += page.value
      if (page.nextOffset == null) break
      expect(page.nextOffset).toBeGreaterThan(offset)
      offset = page.nextOffset
    } while (actual.length < text.length)
    expect(actual).toBe(text)
  }
  expect(String(readResult(text, { maxBytes: 64 * 1024 }).value).length).toBeGreaterThan(String(readResult(text).value).length)
})

it('bounds complete members and escaped pointer metadata including the continuation', () => {
  const key = '\\"你'.repeat(250)
  const value = { [key]: Array.from({ length: 100 }, (_, id) => ({ id, text: 'a'.repeat(1000) })) }
  const pointer = `/${key}`
  for (const maxBytes of [15000, 64 * 1024]) {
    let offset = 0
    const actual = []
    do {
      const page = readResult(value, { pointer, offset, maxBytes })
      expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThanOrEqual(maxBytes)
      for (const entry of page.entries ?? []) {
        expect(entry.complete).toBe(true)
        actual.push(entry.value)
      }
      if (page.nextOffset == null) break
      offset = page.nextOffset
    } while (offset < 100)
    expect(actual).toEqual(value[key])
  }
})

it('rejects invalid budgets and pages that cannot make progress', () => {
  for (const maxBytes of [0, -1, 1.5, NaN, Infinity, 1024 * 1024 + 1]) expect(() => readResult('text', { maxBytes })).toThrow()
  expect(() => readResult('long text', { maxBytes: 1 })).toThrow('byte budget')
  expect(() => readResult({ x: 'long text' }, { maxBytes: 1 })).toThrow('preview limit')
})
