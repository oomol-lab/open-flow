import type { JsonValue } from '../../flow/common/change.ts'

import { z } from 'zod'
import { resultQuerySchema } from './resultQuery.ts'

const json: z.ZodType<JsonValue> = z.json()
const entry = z.strictObject({
  pointer: z.string(),
  type: z.enum(['object', 'array', 'string', 'number', 'boolean', 'null']),
  length: z.number().int().nonnegative().optional(),
  complete: z.boolean(),
  value: json.optional(),
})
const page = entry.extend({
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().positive().optional(),
  entries: z.array(entry).optional(),
})
const result = z.strictObject({
  resultId: z.string().min(1),
  callId: z.string().min(1),
  toolId: z.string().min(1),
  source: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('connector'), action: z.string().min(1) }),
    z.strictObject({ kind: z.literal('code') }),
  ]),
  bytes: z.number().int().nonnegative(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
})

export type ResultCall =
  | { readonly id: string; readonly kind: 'connector'; readonly action: string; readonly connectionId?: string }
  | { readonly id: string; readonly kind: 'code' }

export interface ResultInfo {
  readonly resultId: string
  readonly callId: string
  readonly toolId: string
  readonly source: { readonly kind: 'connector'; readonly action: string } | { readonly kind: 'code' }
  readonly bytes: number
  readonly digest: string
  readonly createdAt: string
}
interface ResultEntry {
  readonly pointer: string
  readonly type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'
  readonly length?: number
  readonly complete: boolean
  readonly value?: JsonValue
}
export interface ResultPage extends ResultEntry {
  readonly offset: number
  readonly nextOffset?: number
  readonly entries?: readonly ResultEntry[]
}
export interface ResultQuery {
  readonly pointer?: string
  readonly offset?: number
  readonly limit?: number
  readonly maxBytes?: number
}
const listSchema = z.strictObject({ version: z.literal(1), runId: z.string(), results: z.array(result), nextAfter: z.string().optional() })
const readSchema = z.strictObject({ version: z.literal(1), runId: z.string(), result, page })
export function parseResultQuery(value: unknown): Required<ResultQuery> {
  return resultQuerySchema.parse(value)
}
export function decodeResultList(value: unknown): {
  readonly version: 1
  readonly runId: string
  readonly results: readonly ResultInfo[]
  readonly nextAfter?: string
} {
  return listSchema.parse(value)
}
export function decodeResultRead(value: unknown): { readonly version: 1; readonly runId: string; readonly result: ResultInfo; readonly page: ResultPage } {
  return readSchema.parse(value)
}

const encoder = new TextEncoder()
function bytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength
}

function describe(item: JsonValue, path: string): ResultEntry {
  const type = item === null ? 'null' : Array.isArray(item) ? 'array' : (typeof item as 'object' | 'string' | 'number' | 'boolean')
  return {
    pointer: path,
    type,
    ...(type == 'array' ? { length: (item as readonly JsonValue[]).length } : {}),
    ...(type == 'object' ? { length: Object.keys(item as object).length } : {}),
    complete: false,
  }
}

export function readResult(value: JsonValue, query: ResultQuery = {}): ResultPage {
  const { pointer, offset, limit, maxBytes } = parseResultQuery(query)
  let selected = value
  if (pointer != '') {
    if (!pointer.startsWith('/')) throw new Error('Result pointer must be a JSON Pointer.')
    for (const part of pointer.slice(1).split('/')) {
      if (/~(?:[^01]|$)/.test(part)) throw new Error('Result pointer has an invalid escape.')
      const key = part.replace(/~1/g, '/').replace(/~0/g, '~')
      if (selected == null || typeof selected != 'object' || !Object.hasOwn(selected, key)) throw new Error('Result path does not exist.')
      if (Array.isArray(selected)) {
        if (!/^(0|[1-9]\d*)$/.test(key)) throw new Error('Invalid result array index.')
        selected = selected[Number(key)]!
      } else selected = (selected as Readonly<Record<string, JsonValue>>)[key]!
    }
  }
  const description = describe(selected, pointer)
  const whole = { ...description, complete: true, offset, value: selected }
  if (offset == 0 && (query.limit == null || description.length == null || description.length <= limit) && bytes(whole) <= maxBytes) return whole
  const root = description
  if (typeof selected == 'string') {
    let length = 0
    for (const _ of selected) length++
    if (offset >= length) throw new Error('Result offset is out of range.')
    const budget = maxBytes - bytes({ ...root, length, offset, value: '', nextOffset: length })
    let used = 0
    let text = ''
    let end = offset
    let position = 0
    for (const char of selected) {
      if (position++ < offset) continue
      const size = bytes(char) - 2
      if (used + size > budget) break
      text += char
      used += size
      end++
    }
    if (end == offset) throw new Error('Result byte budget cannot fit a string character and page metadata.')
    return { ...root, complete: offset == 0 && end == length, length, offset, value: text, ...(end < length ? { nextOffset: end } : {}) }
  }
  if (selected == null || typeof selected != 'object') throw new Error('Result cannot be paged.')
  const keys = Object.keys(selected)
  if (offset >= keys.length) throw new Error('Result offset is out of range.')
  const entries: ResultEntry[] = []
  for (const key of keys.slice(offset, offset + limit)) {
    const path = `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
    const item = Array.isArray(selected) ? selected[Number(key)]! : (selected as Readonly<Record<string, JsonValue>>)[key]!
    const metadata = describe(item, path)
    const full = { ...metadata, complete: true, value: item }
    const next = bytes({ ...root, offset, entries: [full], nextOffset: keys.length }) <= maxBytes ? full : metadata
    if (bytes({ ...root, offset, entries: [...entries, next], nextOffset: keys.length }) > maxBytes) break
    entries.push(next)
  }
  if (entries.length == 0) throw new Error('Result property name exceeds the preview limit. Download the full result.')
  const end = offset + entries.length
  return { ...root, offset, entries, ...(end < keys.length ? { nextOffset: end } : {}) }
}
