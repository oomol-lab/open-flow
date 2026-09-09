import type { Schema, SchemaDraft } from '@cfworker/json-schema'
import type { JsonValue, PortDefinition, TriggerNode } from './change.ts'

import { Validator } from '@cfworker/json-schema'
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

const validators = new WeakMap<object, Validator>()

export function matchesSchema(value: JsonValue, schema: JsonValue): boolean {
  if (typeof schema == 'boolean') return schema
  const source = schemaObject(schema)
  if (source == null || (source.properties != null && schemaObject(source.properties) == null)) return false
  try {
    let validator = validators.get(source)
    if (validator == null) {
      const declaration = typeof source.$schema == 'string' ? source.$schema : ''
      const draft: SchemaDraft = declaration.includes('draft-04')
        ? '4'
        : declaration.includes('draft-07')
          ? '7'
          : declaration.includes('2020-12')
            ? '2020-12'
            : '2019-09'
      // The validator attaches reference metadata, so it must not receive the Revision object.
      validator = new Validator(structuredClone(source) as Schema, draft)
      validators.set(source, validator)
    }
    return validator.validate(value).valid
  } catch {
    return false
  }
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
