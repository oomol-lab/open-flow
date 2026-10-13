import type { JSONSchema7 } from 'json-schema'
import type { ExternalSchemaErrorItem, SchemaErrorItem } from '../error.ts'
import type { ExtendsContext } from '../extends/index.ts'
import type { JSONDelegate } from '../types.ts'
import type { Schema } from '../types.ts'
import type { DeepReadonly } from '../utils.ts'
import type { Context } from './common.ts'
import type { PrimitiveInputSchema } from './primitive.ts'
import type { CompiledSchema } from './wrapper.ts'

import { SchemaErrorItemKind } from '../error.ts'
import { compileArraySchema } from './array.ts'
import { COMBINATION_KEYS, compileCombinationSchema } from './combination.ts'
import { joinPath } from './common.ts'
import { isJSONSchemaKey, isLogicEmptyObject, unwrapJSONSchema7Definition, recordError, recordWarn } from './common.ts'
import { compileEnumAndConst } from './enumAndConst.ts'
import { compileObjectSchema } from './object.ts'
import { compilePrimitiveSchema } from './primitive.ts'
import { isCompiledSchema, wrapCompiledSchema, CompiledKind, getKind } from './wrapper.ts'

// Keep the input readonly so compilation cannot mutate the user's source schema.
export type InputSchema = DeepReadonly<JSONSchema7>
export type CompilableSchema<E = unknown> = InputSchema | Schema<E>

export type CompileResult<E> = {
  readonly schema: Schema<E>
  readonly warns: readonly SchemaErrorItem[]
}

const emptyList = Object.freeze([])

export function compile<E>(
  schema: CompilableSchema<E>,
  extendsContext: ExtendsContext,
  payload?: unknown,
  delegate?: JSONDelegate<E>,
): CompileResult<E> | readonly SchemaErrorItem<E>[] {
  if (isCompiledSchema<E>(schema)) {
    return { schema, warns: emptyList }
  }
  if (extendsContext.isExtendsSchema(schema)) {
    return { schema, warns: emptyList }
  }
  if (delegate) {
    const isSchemaResult = delegate.isSchema(schema)
    if (typeof isSchemaResult === 'object') {
      const items: ExternalSchemaErrorItem<E>[] = []
      for (const error of isSchemaResult) {
        items.push({ kind: SchemaErrorItemKind.External, error })
      }
      if (items.length > 0) {
        return items
      }
    } else if (isSchemaResult === false) {
      throw new Error('it is not a JSON Schema 7')
    }
  }
  const context: Context<E> = { delegate, payload, extends: extendsContext, path: [], errors: [], warns: [] }
  const compiledSchema = compileSchema(context, schema)

  if (compiledSchema) {
    assertCondition(context.errors.length === 0, 'found errors (it should be empty)')
  } else {
    assertCondition(context.errors.length > 0, 'cannot found any errors')
    return context.errors
  }
  return {
    schema: compiledSchema,
    warns: context.warns,
  }
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export function compileSchema<E>(context: Context<E>, schema: InputSchema): Schema<E> | null {
  if (context.extends.isExtendsSchema(schema)) {
    return schema
  }
  if (isCompiledSchema<E>(schema)) {
    return schema as CompiledSchema<E>
  }
  const extendsSchema = context.extends.tryCompiledExtendsSchema(schema, context.payload)

  if (extendsSchema) {
    return extendsSchema
  }
  let targetSchema: InputSchema = schema
  let shouldHandleEnumAndConst = false
  const { enum: enumList, const: constValue } = schema

  if (enumList || constValue !== undefined) {
    const { enum: _0, const: _1, ...rest } = schema
    targetSchema = rest
    shouldHandleEnumAndConst = true
  }
  let compiledSchema = checkAndCompileSchema(context, targetSchema)

  if (compiledSchema && shouldHandleEnumAndConst) {
    compiledSchema = compileEnumAndConst(context, enumList, constValue, compiledSchema)
  }
  if (!compiledSchema) {
    return null
  }
  return compiledSchema
}

function checkAndCompileSchema<E>(context: Context<E>, schema: InputSchema): CompiledSchema<E> | null {
  // check composition
  for (const key of COMBINATION_KEYS) {
    const combinationList = schema[key]
    if (combinationList) {
      const rejectKeys = Object.keys(schema).filter((k) => isJSONSchemaKey(k) && k !== key)
      if (rejectKeys.length > 0) {
        recordWarn(context, `composition key ${JSON.stringify(key)} will exclude other keys: ${rejectKeys.toSorted().join(', ')}`)
      }
      const compiledSchema = compileCombinationSchema(context, key, combinationList)
      if (!compiledSchema) {
        return null
      }
      return compiledSchema
    }
  }
  // check not
  {
    const notSchema = unwrapJSONSchema7Definition(schema.not)
    if (notSchema) {
      const rejectKeys = Object.keys(schema).filter((k) => isJSONSchemaKey(k) && k !== 'not')
      if (rejectKeys.length > 0) {
        recordWarn(context, `key "not" will exclude other keys: ${rejectKeys.toSorted().join(', ')}`)
      }
      const subContext = joinPath(context, 'not')
      const subSchema = compileSchema(subContext, notSchema)

      if (!subSchema) {
        return null
      }
      let kind: CompiledKind = CompiledKind.Not

      switch (getKind(subSchema)) {
        case CompiledKind.Never: {
          kind = CompiledKind.Any
          break
        }
        case CompiledKind.Any: {
          kind = CompiledKind.Never
          break
        }
      }
      return wrapCompiledSchema(kind, { not: subSchema } as JSONSchema7, context.delegate, context.path)
    }
  }
  // check about type field
  if (schema.type) {
    const { type } = schema
    if (Array.isArray(type)) {
      const { type: _type, ...rest } = schema
      return compileCombinationSchema(
        context,
        'anyOf',
        type.map((item) => ({ ...rest, type: item })),
      )
    }
    switch (type) {
      case 'object': {
        return compileObjectSchema(context, schema)
      }
      case 'array': {
        return compileArraySchema(context, schema)
      }
      default: {
        return compilePrimitiveSchema(context, schema as PrimitiveInputSchema)
      }
    }
  }
  // check any
  if (isLogicEmptyObject(schema)) {
    return wrapCompiledSchema(CompiledKind.Any, {}, context.delegate, context.path)
  }
  // unrecognized
  {
    recordError(context, 'unrecognized')
    return null
  }
}
