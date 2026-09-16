import type { Schema } from '@cfworker/json-schema'
import type { JsonObject, JsonValue } from '../../base/common/json.ts'
import type { Port } from '../../flow/common/change.ts'

import { Validator } from '@cfworker/json-schema'
import { dequal } from 'dequal/lite'
import { z } from 'zod'
import { isJsonObject, isJsonValue } from '../../base/common/json.ts'

const maxConfigBytes = 64 * 1024
const maxDefinitionProperties = 512
const maxDefinitionEnumValues = 256
const maxSchemaBytes = 64 * 1024
const maxSchemaDepth = 32

const encoder = new TextEncoder()
const jsonObjectSchema = z.custom<JsonObject>(isJsonObject, 'Expected a JSON-safe object.')
const jsonValueSchema = z.custom<JsonValue>(isJsonValue, 'Expected a JSON-safe value.')

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size == values.length
}

function uniqueJson(values: readonly JsonValue[]): boolean {
  return values.every((value, index) => values.slice(0, index).every((previous) => !dequal(previous, value)))
}

function stringify(value: unknown): string {
  if (value === null || typeof value == 'boolean' || typeof value == 'string') return JSON.stringify(value)
  if (typeof value == 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Trigger definitions cannot contain non-finite numbers.')
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (Array.isArray(value)) return `[${value.map(stringify).join(',')}]`
  if (value != null && typeof value == 'object') {
    return `{${Object.keys(value)
      .toSorted(compareText)
      .map((key) => `${JSON.stringify(key)}:${stringify(Reflect.get(value, key))}`)
      .join(',')}}`
  }
  throw new TypeError(`Trigger definitions cannot contain ${typeof value} values.`)
}

const schemaKeys = new Set([
  'additionalProperties',
  'const',
  'default',
  'description',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'items',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'pattern',
  'properties',
  'propertyNames',
  'required',
  'title',
  'type',
])
const schemaType = z.enum(['array', 'boolean', 'integer', 'null', 'number', 'object', 'string'])
const nonNegativeInteger = z.number().int().nonnegative()
const schemaNode = z.strictObject({
  additionalProperties: z.union([z.boolean(), jsonObjectSchema]).optional(),
  const: jsonValueSchema.optional(),
  default: jsonValueSchema.optional(),
  description: z.string().optional(),
  enum: z.array(jsonValueSchema).min(1).refine(uniqueJson, 'Expected unique enum values.').optional(),
  exclusiveMaximum: z.number().optional(),
  exclusiveMinimum: z.number().optional(),
  format: z.string().optional(),
  items: jsonObjectSchema.optional(),
  maxItems: nonNegativeInteger.optional(),
  maxLength: nonNegativeInteger.optional(),
  maxProperties: nonNegativeInteger.optional(),
  maximum: z.number().optional(),
  minItems: nonNegativeInteger.optional(),
  minLength: nonNegativeInteger.optional(),
  minProperties: nonNegativeInteger.optional(),
  minimum: z.number().optional(),
  multipleOf: z.number().positive().optional(),
  pattern: z.string().optional(),
  properties: z.record(z.string(), jsonObjectSchema).optional(),
  propertyNames: jsonObjectSchema.optional(),
  required: z.array(z.string()).refine(unique, 'Expected unique required properties.').optional(),
  title: z.string().optional(),
  type: z.union([schemaType, z.array(schemaType).min(1).refine(unique, 'Expected unique schema types.')]).optional(),
})

interface SchemaStats {
  readonly enumValues: number
  readonly properties: number
}

function validateSchemaNode(schema: JsonObject, path: string): void {
  const unsupported = Object.keys(schema).find((key) => !schemaKeys.has(key))
  if (unsupported != null) throw new TypeError(`${path} uses unsupported JSON Schema keyword "${unsupported}".`)
  const result = schemaNode.safeParse(schema)
  if (!result.success) {
    throw new TypeError(`${path} is not a valid JSON Schema: ${result.error.issues.map((issue) => issue.message).join('; ')}.`)
  }
}

function inspectSchema(schema: JsonObject, label: string, objectRoot = false): SchemaStats {
  if (encoder.encode(stringify(schema)).byteLength > maxSchemaBytes) {
    throw new TypeError(`${label} exceeds the ${maxSchemaBytes}-byte limit.`)
  }
  validateSchemaNode(schema, label)
  const rootType = Reflect.get(schema, 'type')
  if (objectRoot && rootType != null && rootType != 'object' && !(Array.isArray(rootType) && rootType.includes('object'))) {
    throw new TypeError(`${label} must allow an object at its root.`)
  }

  let enumValues = 0
  let properties = 0
  const pending: { readonly depth: number; readonly path: string; readonly schema: JsonObject }[] = [{ depth: 1, path: label, schema }]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.depth > maxSchemaDepth) throw new TypeError(`${label} exceeds the maximum schema depth of ${maxSchemaDepth}.`)
    if (current.depth > 1) validateSchemaNode(current.schema, current.path)

    const enumValuesAtNode = Reflect.get(current.schema, 'enum')
    if (Array.isArray(enumValuesAtNode)) enumValues += enumValuesAtNode.length

    const childDepth = current.depth + 1
    const schemaProperties = Reflect.get(current.schema, 'properties')
    if (isJsonObject(schemaProperties)) {
      const entries = Object.entries(schemaProperties)
      properties += entries.length
      for (const [key, child] of entries) {
        if (!isJsonObject(child)) throw new TypeError(`${current.path}.properties.${key} must be a JSON Schema object.`)
        pending.push({ depth: childDepth, path: `${current.path}.properties.${key}`, schema: child })
      }
    }

    const additionalProperties = Reflect.get(current.schema, 'additionalProperties')
    if (additionalProperties != null && typeof additionalProperties != 'boolean') {
      if (!isJsonObject(additionalProperties)) throw new TypeError(`${current.path}.additionalProperties must be a boolean or JSON Schema object.`)
      pending.push({ depth: childDepth, path: `${current.path}.additionalProperties`, schema: additionalProperties })
    }

    const items = Reflect.get(current.schema, 'items')
    if (items != null) {
      if (!isJsonObject(items)) throw new TypeError(`${current.path}.items must be a JSON Schema object.`)
      pending.push({ depth: childDepth, path: `${current.path}.items`, schema: items })
    }

    const propertyNames = Reflect.get(current.schema, 'propertyNames')
    if (propertyNames != null) {
      if (!isJsonObject(propertyNames)) throw new TypeError(`${current.path}.propertyNames must be a JSON Schema object.`)
      pending.push({ depth: childDepth, path: `${current.path}.propertyNames`, schema: propertyNames })
    }
  }
  return { enumValues, properties }
}

export function validateTriggerDefinitionSchemas(
  definition: { readonly configSchema: JsonObject; readonly outputs: readonly Port[] },
  label = 'Trigger definition',
): void {
  const configStats = inspectSchema(definition.configSchema, `${label} configSchema`, true)
  if (new Set(definition.outputs.map((port) => port.handle)).size !== definition.outputs.length) throw new TypeError(`${label} has duplicate output handles.`)
  if (definition.outputs.length > maxDefinitionProperties || encoder.encode(stringify(definition.outputs)).byteLength > maxSchemaBytes)
    throw new TypeError(`${label} output definitions exceed the size limit.`)
  const outputStats = definition.outputs.reduce(
    (total, port) => {
      if (!isJsonObject(port.jsonSchema)) throw new TypeError(`${label} output schema must be an object.`)
      const stats = inspectSchema(port.jsonSchema, `${label} outputs.${port.handle}`)
      return { properties: total.properties + stats.properties, enumValues: total.enumValues + stats.enumValues }
    },
    { properties: 0, enumValues: 0 },
  )
  if (configStats.properties + outputStats.properties > maxDefinitionProperties) {
    throw new TypeError(`${label} schemas exceed the ${maxDefinitionProperties}-property limit.`)
  }
  if (configStats.enumValues + outputStats.enumValues > maxDefinitionEnumValues) {
    throw new TypeError(`${label} schemas exceed the ${maxDefinitionEnumValues}-enum-value limit.`)
  }
}

export function validateTriggerDefinition(
  definition: {
    readonly config: JsonObject
    readonly configSchema: JsonObject
    readonly outputs: readonly Port[]
  },
  label = 'Trigger definition',
): void {
  validateTriggerDefinitionSchemas(definition, label)
  if (encoder.encode(stringify(definition.config)).byteLength > maxConfigBytes) {
    throw new TypeError(`${label} config exceeds the ${maxConfigBytes}-byte limit.`)
  }

  let result
  try {
    const validator = new Validator(structuredClone(definition.configSchema) as Schema, '7', false)
    result = validator.validate(definition.config)
  } catch (error) {
    throw new TypeError(`${label} configSchema cannot validate config: ${error instanceof Error ? error.message : String(error)}.`, {
      cause: error,
    })
  }
  if (!result.valid) {
    throw new TypeError(`${label} config does not match configSchema: ${result.errors.map((error) => `${error.instanceLocation} ${error.error}`).join('; ')}.`)
  }
}

export async function computeTriggerDefinitionDigest(declaration: {
  readonly configSchema: JsonObject
  readonly connector?: { readonly accountRequired: true; readonly serviceId: string }
  readonly outputs: readonly Port[]
  readonly provisioning: 'integration' | 'poll' | 'webhook'
  readonly revision: string
  readonly serviceId: string
  readonly type: string
}): Promise<string> {
  const source = stringify({
    configSchema: declaration.configSchema,
    ...(declaration.connector == null ? {} : { connector: declaration.connector }),
    outputs: declaration.outputs,
    provisioning: declaration.provisioning,
    protocolVersion: 2,
    revision: declaration.revision,
    serviceId: declaration.serviceId,
    type: declaration.type,
  })
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(source)))
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
