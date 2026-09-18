import type { JSONSchema7Definition } from 'json-schema'
import type { CompiledSchema, SchemaPath } from '../compiler/index.ts'
import type { Calculator, Describer, ExpressionDescription, ExpressionResult } from '../expression/index.ts'
import type { ExtendsContext } from '../extends/index.ts'
import type { Schema } from '../types.ts'
import type { DeepReadonly } from '../utils.ts'
import type { Context } from './cache.ts'

import { CompiledKind, getKind, getPath } from '../compiler/index.ts'
import {
  swap,
  expression,
  ExpressionKind,
  ExpressionEquals,
  ExpressionContaining,
  ExpressionContainedBy,
  ExpressionRejection,
  hasContainedBy,
  hasEquals,
  hasContaining,
  hasIntersection,
  hasRejection,
} from '../expression/index.ts'
import { isDeepEquals } from '../utils.ts'
import { calculateArray } from './array.ts'
import { wrapEqualsCheckerWithCache, wrapSchemaCalculatorWithCache } from './cache.ts'
import { calculateEnumAndEnum, calculateEnumAndSchema } from './enumAndConst.ts'
import { schemaEqualsChecker } from './equals.ts'
import { calculateNumeric } from './numeric/index.ts'
import { calculateObject } from './object.ts'
import { calculateString } from './string.ts'

export type Options = {
  readonly printWarnLog?: boolean
}

export interface CheckResult {
  readonly errorPath?: SchemaPath | undefined
  readonly expression: ExpressionResult
}

type WritableContext<E> = { -readonly [K in keyof Context<E>]?: Context<E>[K] }

export function checkWithResult<E>(extendsContext: ExtendsContext, schema1: Schema<E>, schema2: Schema<E>): CheckResult {
  const context: WritableContext<E> = {}
  const errorPaths: SchemaPath[] = []
  const calculate = wrapSchemaCalculatorWithCache(calculator(extendsContext, context as Context<E>))
  const describe = describer<E>()
  const equals = schemaEqualsChecker<E>(extendsContext)
  context.isEquals = wrapEqualsCheckerWithCache(isDeepEquals)
  context.calculate = expression({
    describe,
    equals,
    calculate,
    observeCalculation: (left, right, result, swapped) => {
      const comparisonResult = swapped ? swap(result) : result
      if (!isDecisiveMismatch(comparisonResult)) return
      const errorPath = swapped ? findMismatchPath(right, left) : findMismatchPath(left, right)
      if (errorPath) errorPaths.push(errorPath)
    },
  })
  Object.freeze(context)
  const comparisonExpression = context.calculate(schema1, schema2)
  return { errorPath: errorPaths[0], expression: comparisonExpression }
}

const describer =
  <E>(): Describer<Schema<E>> =>
  (schema: Schema<E>) => {
    let description: ExpressionDescription<Schema<E>>
    switch (getKind(schema)) {
      case CompiledKind.Not: {
        description = {
          kind: ExpressionKind.Not,
          expression: (schema as CompiledSchema<E>).not as Schema<E>,
        }
        break
      }
      case CompiledKind.Combination: {
        if ('allOf' in schema) {
          description = {
            kind: ExpressionKind.AllOf,
            expressions: rejectInSchemaList(schema.allOf, CompiledKind.Any),
          }
        } else if ('anyOf' in schema) {
          description = {
            kind: ExpressionKind.AnyOf,
            expressions: rejectInSchemaList(schema.anyOf, CompiledKind.Never),
          }
        } else if ('oneOf' in schema) {
          description = {
            kind: ExpressionKind.OneOf,
            expressions: rejectInSchemaList(schema.oneOf, CompiledKind.Never),
          }
        } else {
          throw new Error(`invalid combination JSON Schema: ${JSON.stringify(schema)}`)
        }
        break
      }
      default: {
        description = { kind: ExpressionKind.Leaf }
        break
      }
    }
    return description
  }

const calculator =
  <E>(extendsContext: ExtendsContext, context: Context<E>): Calculator<Schema<E>> =>
  (schema1, schema2) => {
    const kind1 = getKind(schema1)
    const kind2 = getKind(schema2)

    if (kind1 === CompiledKind.Extends || kind2 === CompiledKind.Extends) {
      return extendsContext.calculate(schema1, schema2)
    }
    switch (kind1) {
      case CompiledKind.Any: {
        return kind2 === CompiledKind.Any ? ExpressionEquals : ExpressionContaining
      }
      case CompiledKind.Never: {
        return kind2 === CompiledKind.Never ? ExpressionEquals : ExpressionContainedBy
      }
    }
    switch (kind2) {
      case CompiledKind.Any: {
        return ExpressionContainedBy
      }
      case CompiledKind.Never: {
        return ExpressionContaining
      }
    }
    if (kind1 === CompiledKind.EnumOrConst && kind2 === CompiledKind.EnumOrConst) {
      return calculateEnumAndEnum(context, schema1 as CompiledSchema<E>, schema2 as CompiledSchema<E>)
    }
    if (kind1 === CompiledKind.EnumOrConst) {
      return calculateEnumAndSchema(schema1 as CompiledSchema<E>, schema2 as CompiledSchema<E>)
    }
    if (kind2 === CompiledKind.EnumOrConst) {
      return swap(calculateEnumAndSchema(schema2 as CompiledSchema<E>, schema1 as CompiledSchema<E>))
    }
    if (kind1 !== kind2) {
      return ExpressionRejection
    }
    switch (kind1) {
      case CompiledKind.Null: {
        return ExpressionEquals
      }
      case CompiledKind.Numeric: {
        return calculateNumeric(schema1 as CompiledSchema<E>, schema2 as CompiledSchema<E>)
      }
      case CompiledKind.String: {
        return calculateString(schema1 as CompiledSchema<E>, schema2 as CompiledSchema<E>)
      }
      case CompiledKind.Boolean: {
        return ExpressionEquals
      }
      case CompiledKind.Object: {
        return calculateObject(context, schema1 as CompiledSchema<E>, schema2 as CompiledSchema<E>)
      }
      case CompiledKind.Array: {
        return calculateArray(context, schema1 as CompiledSchema<E>, schema2 as CompiledSchema<E>)
      }
      default: {
        throw new Error(`invalid kind ${kind1}`)
      }
    }
  }

function rejectInSchemaList<E>(schemaList: DeepReadonly<JSONSchema7Definition[]> | undefined, kind: CompiledKind): CompiledSchema<E>[] {
  return (schemaList as CompiledSchema<E>[]).filter((e) => getKind(e) !== kind)
}

function isDecisiveMismatch(result: ExpressionResult): boolean {
  return !hasEquals(result) && !hasContainedBy(result) && (hasContaining(result) || hasIntersection(result) || hasRejection(result))
}

function findMismatchPath<E>(source: Schema<E>, target: Schema<E>): SchemaPath | undefined {
  const targetPath = getPath(target)
  if (!targetPath) return undefined
  const sourceKind = getKind(source)
  const targetKind = getKind(target)
  if (sourceKind !== targetKind) return [...targetPath, 'type']

  const sourceSchema = source as CompiledSchema<E>
  const targetSchema = target as CompiledSchema<E>
  switch (targetKind) {
    case CompiledKind.String: {
      if ((sourceSchema.minLength ?? 0) < (targetSchema.minLength ?? 0)) return [...targetPath, 'minLength']
      if ((sourceSchema.maxLength ?? Number.POSITIVE_INFINITY) > (targetSchema.maxLength ?? Number.POSITIVE_INFINITY)) return [...targetPath, 'maxLength']
      if (sourceSchema.pattern !== targetSchema.pattern && targetSchema.pattern) return [...targetPath, 'pattern']
      if (sourceSchema.format !== targetSchema.format && targetSchema.format) return [...targetPath, 'format']
      break
    }
    case CompiledKind.Numeric: {
      if (
        (sourceSchema.minimum ?? sourceSchema.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) <
        (targetSchema.minimum ?? targetSchema.exclusiveMinimum ?? Number.NEGATIVE_INFINITY)
      ) {
        return [...targetPath, targetSchema.exclusiveMinimum == null ? 'minimum' : 'exclusiveMinimum']
      }
      if (
        (sourceSchema.maximum ?? sourceSchema.exclusiveMaximum ?? Number.POSITIVE_INFINITY) >
        (targetSchema.maximum ?? targetSchema.exclusiveMaximum ?? Number.POSITIVE_INFINITY)
      ) {
        return [...targetPath, targetSchema.exclusiveMaximum == null ? 'maximum' : 'exclusiveMaximum']
      }
      if (sourceSchema.multipleOf !== targetSchema.multipleOf && targetSchema.multipleOf != null) return [...targetPath, 'multipleOf']
      break
    }
    case CompiledKind.Array: {
      if ((sourceSchema.minItems ?? 0) < (targetSchema.minItems ?? 0)) return [...targetPath, 'minItems']
      if ((sourceSchema.maxItems ?? Number.POSITIVE_INFINITY) > (targetSchema.maxItems ?? Number.POSITIVE_INFINITY)) return [...targetPath, 'maxItems']
      break
    }
    case CompiledKind.Object: {
      const sourceRequired = new Set(sourceSchema.required ?? [])
      if ((targetSchema.required ?? []).some((key) => !sourceRequired.has(key))) return [...targetPath, 'required']
      if ((sourceSchema.minProperties ?? 0) < (targetSchema.minProperties ?? 0)) return [...targetPath, 'minProperties']
      if ((sourceSchema.maxProperties ?? Number.POSITIVE_INFINITY) > (targetSchema.maxProperties ?? Number.POSITIVE_INFINITY))
        return [...targetPath, 'maxProperties']
      break
    }
    case CompiledKind.EnumOrConst: {
      return [...targetPath, targetSchema.const == null ? 'enum' : 'const']
    }
  }
  return targetPath
}
