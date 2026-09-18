import type { JSONSchema7, JSONSchema7TypeName } from 'json-schema'
import type { Context } from './common.ts'
import type { InputSchema } from './compiler.ts'
import type { CompiledSchema } from './wrapper.ts'

import { pick } from '../utils.ts'
import { recordError, isJSONSchemaKey, recordWarn } from './common.ts'
import { CompiledKind, wrapCompiledSchema } from './wrapper.ts'

type NumericKeys = 'type' | 'multipleOf' | 'maximum' | 'exclusiveMaximum' | 'minimum' | 'exclusiveMinimum'
type StringKeys = 'type' | 'format' | 'maxLength' | 'minLength' | 'pattern'

const NUMERIC_KEYS = new Set<NumericKeys>(['type', 'multipleOf', 'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum'])
const STRING_KEYS = new Set<StringKeys>(['type', 'format', 'maxLength', 'minLength', 'pattern'])

export type PrimitiveInputSchema = InputSchema & {
  readonly type: Exclude<JSONSchema7TypeName, 'object' | 'array'>
}

export function compilePrimitiveSchema<E>(context: Context<E>, schema: PrimitiveInputSchema): CompiledSchema<E> | null {
  const { type } = schema
  switch (type) {
    case 'number':
    case 'integer': {
      return compileNumericSchema(context, schema)
    }
    case 'string': {
      return compileStringSchema(context, schema)
    }
    case 'boolean':
    case 'null': {
      const rejectKeys = Object.keys(schema).filter((k) => isJSONSchemaKey(k) && k !== 'type')
      if (rejectKeys.length > 0) {
        recordWarn(context, `key "type" will exclude other keys: ${rejectKeys.toSorted().join(', ')}`)
      }
      const kind = type === 'null' ? CompiledKind.Null : CompiledKind.Boolean
      const compiledSchema = { type }
      return wrapCompiledSchema(kind, compiledSchema, context.delegate, context.path)
    }
    default: {
      recordError(context, `invalid type ${JSON.stringify(type)}`)
      return null
    }
  }
}

function compileNumericSchema<E>(context: Context<E>, schema: PrimitiveInputSchema): CompiledSchema<E> | null {
  const rejectKeys = Object.keys(schema).filter((k) => !NUMERIC_KEYS.has(k as NumericKeys) && isJSONSchemaKey(k))
  if (rejectKeys.length > 0) {
    recordWarn(context, `type=${JSON.stringify(schema.type)} will exclude other keys: ${rejectKeys.toSorted().join(', ')}`)
  }
  const compiledSchema = pick(schema, NUMERIC_KEYS)

  for (const key of NUMERIC_KEYS) {
    const value = compiledSchema[key]
    if (key !== 'type' && value !== undefined && Number.isNaN(value)) {
      recordWarn(context, 'found NaN', key)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (compiledSchema as any)[key]
    }
  }
  const { maximum, exclusiveMaximum, minimum, exclusiveMinimum } = compiledSchema

  if (maximum !== undefined && exclusiveMaximum !== undefined) {
    if (maximum === exclusiveMaximum) {
      delete compiledSchema.maximum
    } else if (maximum < exclusiveMaximum) {
      delete compiledSchema.exclusiveMaximum
    } else if (maximum > exclusiveMaximum) {
      delete compiledSchema.maximum
    }
  }
  if (minimum !== undefined && exclusiveMinimum !== undefined) {
    if (minimum === exclusiveMinimum) {
      delete compiledSchema.minimum
    } else if (minimum < exclusiveMinimum) {
      delete compiledSchema.exclusiveMinimum
    } else if (minimum > exclusiveMinimum) {
      delete compiledSchema.minimum
    }
  }
  const { multipleOf } = compiledSchema

  if (multipleOf === 0) {
    delete compiledSchema.multipleOf
    compiledSchema.type = 'number'
    recordWarn(context, 'cannot be 0', 'multipleOf')
  }
  let kind: CompiledKind = CompiledKind.Numeric
  if (!isNumericPossibleInvalid(compiledSchema)) {
    kind = CompiledKind.Never
  }
  return wrapCompiledSchema(kind, compiledSchema, context.delegate, context.path)
}

function isNumericPossibleInvalid(compiledSchema: JSONSchema7): boolean {
  const { maximum, exclusiveMaximum, minimum, exclusiveMinimum } = compiledSchema

  if (maximum !== undefined && minimum !== undefined) {
    return maximum >= minimum
  } else if (exclusiveMaximum !== undefined && minimum !== undefined) {
    return exclusiveMaximum > minimum
  } else if (maximum !== undefined && exclusiveMinimum !== undefined) {
    return maximum > exclusiveMinimum
  } else if (exclusiveMaximum !== undefined && exclusiveMinimum !== undefined) {
    return exclusiveMaximum > exclusiveMinimum
  } else {
    return true
  }
}

function compileStringSchema<E>(context: Context<E>, schema: PrimitiveInputSchema): CompiledSchema<E> | null {
  const rejectKeys = Object.keys(schema).filter((k) => !STRING_KEYS.has(k as StringKeys) && isJSONSchemaKey(k))
  if (rejectKeys.length > 0) {
    recordWarn(context, `type="string" will exclude other keys: ${rejectKeys.toSorted().join(', ')}`)
  }
  const compiledSchema = pick(schema, STRING_KEYS)

  cleanInvalidLength(context, compiledSchema, 'maxLength')
  cleanInvalidLength(context, compiledSchema, 'minLength')

  const max = compiledSchema.maxLength
  const min = compiledSchema.minLength
  let kind: CompiledKind = CompiledKind.String

  if (max !== undefined) {
    if (max < 0) {
      kind = CompiledKind.Never
    } else if (max !== undefined && min !== undefined && max < min) {
      kind = CompiledKind.Never
    }
  }
  return wrapCompiledSchema(kind, compiledSchema, context.delegate, context.path)
}

function cleanInvalidLength<E>(context: Context<E>, compiledSchema: JSONSchema7, key: 'maxLength' | 'minLength'): void {
  const length = compiledSchema[key]
  if (length !== undefined) {
    if (Number.isNaN(length)) {
      recordWarn(context, 'found NaN', key)
      delete compiledSchema[key]
    }
  }
}
