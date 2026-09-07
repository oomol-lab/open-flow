import type { JsonValue, PortDefinition, TriggerNode } from './change.ts'

import { compareJSONSchema } from '../../manifest/common/schemaCompare.ts'
export function triggerPayloadSchema(trigger: TriggerNode): JsonValue {
  if (trigger.kind == 'poll' || trigger.kind == 'integration') return trigger.definition.payloadSchema
  if (trigger.kind == 'cron' || trigger.kind == 'manual') return { additionalProperties: false, type: 'object' }
  return {
    additionalProperties: false,
    properties: Object.fromEntries(trigger.inputsDef.map((input) => [input.handle, input.jsonSchema])),
    required: trigger.inputsDef.filter((input) => !input.nullable && !Object.hasOwn(input, 'value')).map((input) => input.handle),
    type: 'object',
  }
}

function jsonEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true
  if (left == null || right == null || typeof left != 'object' || typeof right != 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length == right.length && left.every((value, index) => jsonEqual(value, right[index]!))
  }
  const leftEntries = Object.entries(left)
  const rightRecord = right as Readonly<Record<string, JsonValue>>
  return (
    leftEntries.length == Object.keys(rightRecord).length &&
    leftEntries.every(([key, value]) => Object.hasOwn(rightRecord, key) && jsonEqual(value, rightRecord[key]!))
  )
}

export function schemaObject(schema: JsonValue): Readonly<Record<string, JsonValue>> | undefined {
  return schema != null && typeof schema == 'object' && !Array.isArray(schema) ? (schema as Readonly<Record<string, JsonValue>>) : undefined
}

export function schemaList(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined
}

function schemaTypeMatches(type: JsonValue | undefined, value: JsonValue): boolean {
  if (Array.isArray(type)) return type.some((candidate) => schemaTypeMatches(candidate, value))
  switch (type) {
    case undefined:
      return true
    case 'null':
      return value == null
    case 'boolean':
      return typeof value == 'boolean'
    case 'integer':
      return typeof value == 'number' && Number.isInteger(value)
    case 'number':
      return typeof value == 'number'
    case 'string':
      return typeof value == 'string'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return value != null && typeof value == 'object' && !Array.isArray(value)
    default:
      return false
  }
}

export function matchesSchema(value: JsonValue, schema: JsonValue): boolean {
  if (typeof schema == 'boolean') return schema
  const source = schemaObject(schema)
  if (source == null) return false
  const allOf = schemaList(source.allOf)
  if (allOf != null && !allOf.every((candidate) => matchesSchema(value, candidate))) return false
  const anyOf = schemaList(source.anyOf)
  if (anyOf != null && !anyOf.some((candidate) => matchesSchema(value, candidate))) return false
  const oneOf = schemaList(source.oneOf)
  if (oneOf != null && oneOf.filter((candidate) => matchesSchema(value, candidate)).length != 1) return false
  if (source.not != null && matchesSchema(value, source.not)) return false
  if (source.const != null && !jsonEqual(value, source.const)) return false
  const enumeration = schemaList(source.enum)
  if (enumeration != null && !enumeration.some((candidate) => jsonEqual(value, candidate))) return false
  if (!schemaTypeMatches(source.type, value)) return false
  if (typeof value == 'string') {
    if (typeof source.minLength == 'number' && value.length < source.minLength) return false
    if (typeof source.maxLength == 'number' && value.length > source.maxLength) return false
    if (typeof source.pattern == 'string') {
      try {
        if (!new RegExp(source.pattern, 'u').test(value)) return false
      } catch {
        return false
      }
    }
  }
  if (typeof value == 'number') {
    if (typeof source.minimum == 'number' && value < source.minimum) return false
    if (typeof source.maximum == 'number' && value > source.maximum) return false
    if (typeof source.exclusiveMinimum == 'number' && value <= source.exclusiveMinimum) return false
    if (typeof source.exclusiveMaximum == 'number' && value >= source.exclusiveMaximum) return false
  }
  if (Array.isArray(value)) {
    if (typeof source.minItems == 'number' && value.length < source.minItems) return false
    if (typeof source.maxItems == 'number' && value.length > source.maxItems) return false
    if (source.items != null && !value.every((item) => matchesSchema(item, source.items!))) return false
  }
  if (value != null && typeof value == 'object' && !Array.isArray(value)) {
    const objectValue = value as Readonly<Record<string, JsonValue>>
    const required = schemaList(source.required)
    if (required != null && required.some((key) => typeof key != 'string' || !Object.hasOwn(objectValue, key))) return false
    const properties = schemaObject(source.properties ?? {})
    if (properties == null) return false
    for (const [key, item] of Object.entries(objectValue)) {
      const property = properties[key]
      if (property != null) {
        if (!matchesSchema(item, property)) return false
      } else if (source.additionalProperties === false) return false
      else if (source.additionalProperties != null && source.additionalProperties !== true && !matchesSchema(item, source.additionalProperties)) return false
    }
  }
  return true
}

function schemaAssignable(sourceSchema: JsonValue, targetSchema: JsonValue, sourceNullable = false, targetNullable = false): boolean {
  if (targetSchema === true || jsonEqual(targetSchema, {})) return true
  if (sourceSchema === true || jsonEqual(sourceSchema, {})) return false
  if (sourceSchema === false || targetSchema === false) return false
  const source = schemaObject(sourceSchema)
  const target = schemaObject(targetSchema)
  if (source == null || target == null) return false
  return (
    compareJSONSchema({ nullable: sourceNullable, packageId: undefined, schema: source }, { nullable: targetNullable, packageId: undefined, schema: target })
      .kind == 'compatible'
  )
}

export function portsAssignable(source: PortDefinition, target: PortDefinition): boolean {
  return schemaAssignable(source.jsonSchema, target.jsonSchema, source.nullable, target.nullable)
}

export function variableInputCompatible(jsonSchema: JsonValue): boolean {
  const schema = schemaObject(jsonSchema)
  const types = schemaList(schema?.type)
  if (schema != null && types?.includes('string')) return schemaAssignable({ type: 'string' }, { ...schema, type: 'string' })
  return schemaAssignable({ type: 'string' }, jsonSchema)
}

export function hasRetiredRef(value: unknown): boolean {
  if (value == null || typeof value != 'object') return false
  const source = value as Readonly<Record<string, unknown>>
  return source.contentMediaType == 'oomol/ref' || Object.values(source).some(hasRetiredRef)
}
