import type { ChangeOperation, JsonValue } from '../../flow/common/change.ts'

import { z } from 'zod'
import { changeOperationsSchema, decodeChangeOperations, resourceNameIssue } from '../../flow/common/change.ts'

const json: z.ZodType<JsonValue> = z.json()
const id = z.string().min(1)
const version = z.literal(1)
const flowName = id.refine((value) => value == value.trim() && resourceNameIssue(value) == null, 'Flow name is invalid.')
const inputs = z.record(z.string(), z.record(z.string(), json))
const trigger = z.strictObject({ nodeId: id, payload: json })
const schemas = {
  createFlow: z.strictObject({ name: flowName, version }),
  renameFlow: z.strictObject({ name: flowName, version }),
  changeDraft: z.strictObject({ expectedRevisionId: id, operations: z.array(json).min(1), version }),
  setEnabled: z.strictObject({ enabled: z.boolean(), expectedPublicationId: id, version }),
  updatePresentation: z.strictObject({ expectedRevision: z.int().positive(), value: z.record(z.string(), json), version }),
  checkFlow: z.strictObject({ engineContract: id, version }),
  publishFlow: z.strictObject({ engineContract: id, expectedLivePublicationId: id.nullable(), version }),
  rollbackFlow: z.strictObject({ expectedLivePublicationId: id, version }),
  createDraftRun: z.strictObject({ engineContract: id, inputs, trigger, version }),
  createLiveRun: z.strictObject({ publicationId: id, inputs, trigger, version }),
  resolveWait: z.strictObject({ action: z.enum(['approve', 'continue', 'reject']), version }),
  putVariable: z.strictObject({ value: z.string().refine((value) => new TextEncoder().encode(value).byteLength <= 65_536, 'Variable value is too large.') }),
  versionOnly: z.strictObject({ version }),
}

function decoder<Value>(schema: z.ZodType<Value>): (value: unknown) => Value {
  return (value) => schema.parse(value)
}

export const controlRequests = {
  createFlow: decoder(schemas.createFlow),
  renameFlow: decoder(schemas.renameFlow),
  changeDraft(value: unknown): { expectedRevisionId: string; operations: readonly ChangeOperation[]; version: 1 } {
    const body = schemas.changeDraft.parse(value)
    return { ...body, operations: decodeChangeOperations(body.operations) }
  },
  setEnabled: decoder(schemas.setEnabled),
  updatePresentation: decoder(schemas.updatePresentation),
  checkFlow: decoder(schemas.checkFlow),
  publishFlow: decoder(schemas.publishFlow),
  rollbackFlow: decoder(schemas.rollbackFlow),
  createDraftRun: decoder(schemas.createDraftRun),
  createLiveRun: decoder(schemas.createLiveRun),
  resolveWait: decoder(schemas.resolveWait),
  putVariable: decoder(schemas.putVariable),
  versionOnly: decoder(schemas.versionOnly),
}

export function controlRequestSchema(name: keyof typeof controlRequests): JsonValue {
  const schema = z.toJSONSchema(schemas[name])
  if (name == 'changeDraft') return { ...schema, properties: { ...schema.properties, operations: changeOperationsSchema() } } as unknown as JsonValue
  return schema as JsonValue
}
