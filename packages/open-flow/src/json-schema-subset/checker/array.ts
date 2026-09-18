import type { CompiledSchema } from '../compiler/index.ts'
import type { ExpressionResult } from '../expression/index.ts'
import type { Schema } from '../types.ts'
import type { Context } from './cache.ts'

import { ANY } from '../compiler/index.ts'
import {
  ExpressionNone,
  ExpressionContainedBy,
  ExpressionContaining,
  ExpressionEquals,
  ExpressionIntersection,
  ExpressionRejection,
  ExpressionSingleResult,
} from '../expression/index.ts'
import { createRangeSplitter, toExpressionSingleResult } from './range.ts'
import { makeQuantum } from './tools/index.ts'

const splitRange = createRangeSplitter(0)
const quantum = makeQuantum(['hasCommon', 'hasExtra1', 'hasExtra2', 'hasRejection', 'hasCommonBroken'])

export function calculateArray<E>({ calculate }: Context<E>, schema1: CompiledSchema<E>, schema2: CompiledSchema<E>): ExpressionResult {
  const splitResult = splitRange(schema1.minItems, schema1.maxItems, schema2.minItems, schema2.maxItems)
  const splitExpression = toExpressionSingleResult(splitResult)

  if (splitExpression === ExpressionSingleResult.Rejection) {
    return ExpressionRejection
  }
  const [items1, additionalItems1] = normalizeArray(schema1)
  const [items2, additionalItems2] = normalizeArray(schema2)

  // The final slot compares additionalItems without a tuple item.
  const itemsLength = Math.max(items1.length, items2.length) + 1
  const length = Math.min(itemsLength, splitResult.intersection!.max)
  const quantumVariable = quantum.variable({})
  const minItems = Math.min(schema1.minItems ?? 0, schema2.minItems ?? 0)

  for (let i = 0; i < length; i++) {
    const subSchema1 = items1[i] ?? additionalItems1
    const subSchema2 = items2[i] ?? additionalItems2
    const expression = calculate(subSchema1, subSchema2)

    quantumVariable.push(expression, (singleExpression, variable) => {
      switch (singleExpression) {
        case ExpressionSingleResult.Equals: {
          if (!variable.hasRejection) {
            variable.hasCommon = true
          }
          break
        }
        case ExpressionSingleResult.Containing: {
          if (!variable.hasRejection) {
            variable.hasCommon = true
          }
          variable.hasExtra1 = true
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          if (!variable.hasRejection) {
            variable.hasCommon = true
          }
          variable.hasExtra2 = true
          break
        }
        case ExpressionSingleResult.Intersection: {
          if (!variable.hasRejection) {
            variable.hasCommon = true
          }
          variable.hasExtra1 = true
          variable.hasExtra2 = true
          break
        }
        case ExpressionSingleResult.Rejection: {
          if (i < minItems) {
            variable.hasCommonBroken = true
          }
          variable.hasRejection = true
          variable.hasExtra1 = true
          variable.hasExtra2 = true
          break
        }
      }
    })
  }
  quantumVariable.update((variable) => {
    switch (splitExpression) {
      case ExpressionSingleResult.Containing: {
        variable.hasExtra1 = true
        break
      }
      case ExpressionSingleResult.ContainedBy: {
        variable.hasExtra2 = true
        break
      }
      case ExpressionSingleResult.Intersection: {
        variable.hasExtra1 = true
        variable.hasExtra2 = true
        break
      }
    }
    if (schema1.uniqueItems && !schema2.uniqueItems) variable.hasExtra2 = true
    else if (!schema1.uniqueItems && schema2.uniqueItems) variable.hasExtra1 = true
    if (schema1.maxItems === 0 || schema2.maxItems === 0) {
      // An unconstrained empty array can match any array schema.
      variable.hasCommon = true
      if (schema1.maxItems !== 0) {
        variable.hasExtra1 = true
      }
      if (schema2.maxItems !== 0) {
        variable.hasExtra2 = true
      }
    }
  })
  let expression = ExpressionNone

  for (const { hasExtra1, hasExtra2, hasCommon, hasCommonBroken } of quantumVariable) {
    let finalHasCommon = hasCommon
    if (hasCommonBroken) {
      finalHasCommon = false
    }
    if (!finalHasCommon) {
      expression |= ExpressionRejection
    } else if (hasExtra1 && hasExtra2) {
      expression |= ExpressionIntersection
    } else if (hasExtra1) {
      expression |= ExpressionContaining
    } else if (hasExtra2) {
      expression |= ExpressionContainedBy
    } else {
      expression |= ExpressionEquals
    }
  }
  return expression
}

function normalizeArray<E>({ items, additionalItems }: CompiledSchema<E>): [readonly Schema<E>[], Schema<E>] {
  if (Array.isArray(items)) {
    return [items as readonly Schema<E>[], (additionalItems ?? ANY) as Schema<E>]
  } else {
    return [[], (items ?? ANY) as Schema<E>]
  }
}
