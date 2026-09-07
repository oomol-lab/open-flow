import type { Combination } from './combination.ts'
import type { ExpressionResult } from './result.ts'

import { makeCombination } from './combination.ts'
import {
  ExpressionNone,
  ExpressionSingleResult,
  ExpressionEquals,
  ExpressionContaining,
  ExpressionContainedBy,
  ExpressionRejection,
  ExpressionIntersection,
  ExpressionMaskList,
} from './result.ts'

export const CalculatorOperator = Object.freeze({
  Save: 0,
  OneOf: 1,
  AllOf: 2,
  AnyOf: 3,
  Not: 4,
  Swap: 5,
})

export type CalculatorOperator = (typeof CalculatorOperator)[keyof typeof CalculatorOperator]

export function calculate(operator: CalculatorOperator, expressions: readonly ExpressionResult[]): ExpressionResult {
  switch (operator) {
    case CalculatorOperator.Save: {
      return expressions[0]
    }
    case CalculatorOperator.OneOf: {
      return calculateOneOf(expressions)
    }
    case CalculatorOperator.AllOf:
    case CalculatorOperator.AnyOf: {
      return calculateCombination(operator, expressions)
    }
    case CalculatorOperator.Not:
    case CalculatorOperator.Swap: {
      return calculateUnary(operator, expressions[0])
    }
  }
}

export function swap(expression: ExpressionResult): ExpressionResult {
  return calculateUnary(CalculatorOperator.Swap, expression)
}

/**
 * The oneOf operator is indivisible, so `a + b + c` must be evaluated as one expression.
 * ![](../../doc/images/all_of_expression.png)
 */
function calculateOneOf(expressions: readonly ExpressionResult[]): ExpressionResult {
  // A single remaining branch makes oneOf equivalent to that branch.
  if (expressions.length === 1) {
    return expressions[0]
  }
  const unionSet = calculateCombination(CalculatorOperator.AnyOf, expressions)
  const intersectionList: ExpressionResult[] = []

  for (let i = 0; i < expressions.length; ++i) {
    for (let j = i + 1; j < expressions.length; ++j) {
      const left = expressions[i]
      const right = expressions[j]
      const intersection = calculateCombination(CalculatorOperator.AllOf, [left, right])
      intersectionList.push(intersection)
    }
  }
  const banZone = calculateCombination(CalculatorOperator.AnyOf, intersectionList)
  const enableZone = calculateUnary(CalculatorOperator.Not, banZone)

  return calculateCombination(CalculatorOperator.AllOf, [unionSet, enableZone])
}

function calculateCombination(operator: CalculatorOperator, expressions: readonly ExpressionResult[]): ExpressionResult {
  if (expressions.length < 0) {
    throw new Error('invalid expressions: empty array')
  }
  let combination: Combination

  switch (operator) {
    case CalculatorOperator.AllOf: {
      combination = makeCombination(calculateAllOf)
      break
    }
    case CalculatorOperator.AnyOf: {
      combination = makeCombination(calculateAnyOf)
      break
    }
    default: {
      throw new Error(`invalid operator ${operator}`)
    }
  }
  for (const expression of expressions) {
    combination.push(expression)
  }
  return combination.result
}

function calculateUnary(operator: CalculatorOperator, expression: ExpressionResult): ExpressionResult {
  let calculator: (expression: ExpressionSingleResult) => ExpressionResult
  let result: ExpressionResult = ExpressionNone

  switch (operator) {
    case CalculatorOperator.Not: {
      calculator = calculateNot
      break
    }
    case CalculatorOperator.Swap: {
      calculator = calculateSwap
      break
    }
    default: {
      throw new Error(`invalid operator ${operator}`)
    }
  }
  for (const [singleExpression, maskExpression] of ExpressionMaskList) {
    if (maskExpression & expression) {
      result |= calculator(singleExpression)
    }
  }
  return result
}

function calculateAllOf(e1: ExpressionSingleResult, e2: ExpressionSingleResult): ExpressionResult {
  let result: ExpressionResult = ExpressionNone
  switch (e1) {
    case ExpressionSingleResult.Equals: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionEquals
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionEquals
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionContainedBy
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionNone
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionContainedBy
          break
        }
      }
      break
    }
    case ExpressionSingleResult.Containing: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionEquals
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionEquals | ExpressionContaining
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionContainedBy
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionRejection
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionIntersection | ExpressionContainedBy
          break
        }
      }
      break
    }
    case ExpressionSingleResult.ContainedBy: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionContainedBy
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionContainedBy
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionContainedBy
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionNone
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionContainedBy
          break
        }
      }
      break
    }
    case ExpressionSingleResult.Rejection: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionNone
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionRejection
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionNone
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionRejection
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionRejection
          break
        }
      }
      break
    }
    case ExpressionSingleResult.Intersection: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionContainedBy
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionIntersection | ExpressionContainedBy
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionContainedBy
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionRejection
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionContainedBy | ExpressionRejection | ExpressionIntersection
          break
        }
      }
      break
    }
  }
  return result
}

function calculateAnyOf(e1: ExpressionSingleResult, e2: ExpressionSingleResult): ExpressionResult {
  let result: ExpressionResult = ExpressionNone
  switch (e1) {
    case ExpressionSingleResult.Equals: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionEquals
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionEquals
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionContaining
          break
        }
      }
      break
    }
    case ExpressionSingleResult.Containing: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionContaining
          break
        }
      }
      break
    }
    case ExpressionSingleResult.ContainedBy: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionEquals
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionEquals | ExpressionContainedBy
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionIntersection
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionContaining | ExpressionIntersection
          break
        }
      }
      break
    }
    case ExpressionSingleResult.Rejection: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionIntersection
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionRejection
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionIntersection
          break
        }
      }
      break
    }
    case ExpressionSingleResult.Intersection: {
      switch (e2) {
        case ExpressionSingleResult.Equals: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.Containing: {
          result = ExpressionContaining
          break
        }
        case ExpressionSingleResult.ContainedBy: {
          result = ExpressionContaining | ExpressionIntersection
          break
        }
        case ExpressionSingleResult.Rejection: {
          result = ExpressionIntersection
          break
        }
        case ExpressionSingleResult.Intersection: {
          result = ExpressionContaining | ExpressionIntersection
          break
        }
      }
      break
    }
  }
  return result
}

function calculateNot(expression: ExpressionSingleResult): ExpressionResult {
  let result: ExpressionResult = ExpressionNone
  switch (expression) {
    case ExpressionSingleResult.Equals: {
      result = ExpressionRejection
      break
    }
    case ExpressionSingleResult.Containing: {
      result = ExpressionRejection
      break
    }
    case ExpressionSingleResult.ContainedBy: {
      result = ExpressionIntersection
      break
    }
    case ExpressionSingleResult.Rejection: {
      result = ExpressionEquals | ExpressionContaining
      break
    }
    case ExpressionSingleResult.Intersection: {
      result = ExpressionContainedBy | ExpressionIntersection
      break
    }
  }
  return result
}

function calculateSwap(expression: ExpressionResult): ExpressionResult {
  let result: ExpressionResult = ExpressionNone
  switch (expression) {
    case ExpressionSingleResult.Equals: {
      result = ExpressionEquals
      break
    }
    case ExpressionSingleResult.Containing: {
      result = ExpressionContainedBy
      break
    }
    case ExpressionSingleResult.ContainedBy: {
      result = ExpressionContaining
      break
    }
    case ExpressionSingleResult.Rejection: {
      result = ExpressionRejection
      break
    }
    case ExpressionSingleResult.Intersection: {
      result = ExpressionIntersection
      break
    }
  }
  return result
}
