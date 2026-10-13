import type { JSONSchema7 } from 'json-schema'
import type { Context } from './common.ts'
import type { InputSchema } from './compiler.ts'
import type { CompiledValue, CompiledSchema } from './wrapper.ts'

import { ValidResult, valid } from '../checker/validator.ts'
import { isDeepEquals, deepCopy } from '../utils.ts'
import { recordError, recordWarn } from './common.ts'
import { wrapCompiledSchema, wrapCompiledValue, CompiledKind } from './wrapper.ts'

export function compileEnumAndConst<E>(
  context: Context<E>,
  enumList: InputSchema['enum'],
  constValue: InputSchema['const'],
  schema: CompiledSchema<E>,
): CompiledSchema<E> | null {
  let compiledEnum: CompiledValue[] | undefined
  let isNever = false

  if (enumList) {
    if (enumList.length === 0) {
      recordError(context, 'disable empty list', 'enum')
      return null
    }
    compiledEnum = []

    for (const [i, enumValue] of enumList.entries()) {
      switch (valid(schema, enumValue)) {
        case ValidResult.Valid: {
          compiledEnum.push(wrapCompiledValue(enumValue))
          break
        }
        case ValidResult.Invalid: {
          recordWarn(context, 'cannot pass JSON schema of currently schema object', 'enum', i)
          break
        }
      }
    }
    if (compiledEnum.length === 0) {
      recordWarn(context, 'all of elements from list is rejected by currently schema object', 'enum')
    }
  }
  if (constValue !== undefined && valid(schema, constValue) === ValidResult.Invalid) {
    isNever = true
  }
  if (compiledEnum) {
    if (compiledEnum.length === 0) {
      isNever = true
    } else if (constValue !== undefined) {
      let foundEquals = false
      for (const enumValue of compiledEnum) {
        if (isDeepEquals(enumValue, constValue)) {
          foundEquals = true
          break
        }
      }
      if (!foundEquals) {
        isNever = true
      }
    }
  }
  const kind = isNever ? CompiledKind.Never : CompiledKind.EnumOrConst
  const compiledSchema: JSONSchema7 = {}

  if (schema.type) {
    compiledSchema.type = schema.type
  }
  if (compiledEnum) {
    compiledSchema.enum = compiledEnum
  }
  if (constValue !== undefined) {
    compiledSchema.const = wrapCompiledValue(deepCopy(constValue))
  }
  return wrapCompiledSchema(kind, compiledSchema, context.delegate, context.path)
}
