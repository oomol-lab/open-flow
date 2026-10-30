import type { JsonValue, ManagedTaskDefinitionOf } from '../../flow/common/model.ts'

import { z } from 'zod'

export { stateConformanceCases, type StateConformanceHarness } from './conformance.ts'

export type StateScope = 'draft' | 'live'
export const stateQuerySchema = z.strictObject({ scope: z.enum(['draft', 'live']), values: z.boolean().optional() })
export const stateClearSchema = z.strictObject({
  scope: z.enum(['draft', 'live']),
  key: z
    .string()
    .min(1)
    .refine((key) => new TextEncoder().encode(key).length <= 256)
    .optional(),
})
export const dedupeClearSchema = z.strictObject({ scope: z.enum(['draft', 'live']), space: z.string().regex(/^(flow|node:.+)$/) })
export type DedupeIdentity = string | number
export const dedupeConfigSchema = z.strictObject({
  field: z.string().default(''),
  mode: z.enum(['new', 'increasing']).default('new'),
  space: z.enum(['node', 'flow']).default('node'),
})
export type DedupeConfig = z.infer<typeof dedupeConfigSchema>
export interface DedupeExecutor extends DedupeConfig {
  readonly kind: 'dedupe'
}
export const dedupeExecutorSchema = dedupeConfigSchema.extend({ kind: z.literal('dedupe') })

export function dedupeTask(config: DedupeConfig = dedupeConfigSchema.parse({}), name = 'Remove Duplicates'): ManagedTaskDefinitionOf<DedupeExecutor> {
  return {
    name,
    executor: { ...config, kind: 'dedupe' },
    inputs: [{ handle: 'items', jsonSchema: { type: 'array' }, nullable: false }],
    outputs: ['items', 'duplicates'].map((handle) => ({ handle, jsonSchema: { type: 'array' }, nullable: false })),
  }
}

export class StateError extends Error {
  readonly retryable = false
  readonly catchable: boolean
  readonly code: 'capability.invalid' | 'capability.denied' | 'dedupe.full' | 'limit-exceeded'

  constructor(code: StateError['code'], message: string) {
    super(message)
    this.name = 'StateError'
    this.code = code
    this.catchable = code === 'dedupe.full'
  }
}

export function stateKey(key: unknown): string {
  if (typeof key !== 'string' || key.length === 0 || new TextEncoder().encode(key).length > 256)
    throw new StateError('capability.invalid', 'State keys require 1 to 256 UTF-8 bytes.')
  return key
}

export function dedupeIdentities(value: unknown): DedupeIdentity[] {
  if (!Array.isArray(value) || !Array.from(value).every((id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))))
    throw new StateError('capability.invalid', 'Identities must be strings or finite numbers.')
  return value
}

export async function hashIdentities(ids: readonly DedupeIdentity[]): Promise<Uint8Array[]> {
  return Promise.all(
    ids.map(async (id) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${typeof id}:${String(id)}`))).slice(0, 16)),
  )
}

export function watermarkValue(id: DedupeIdentity): number {
  if (typeof id === 'number') {
    if (!Number.isFinite(id)) throw new StateError('capability.invalid', 'Watermarks must be finite.')
    return id
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(id)
  if (match == null) throw new StateError('capability.invalid', 'Watermarks require RFC 3339 timestamps with an explicit timezone.')
  const [, year, month, day, hour, minute, second, , zone] = match
  const y = Number(year)
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month) - 1] ?? 0
  const result = Date.parse(id)
  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > days ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    (zone !== 'Z' && (Number(zone!.slice(1, 3)) > 23 || Number(zone!.slice(4)) > 59)) ||
    !Number.isFinite(result)
  )
    throw new StateError('capability.invalid', 'Watermarks require valid calendar timestamps.')
  return result
}

export function increasingIdentities(ids: readonly DedupeIdentity[], watermark: DedupeIdentity | null) {
  const type = typeof (watermark ?? ids[0])
  if (ids.some((id) => typeof id !== type)) throw new StateError('capability.invalid', 'Watermark types must not be mixed.')
  const initial = watermark == null ? -Infinity : watermarkValue(watermark)
  const seen = new Set<number>()
  let maximum = initial
  let next = watermark
  const inserted = ids.map((id) => {
    const value = watermarkValue(id)
    const fresh = value > initial && !seen.has(value)
    seen.add(value)
    if (value > maximum) {
      maximum = value
      next = id
    }
    return fresh
  })
  return { inserted, watermark: next }
}

export function itemIdentities(items: JsonValue, field: string): DedupeIdentity[] {
  if (!Array.isArray(items)) throw new StateError('capability.invalid', 'Deduplication requires an array of items.')
  const path = field === '' ? [] : field.split('.')
  return dedupeIdentities(
    items.map((item) =>
      path.reduce<JsonValue | undefined>(
        (value, key) => (value != null && typeof value === 'object' && Object.hasOwn(value, key) ? (value as Record<string, JsonValue>)[key] : undefined),
        item,
      ),
    ),
  )
}

export interface FlowStateView {
  readonly version: 1
  readonly scope: StateScope
  readonly limits: {
    readonly maxValueBytes: number
    readonly maxValues: number
    readonly maxSpaces: number
    readonly maxIdentities: number
    readonly maxRunWrites: number
  }
  readonly values: readonly { readonly key: string; readonly size: number; readonly updatedAt: number; readonly value?: JsonValue }[]
  readonly spaces: readonly {
    readonly space: string
    readonly mode: 'new' | 'increasing'
    readonly count: number
    readonly watermark: DedupeIdentity | null
    readonly updatedAt: number
  }[]
}

export const flowStateViewSchema = z.object({
  version: z.literal(1),
  scope: z.enum(['draft', 'live']),
  limits: z.object({
    maxValueBytes: z.number().positive(),
    maxValues: z.number().int().positive(),
    maxSpaces: z.number().int().positive(),
    maxIdentities: z.number().positive(),
    maxRunWrites: z.number().positive(),
  }),
  values: z.array(z.object({ key: z.string(), size: z.number().nonnegative(), updatedAt: z.number(), value: z.json().optional() })),
  spaces: z.array(
    z.object({
      space: z.string(),
      mode: z.enum(['new', 'increasing']),
      count: z.number().nonnegative(),
      watermark: z.union([z.string(), z.number(), z.null()]),
      updatedAt: z.number(),
    }),
  ),
})
