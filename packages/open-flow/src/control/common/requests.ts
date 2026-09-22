import type { JsonValue } from '../../flow/common/change.ts'
import type { DraftOperation } from './draftOperations.ts'

import { waitCommentSchema } from '../../execution/common/wait.ts'
import { decodeDraftOperations, draftOperationsSchema } from './draftOperations.ts'
export { decodeDraftOperations, draftOperationsSchema, resolveDraftOperations, type DraftOperation } from './draftOperations.ts'
import { z } from 'zod'
import { resourceNameIssue } from '../../flow/common/change.ts'
import { createEventSourceSchema, updateEventSourceSchema, eventSourceRevisionSchema } from './eventSourceSchemas.ts'

export const waitActionBodySchema: { parse(value: unknown): { comment?: string | null } } = z.strictObject({ comment: waitCommentSchema })

const json: z.ZodType<JsonValue> = z.json()
const id = z.string().min(1)
const version = z.literal(1)
const flowName = id.refine((value) => value == value.trim() && resourceNameIssue(value) == null, 'Flow name is invalid.')
const inputs = z.record(z.string(), z.record(z.string(), json))
const trigger = z.strictObject({ nodeId: id, outputs: z.record(z.string(), json) })
const schemas = {
  createEventSource: createEventSourceSchema,
  updateEventSource: updateEventSourceSchema,
  eventSourceRevision: eventSourceRevisionSchema,
  createFlow: z.strictObject({ name: flowName, version }),
  renameFlow: z.strictObject({ name: flowName, version }),
  changeDraft: z.strictObject({ expectedRevisionId: id, operations: z.array(json).min(1), version }),
  repairDraft: z.strictObject({ expectedRevisionId: id, version }),
  setEnabled: z.strictObject({ enabled: z.boolean(), expectedPublicationId: id, version }),
  updatePresentation: z.strictObject({ expectedRevision: z.int().positive(), value: z.record(z.string(), json), version }),
  checkFlow: z.strictObject({ engineContract: id, version }),
  publishFlow: z.strictObject({ engineContract: id, expectedLivePublicationId: id.nullable(), version }),
  rollbackFlow: z.strictObject({ expectedLivePublicationId: id, version }),
  createDraftRun: z.strictObject({ engineContract: id, inputs, trigger, version: z.literal(2) }),
  createLiveRun: z.strictObject({ publicationId: id, inputs, trigger, version: z.literal(2) }),
  resolveWait: z.strictObject({ action: z.enum(['approve', 'continue', 'reject']), comment: waitCommentSchema, version }),
  putVariable: z.strictObject({
    value: z.string().refine((value) => new TextEncoder().encode(value).byteLength <= 65_536, 'Environment variable value is too large.'),
  }),
  queryConnectorAccessCandidates: z.strictObject({
    providerIds: z
      .array(id.max(256))
      .min(1)
      .refine((ids) => new Set(ids).size == ids.length, 'Duplicate provider IDs.'),
    version,
  }),
  setConnectorService: z.strictObject({ expectedAccessRevision: z.int().nonnegative(), version }),
  addProviderAccessBinding: z.strictObject({ accessBindingId: id, expectedAccessRevision: z.int().nonnegative(), version }),
  removeProviderAccessBinding: z.strictObject({ accessBindingId: id, expectedAccessRevision: z.int().nonnegative(), version }),
  versionOnly: z.strictObject({ version }),
}

function decoder<Value>(schema: z.ZodType<Value>): (value: unknown) => Value {
  return (value) => schema.parse(value)
}

export const controlRequests = {
  createEventSource: decoder(schemas.createEventSource),
  updateEventSource: decoder(schemas.updateEventSource),
  eventSourceRevision: decoder(schemas.eventSourceRevision),
  createFlow: decoder(schemas.createFlow),
  renameFlow: decoder(schemas.renameFlow),
  changeDraft(value: unknown): { expectedRevisionId: string; operations: readonly DraftOperation[]; version: 1 } {
    const body = schemas.changeDraft.parse(value)
    return { ...body, operations: decodeDraftOperations(body.operations) }
  },
  repairDraft: decoder(schemas.repairDraft),
  setEnabled: decoder(schemas.setEnabled),
  updatePresentation: decoder(schemas.updatePresentation),
  checkFlow: decoder(schemas.checkFlow),
  publishFlow: decoder(schemas.publishFlow),
  rollbackFlow: decoder(schemas.rollbackFlow),
  createDraftRun: decoder(schemas.createDraftRun),
  createLiveRun: decoder(schemas.createLiveRun),
  resolveWait: decoder(schemas.resolveWait),
  putVariable: decoder(schemas.putVariable),
  queryConnectorAccessCandidates: decoder(schemas.queryConnectorAccessCandidates),
  setConnectorService: decoder(schemas.setConnectorService),
  addProviderAccessBinding: decoder(schemas.addProviderAccessBinding),
  removeProviderAccessBinding: decoder(schemas.removeProviderAccessBinding),
  versionOnly: decoder(schemas.versionOnly),
}

export function controlRequestSchema(name: keyof typeof controlRequests): JsonValue {
  const schema = z.toJSONSchema(schemas[name])
  if (name == 'changeDraft') return { ...schema, properties: { ...schema.properties, operations: draftOperationsSchema() } } as unknown as JsonValue
  return schema as JsonValue
}

export { authoringExample, authoringExamples } from './authoringExamples.ts'
