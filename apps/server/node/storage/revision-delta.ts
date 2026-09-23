import type { JsonValue } from '@oomol-lab/open-flow/flow-change'

import * as JsonPatch from 'effect/JsonPatch'
import { z } from 'zod'

const patchOperation = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: z.string(), value: z.json() }).strict(),
  z.object({ op: z.literal('remove'), path: z.string() }).strict(),
  z.object({ op: z.literal('replace'), path: z.string(), value: z.json() }).strict(),
])
const patchSchema = z.array(patchOperation)

export function createRevisionPatch(before: string, after: string): string {
  return JSON.stringify(JsonPatch.get(JSON.parse(before) as JsonValue, JSON.parse(after) as JsonValue))
}

export function applyRevisionPatch(content: string, stored: string): JsonValue {
  const patch = patchSchema.parse(JSON.parse(stored)) as JsonPatch.JsonPatch
  return JsonPatch.apply(patch, JSON.parse(content) as JsonValue)
}
