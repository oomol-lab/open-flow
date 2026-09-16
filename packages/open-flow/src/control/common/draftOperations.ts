import type { ChangeOperation, JsonValue, TriggerKeySnapshot } from '../../flow/common/change.ts'

import { z } from 'zod'
import { changeOperationsSchema, decodeChangeOperations } from '../../flow/common/change.ts'
import { triggerScheduleSchema } from '../../flow/common/changeSchema.ts'
import { checkJsonDepth } from '../../flow/common/json.ts'
import { createProviderTrigger } from '../../flow/common/nodeChanges.ts'

const text = z.string().min(1)
const json: z.ZodType<JsonValue> = z.json()
const triggerCreate = z.strictObject({
  kind: z.literal('graph.trigger.create'),
  nodeId: text,
  bindingId: text,
  key: text,
  connectionId: text.optional(),
  name: text.optional(),
  config: z.record(text, json),
  schedule: triggerScheduleSchema.readonly().optional(),
})

export type DraftOperation = ChangeOperation | z.infer<typeof triggerCreate>

export function decodeDraftOperations(value: unknown): readonly DraftOperation[] {
  checkJsonDepth(value)
  return z
    .array(z.unknown())
    .min(1)
    .parse(value)
    .map((candidate) => {
      const { kind } = z.object({ kind: text }).parse(candidate)
      return kind == 'graph.trigger.create' ? triggerCreate.parse(candidate) : decodeChangeOperations([candidate])[0]!
    })
}

export function draftOperationsSchema(kind?: string): JsonValue {
  if (kind != null && kind != 'graph.trigger.create') return changeOperationsSchema(kind)
  const trigger = z.toJSONSchema(triggerCreate)
  if (kind == 'graph.trigger.create') return trigger as JsonValue
  const schema = changeOperationsSchema() as Record<string, JsonValue>
  return { ...schema, items: { anyOf: [schema.items!, trigger as JsonValue] } }
}

export function resolveDraftOperations(operations: readonly DraftOperation[], definition: (key: string) => TriggerKeySnapshot): readonly ChangeOperation[] {
  return operations.flatMap((operation) => {
    if (operation.kind != 'graph.trigger.create') return [operation]
    const snapshot = definition(operation.key)
    if (snapshot.type != 'poll' && operation.schedule != null) throw new Error('Only Poll triggers accept a schedule.')
    return createProviderTrigger({ kind: 'flow' }, operation, snapshot, operation)
  })
}
