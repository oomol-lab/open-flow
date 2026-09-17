import type { Schema, SchemaDraft } from '@cfworker/json-schema'
import type { JsonValue, PortDefinition, SchemaKeyword, SchemaMismatch } from './change.ts'

import { Validator } from '@cfworker/json-schema'
import { compareJSONSchema, normalizeNullableSchemaPath } from '../../manifest/common/schemaCompare.ts'
import { isSchemaKeyword } from './change.ts'

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

interface IncompatibleCompareResult {
  readonly kind: 'incompatible'
  readonly error?: string
  readonly errorPath?: readonly (string | number)[]
}

type SchemaCompareResult = { readonly kind: 'compatible' } | { readonly kind: 'compare-error'; readonly message: string } | IncompatibleCompareResult

export type PortCompareResult =
  | { readonly kind: 'compatible' }
  | { readonly kind: 'compare-error'; readonly message: string }
  | { readonly kind: 'incompatible'; readonly mismatch: SchemaMismatch }

function compareSchemas(sourceSchema: JsonValue, targetSchema: JsonValue, sourceNullable = false, targetNullable = false): SchemaCompareResult {
  if (targetSchema === true) return { kind: 'compatible' }
  if (sourceSchema === false || targetSchema === false) return { kind: 'incompatible' }
  const source = sourceSchema === true ? {} : schemaObject(sourceSchema)
  const target = schemaObject(targetSchema)
  if (source == null || target == null) return { kind: 'compare-error', message: 'Port schema must be an object or boolean.' }
  const result = compareJSONSchema(
    { nullable: sourceNullable, packageId: undefined, schema: source },
    { nullable: targetNullable, packageId: undefined, schema: target },
  )
  return result.kind == 'incompatible' ? { ...result, errorPath: normalizeNullableSchemaPath(result.errorPath, targetNullable) } : result
}

function schemaValue(schema: JsonValue, path: readonly (string | number)[]): JsonValue | undefined {
  let value: JsonValue | undefined = schema
  for (const part of path) {
    if (value == null || typeof value != 'object') return
    value = Array.isArray(value) ? value[Number(part)] : schemaObject(value)?.[String(part)]
  }
  return value
}

function schemaMismatch(source: PortDefinition, target: PortDefinition, result: IncompatibleCompareResult): SchemaMismatch {
  if (source.nullable && !target.nullable) return { kind: 'nullable' }
  if (result.error == 'edgeError.binDiffType') return { kind: 'binary' }
  if (result.error == 'edgeError.artifactDiffType') return { kind: 'artifact' }
  const sourceSchema = schemaObject(source.jsonSchema)
  const targetSchema = schemaObject(target.jsonSchema)
  const fallbackKeyword = result.errorPath == null && sourceSchema != null && targetSchema != null ? rootMismatchKeyword(sourceSchema, targetSchema) : undefined
  const path = fallbackKeyword == null ? result.errorPath : [fallbackKeyword]
  const keyword = path?.at(-1)
  if (typeof keyword != 'string' || !isSchemaKeyword(keyword)) return { kind: 'schema', path }
  const ownerPath = path!.slice(0, -1)
  return {
    kind: 'keyword',
    keyword,
    path: ownerPath,
    source: schemaValue(source.jsonSchema, [...ownerPath, keyword]),
    target: schemaValue(target.jsonSchema, [...ownerPath, keyword]),
  }
}

function rootMismatchKeyword(source: Readonly<Record<string, JsonValue>>, target: Readonly<Record<string, JsonValue>>): SchemaKeyword | undefined {
  if (!jsonEqual(source.type, target.type)) return 'type'
  if (target.const !== undefined && !jsonEqual(source.const, target.const)) return 'const'
  if (target.enum !== undefined && !jsonEqual(source.enum, target.enum)) return 'enum'
  const sourceRequired = new Set(Array.isArray(source.required) ? source.required : [])
  if (Array.isArray(target.required) && target.required.some((name) => typeof name == 'string' && !sourceRequired.has(name))) return 'required'
  for (const keyword of schemaConstraintKeywords) if (target[keyword] !== undefined && !jsonEqual(source[keyword], target[keyword])) return keyword
}

const schemaConstraintKeywords: readonly SchemaKeyword[] = [
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'exclusiveMinimum',
  'maximum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
]

export function comparePorts(source: PortDefinition, target: PortDefinition): PortCompareResult {
  const result = compareSchemas(source.jsonSchema, target.jsonSchema, source.nullable, target.nullable)
  return result.kind == 'incompatible' ? { kind: 'incompatible', mismatch: schemaMismatch(source, target, result) } : result
}

export function portsAssignable(source: PortDefinition, target: PortDefinition): boolean {
  return comparePorts(source, target).kind == 'compatible'
}

export function variableInputCompatible(jsonSchema: JsonValue): boolean {
  const schema = schemaObject(jsonSchema)
  const types = schemaList(schema?.type)
  if (schema != null && types?.includes('string')) return compareSchemas({ type: 'string' }, { ...schema, type: 'string' }).kind == 'compatible'
  return compareSchemas({ type: 'string' }, jsonSchema).kind == 'compatible'
}

export function hasRetiredRef(value: unknown): boolean {
  if (value == null || typeof value != 'object') return false
  const source = value as Readonly<Record<string, unknown>>
  return source.contentMediaType == 'oomol/ref' || Object.values(source).some(hasRetiredRef)
}
