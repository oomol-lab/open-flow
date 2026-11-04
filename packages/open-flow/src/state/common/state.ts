import type { JsonValue, ManagedTaskDefinitionOf } from '../../flow/common/model.ts'

import { z } from 'zod'

export { stateConformanceCases, type StateConformanceHarness } from './conformance.ts'

export type StateScope = 'draft' | 'live'
export const stateReadLimits = { maxKeys: 16, maxBytes: 1024 * 1024 }
const keySchema = z
  .string()
  .min(1)
  .refine((value) => new TextEncoder().encode(value).length <= 256)
export const stateQuerySchema = z.strictObject({ scope: z.enum(['draft', 'live']), values: z.literal(false).optional() })
export const stateSummaryQuerySchema = stateQuerySchema.omit({ values: true })
export const stateReadSchema = z.strictObject({
  scope: z.enum(['draft', 'live']),
  keys: z
    .array(keySchema)
    .min(1)
    .max(stateReadLimits.maxKeys)
    .refine((keys) => new Set(keys).size === keys.length, 'State keys must be distinct.'),
})
export type StateRead = z.infer<typeof stateReadSchema>
export const stateClearSchema = z.strictObject({
  scope: z.enum(['draft', 'live']),
  key: keySchema.optional(),
})
export const dedupeClearSchema = z.strictObject({ scope: z.enum(['draft', 'live']), space: z.string().regex(/^(flow|node:.+)$/) })
export const dedupeClearAllSchema = z.strictObject({ scope: z.enum(['draft', 'live']) })
export type DedupeIdentity = string | number
export const skipDuplicatesConfigSchema = z.strictObject({
  fields: z
    .array(z.string().refine((field) => field.length > 0 && field.split('.').every((part) => part.length > 0), 'Use a nonempty dot-separated field path.'))
    .refine((fields) => new Set(fields).size === fields.length, 'Identity fields must be distinct.')
    .default([]),
})
export type SkipDuplicatesConfig = z.infer<typeof skipDuplicatesConfigSchema>
export interface SkipDuplicatesExecutor extends SkipDuplicatesConfig {
  readonly kind: 'skip-duplicates'
}
export const skipDuplicatesExecutorSchema = skipDuplicatesConfigSchema.extend({ kind: z.literal('skip-duplicates') })

export function skipDuplicatesTask(
  config: SkipDuplicatesConfig = skipDuplicatesConfigSchema.parse({}),
  name = 'Skip Duplicates',
): ManagedTaskDefinitionOf<SkipDuplicatesExecutor> {
  return {
    name,
    executor: { ...config, kind: 'skip-duplicates' },
    inputs: [{ handle: 'items', jsonSchema: { type: 'array' }, nullable: false }],
    outputs: ['items', 'duplicates'].map((handle) => ({ handle, jsonSchema: { type: 'array' }, nullable: false })),
  }
}

export class StateError extends Error {
  readonly retryable = false
  readonly catchable: boolean
  readonly code: 'capability.invalid' | 'capability.denied' | 'dedupe.full' | 'limit-exceeded' | 'node.input-invalid'

  constructor(code: StateError['code'], message: string) {
    super(message)
    this.name = 'StateError'
    this.code = code
    this.catchable = code === 'dedupe.full' || code === 'node.input-invalid'
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

/** Canonical identities include the field definition and preserve scalar types. */
export function skipDuplicatesIdentities(items: JsonValue, fields: readonly string[]): string[] {
  if (!Array.isArray(items)) throw new StateError('node.input-invalid', 'Skip Duplicates requires an array of items.')
  const paths = fields.toSorted()
  return items.map((item, index) => {
    const values = (paths.length === 0 ? [''] : paths).map((field) => {
      const value =
        field === ''
          ? item
          : field
              .split('.')
              .reduce<JsonValue | undefined>(
                (current, key) =>
                  current != null && typeof current === 'object' && Object.hasOwn(current, key) ? (current as Record<string, JsonValue>)[key] : undefined,
                item,
              )
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value)))
        throw new StateError(
          'node.input-invalid',
          `Item ${index + 1}, ${field === '' ? 'the item itself' : `field ${JSON.stringify(field)}`} must be a string or finite number.`,
        )
      return value
    })
    return JSON.stringify([paths, values])
  })
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
  readonly values: readonly { readonly key: string; readonly size: number; readonly updatedAt: number }[]
  readonly spaces: readonly {
    readonly space: string
    readonly count: number
    readonly pendingCount: number
    readonly reservedCount: number
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
  values: z.array(z.strictObject({ key: z.string(), size: z.number().nonnegative(), updatedAt: z.number() })),
  spaces: z.array(
    z.object({
      space: z.string(),
      count: z.number().nonnegative(),
      pendingCount: z.number().nonnegative(),
      reservedCount: z.number().nonnegative(),
      updatedAt: z.number(),
    }),
  ),
})

export interface FlowStateSummary {
  readonly version: 1
  readonly scope: StateScope
  readonly limits: FlowStateView['limits']
  readonly values: { readonly count: number; readonly updatedAt: number | null }
  readonly spaces: FlowStateView['spaces']
}

export const flowStateSummarySchema = flowStateViewSchema.extend({
  values: z.strictObject({ count: z.number().int().nonnegative(), updatedAt: z.number().nullable() }),
})

export interface FlowStateValues {
  readonly version: 1
  readonly scope: StateScope
  readonly values: readonly { readonly key: string; readonly value: JsonValue }[]
}

export const flowStateValuesSchema = z
  .object({
    version: z.literal(1),
    scope: z.enum(['draft', 'live']),
    values: z
      .array(z.strictObject({ key: keySchema, value: z.json() }))
      .min(1)
      .max(stateReadLimits.maxKeys),
  })
  .refine((response) => {
    const encoder = new TextEncoder()
    return (
      response.values.reduce((bytes, item) => bytes + (item.value === null ? 0 : encoder.encode(JSON.stringify(item.value)).byteLength), 0) <=
      stateReadLimits.maxBytes
    )
  }, 'State values exceed the 1 MiB read limit.')
