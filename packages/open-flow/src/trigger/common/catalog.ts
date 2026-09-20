import type { JsonObject, TriggerDefinition, TriggerDescriptor, TriggerPollTime } from '../../schema/index.ts'

import { z } from 'zod'
import { isJsonObject } from '../../base/common/json.ts'
import { TriggerDefinitionSchema, TriggerPollTimeSchema } from '../../schema/index.ts'
import { isBuiltInTriggerType } from './builtins.ts'
import { configInputsSchema } from './config.ts'
import { computeTriggerDefinitionDigest, validateTriggerDefinitionSchemas } from './definition.ts'

export interface TriggerCatalogIdentity {
  readonly revision: string
  readonly type: string
}

export interface TriggerCatalogSource {
  readonly get: (key: string) => Promise<unknown>
  readonly list: () => Promise<unknown>
}

export interface TriggerCatalogCompatibleItem extends TriggerCatalogIdentity {
  readonly compatible: true
  readonly definitionDigest: string
  readonly description?: string
  readonly icon?: string
  readonly trigger: TriggerCatalogDescriptor
}

export interface TriggerCatalogIncompatibleItem extends TriggerCatalogIdentity {
  readonly compatible: false
  readonly icon?: string
  readonly name: string
  readonly reason: string
  readonly serviceName: string
}

export type TriggerCatalogItem = TriggerCatalogCompatibleItem | TriggerCatalogIncompatibleItem

export interface TriggerCatalogPage {
  readonly items: readonly TriggerCatalogItem[]
  readonly nextCursor: string | null
}

export interface TriggerCatalogDescriptor extends TriggerDescriptor {
  readonly definition: TriggerDefinition
}

export const TRIGGER_CATALOG_REVISION = '2'

const identitySchema = {
  revision: z.string().min(1),
  type: z.string().min(1),
}
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/)
const jsonObjectSchema = z.custom<JsonObject>(isJsonObject, 'Expected a JSON object.')
const pollTimeSchema: z.ZodType<TriggerPollTime> = TriggerPollTimeSchema
const sourceKeyFields = {
  description: z.string(),
  displayName: z.string().min(1),
  key: z.string().min(1),
  name: z.string().min(1),
  provider: z.string().min(1),
}
const sourceKeySchema = z.discriminatedUnion('type', [
  z.strictObject({ ...sourceKeyFields, type: z.literal('integration') }),
  z.strictObject({ ...sourceKeyFields, type: z.literal('poll') }),
])
const outputSchema = z.strictObject({ handle: z.string().min(1), jsonSchema: jsonObjectSchema, nullable: z.boolean(), description: z.string().optional() })
const sourceItemSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...sourceKeyFields,
    configInputs: configInputsSchema,
    outputs: z.array(outputSchema),
    type: z.literal('integration'),
  }),
  z.strictObject({
    ...sourceKeyFields,
    configInputs: configInputsSchema,
    outputs: z.array(outputSchema),
    type: z.literal('poll'),
  }),
])
const sourceListSchema = z.strictObject({ keys: z.array(sourceKeySchema) })
const compatibleItemSchema = z.strictObject({
  ...identitySchema,
  compatible: z.literal(true),
  definitionDigest: digestSchema,
  description: z.string().optional(),
  icon: z.string().optional(),
  trigger: z.strictObject({
    type: identitySchema.type,
    revision: identitySchema.revision,
    definition: TriggerDefinitionSchema,
    config: jsonObjectSchema,
    poll_times: z.tuple([pollTimeSchema]).optional(),
  }),
})
const incompatibleItemSchema = z.strictObject({
  ...identitySchema,
  compatible: z.literal(false),
  icon: z.string().optional(),
  name: z.string().min(1),
  reason: z.string().min(1).max(500),
  serviceName: z.string().min(1),
})
const itemSchema = z.discriminatedUnion('compatible', [compatibleItemSchema, incompatibleItemSchema])
const pageSchema = z.strictObject({
  items: z.array(itemSchema),
  nextCursor: z.string().min(1).nullable(),
})

function triggerDescriptor(item: z.infer<typeof sourceItemSchema>): TriggerCatalogDescriptor {
  return {
    type: item.key,
    revision: TRIGGER_CATALOG_REVISION,
    definition: {
      config_inputs: item.configInputs.map((port) => ('group' in port ? port : (({ jsonSchema, ...field }) => ({ ...field, json_schema: jsonSchema }))(port))),
      connector: { account_required: true, service_id: item.provider },
      name: item.displayName,
      outputs: item.outputs.map(({ jsonSchema, ...port }) => Object.assign({}, port, { json_schema: jsonSchema })),
      provisioning: { kind: item.type },
      service_id: item.provider,
      service_name: item.provider,
    },
    config: {},
    ...(item.type == 'poll' ? { poll_times: [{ type: 'every' as const, unit: 'minute' as const, value: 5 }] as const } : {}),
  }
}

function compatibilityReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length <= 500 ? message : `${message.slice(0, 497)}...`
}

async function validateDescriptor(trigger: TriggerCatalogDescriptor, definitionDigest: string): Promise<void> {
  const definition = {
    configInputs: trigger.definition.config_inputs.map((port) =>
      'group' in port ? port : (({ json_schema, ...input }) => ({ ...input, jsonSchema: json_schema ?? {}, nullable: input.nullable ?? false }))(port),
    ),
    outputs: trigger.definition.outputs.map(({ json_schema, ...port }) =>
      Object.assign({}, port, { nullable: port.nullable ?? false, jsonSchema: json_schema ?? {} }),
    ),
  }
  const label = `Trigger Catalog item "${trigger.type}" revision "${trigger.revision}"`
  validateTriggerDefinitionSchemas(definition, label)
  if (trigger.definition.provisioning.kind == 'poll' && trigger.definition.connector == null) {
    throw new TypeError('Poll Trigger definitions require a Connector service.')
  }
  if (trigger.definition.provisioning.kind == 'integration' && trigger.definition.connector == null) {
    throw new TypeError('Integration Trigger definitions require a Connector service.')
  }
  if (trigger.definition.provisioning.kind != 'poll' && trigger.poll_times != null) {
    throw new TypeError(`${trigger.definition.provisioning.kind == 'webhook' ? 'Webhook' : 'Integration'} Trigger definitions cannot provide poll times.`)
  }
  const digest = await computeTriggerDefinitionDigest({
    configInputs: trigger.definition.config_inputs.map((port) =>
      'group' in port ? port : (({ json_schema, ...input }) => ({ ...input, jsonSchema: json_schema ?? {}, nullable: input.nullable ?? false }))(port),
    ),
    connector:
      trigger.definition.connector == null
        ? undefined
        : {
            accountRequired: trigger.definition.connector.account_required,
            serviceId: trigger.definition.connector.service_id,
          },
    outputs: trigger.definition.outputs.map(({ json_schema, ...port }) =>
      Object.assign({}, port, { nullable: port.nullable ?? false, jsonSchema: json_schema ?? {} }),
    ),
    provisioning: trigger.definition.provisioning.kind,
    revision: trigger.revision,
    serviceId: trigger.definition.service_id,
    type: trigger.type,
  })
  if (digest != definitionDigest) {
    throw new TypeError(`Trigger definition digest mismatch: expected ${digest}, received ${definitionDigest}.`)
  }
}

export async function normalizeTriggerCatalogSourceItem(value: unknown): Promise<TriggerCatalogItem> {
  const item = sourceItemSchema.parse(value)
  if (isBuiltInTriggerType(item.key)) {
    return {
      compatible: false,
      name: item.displayName,
      reason: `Trigger type "${item.key}" uses the reserved Open Flow namespace.`,
      revision: TRIGGER_CATALOG_REVISION,
      serviceName: item.provider,
      type: item.key,
    }
  }
  const trigger = triggerDescriptor(item)
  const definitionDigest = await computeTriggerDefinitionDigest({
    configInputs: trigger.definition.config_inputs.map((port) =>
      'group' in port ? port : (({ json_schema, ...input }) => ({ ...input, jsonSchema: json_schema ?? {}, nullable: input.nullable ?? false }))(port),
    ),
    connector: { accountRequired: true, serviceId: item.provider },
    outputs: trigger.definition.outputs.map(({ json_schema, ...port }) =>
      Object.assign({}, port, { nullable: port.nullable ?? false, jsonSchema: json_schema ?? {} }),
    ),
    provisioning: item.type,
    revision: TRIGGER_CATALOG_REVISION,
    serviceId: item.provider,
    type: item.key,
  })
  try {
    await validateDescriptor(trigger, definitionDigest)
    return {
      compatible: true,
      definitionDigest,
      description: item.description,
      revision: TRIGGER_CATALOG_REVISION,
      trigger,
      type: item.key,
    }
  } catch (error) {
    return {
      compatible: false,
      name: item.displayName,
      reason: compatibilityReason(error),
      revision: TRIGGER_CATALOG_REVISION,
      serviceName: item.provider,
      type: item.key,
    }
  }
}

export async function getTriggerCatalogItem(source: TriggerCatalogSource, identity: TriggerCatalogIdentity): Promise<TriggerCatalogItem> {
  if (identity.revision != TRIGGER_CATALOG_REVISION) {
    throw new TypeError(`Trigger Catalog only supports revision "${TRIGGER_CATALOG_REVISION}".`)
  }
  const item = await normalizeTriggerCatalogSourceItem(await source.get(identity.type))
  if (item.type != identity.type) throw new TypeError(`Trigger Catalog returned "${item.type}" for requested key "${identity.type}".`)
  return item
}

export async function searchTriggerCatalog(
  source: TriggerCatalogSource,
  request: { readonly cursor?: string; readonly query: string },
): Promise<TriggerCatalogPage> {
  if (request.cursor != null) throw new TypeError('Trigger Gateway Catalog does not support cursors.')
  const summaries = sourceListSchema.parse(await source.list()).keys
  const keys = new Set<string>()
  for (const item of summaries) {
    if (keys.has(item.key)) throw new TypeError(`Trigger Catalog returned duplicate key "${item.key}".`)
    keys.add(item.key)
  }
  const query = request.query.trim().toLowerCase()
  const matches = summaries.filter((item) =>
    [item.key, item.provider, item.name, item.type, item.displayName, item.description].some((value) => value.toLowerCase().includes(query)),
  )
  return {
    items: await Promise.all(matches.map(async (item) => await getTriggerCatalogItem(source, { revision: TRIGGER_CATALOG_REVISION, type: item.key }))),
    nextCursor: null,
  }
}

export async function decodeTriggerCatalogPage(value: unknown): Promise<TriggerCatalogPage> {
  const page = pageSchema.parse(value)
  await Promise.all(page.items.map((item) => (item.compatible ? validateDescriptor(item.trigger, item.definitionDigest) : undefined)))
  return page
}

export async function decodeTriggerCatalogItem(value: unknown): Promise<TriggerCatalogItem> {
  const item = itemSchema.parse(value)
  if (item.compatible) await validateDescriptor(item.trigger, item.definitionDigest)
  return item
}

export async function decodeTriggerCatalogCompatibleItem(value: unknown): Promise<TriggerCatalogCompatibleItem> {
  const item = compatibleItemSchema.parse(value)
  await validateDescriptor(item.trigger, item.definitionDigest)
  return item
}

export function encodeTriggerCatalogIdentity(identity: TriggerCatalogIdentity): string {
  return JSON.stringify([identity.type, identity.revision])
}

export function decodeTriggerCatalogIdentity(value: string): TriggerCatalogIdentity {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new TypeError('Trigger Catalog identity must be valid JSON.')
  }
  const result = z.tuple([identitySchema.type, identitySchema.revision]).safeParse(parsed)
  if (!result.success) throw new TypeError('Trigger Catalog identity must contain a type and revision.')
  return { type: result.data[0], revision: result.data[1] }
}
