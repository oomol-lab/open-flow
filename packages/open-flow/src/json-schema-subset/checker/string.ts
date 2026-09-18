import type { CompiledSchema } from '../compiler/index.ts'
import type { ExpressionResult } from '../expression/index.ts'

import {
  ExpressionAny,
  ExpressionEquals,
  ExpressionContaining,
  ExpressionContainedBy,
  ExpressionIntersection,
  ExpressionRejection,
  ExpressionSingleResult,
} from '../expression/index.ts'
import { createRangeSplitter, toExpressionSingleResult } from './range.ts'

const splitRange = createRangeSplitter(0)

export function calculateString<E>(schema1: CompiledSchema<E>, schema2: CompiledSchema<E>): ExpressionResult {
  if (schema2.format && !schema1.format) return ExpressionContaining
  if (schema1.format && schema2.format && schema1.format !== schema2.format) return ExpressionAny
  const splitResult = splitRange(schema1.minLength, schema1.maxLength, schema2.minLength, schema2.maxLength)
  const expression = toExpressionSingleResult(splitResult)
  const hasPattern1 = !!schema1.pattern
  const hasPattern2 = !!schema2.pattern

  switch (expression) {
    case ExpressionSingleResult.Rejection: {
      return ExpressionRejection
    }
    case ExpressionSingleResult.Containing: {
      return hasPattern1 ? ExpressionAny : ExpressionContaining
    }
    case ExpressionSingleResult.ContainedBy: {
      return hasPattern2 ? ExpressionAny : ExpressionContainedBy
    }
    case ExpressionSingleResult.Equals: {
      if (hasPattern1 && hasPattern2) {
        return schema1.pattern === schema2.pattern ? ExpressionEquals : ExpressionAny
      }
      if (hasPattern1) {
        return ExpressionEquals | ExpressionContainedBy
      }
      if (hasPattern2) {
        return ExpressionEquals | ExpressionContaining
      }
      return ExpressionEquals
    }
    case ExpressionSingleResult.Intersection: {
      if (hasPattern1 && hasPattern2) {
        return ExpressionAny
      }
      if (hasPattern1) {
        return ExpressionIntersection | ExpressionRejection | ExpressionContainedBy
      }
      if (hasPattern2) {
        return ExpressionIntersection | ExpressionRejection | ExpressionContaining
      }
      return ExpressionIntersection
    }
  }
}
