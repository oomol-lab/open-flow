import type { CompiledSchema } from '../compiler/index.ts'
import type { ExpressionResult } from '../expression/index.ts'
import type { Schema } from '../types.ts'
import type { Context } from './cache.ts'
import type { QuantumVariableType } from './tools/index.ts'

import { getKind, ANY, NEVER, CompiledKind } from '../compiler/index.ts'
import {
  ExpressionNone,
  ExpressionEquals,
  ExpressionContaining,
  ExpressionContainedBy,
  ExpressionIntersection,
  ExpressionRejection,
  ExpressionSingleResult,
} from '../expression/index.ts'
import { createRangeSplitter, toExpressionSingleResult } from './range.ts'
import { makeQuantum } from './tools/index.ts'
import { ValidResult, valid } from './validator.ts'

const splitRange = createRangeSplitter(0)
const quantum = makeQuantum(['hasCommonInRequired', 'hasCommonOutRequired', 'hasExtra1', 'hasExtra2', 'hasRejection'])

// TODO: Handle object schemas introduced by the unsupported dependencies keyword.
export function calculateObject<E>(context: Context<E>, schema1: CompiledSchema<E>, schema2: CompiledSchema<E>): ExpressionResult {
  if (isPropertiesCountCannotMatch(schema1, schema2)) {
    return ExpressionRejection
  }
  const splitRequiredResult = splitRequired(schema1, schema2)

  if (!splitRequiredResult) {
    return ExpressionRejection
  }
  const getProperty1 = createPropertySchemaGetter(schema1)
  const getProperty2 = createPropertySchemaGetter(schema2)
  const calculateKey = (key: string): ExpressionResult => {
    const propertySchema1 = getProperty1(key)
    const propertySchema2 = getProperty2(key)

    if (areNotBothNever(propertySchema1, propertySchema2)) {
      return context.calculate(propertySchema1, propertySchema2)
    } else {
      return ExpressionNone
    }
  }
  const { commonRequired, extraRequired1, extraRequired2 } = splitRequiredResult
  const quantumVariable = quantum.variable({})

  for (const requiredKey of [...commonRequired].toSorted()) {
    quantumVariable.push(calculateKey(requiredKey), calculateCommonRequiredExpression)
  }
  for (const requiredKey of [...extraRequired1].toSorted()) {
    quantumVariable.push(calculateKey(requiredKey), calculateExtraRequiredExpression1)
  }
  for (const requiredKey of [...extraRequired2].toSorted()) {
    quantumVariable.push(calculateKey(requiredKey), calculateExtraRequiredExpression2)
  }
  const { hasOptional1, hasOptional2 } = splitRequiredResult

  if (hasOptional1 || hasOptional2) {
    const calculator = calculateOptionalExpression(hasOptional1, hasOptional2)

    for (const optionalKey of [...getOptionalKeys(schema1, schema2)].toSorted()) {
      const expression = calculateKey(optionalKey)
      if (expression !== ExpressionNone) {
        quantumVariable.push(expression, calculator)
      }
    }
    const additionalProperties1 = (schema1.additionalProperties as Schema<E>) ?? ANY
    const additionalProperties2 = (schema2.additionalProperties as Schema<E>) ?? ANY

    if (areNotBothNever(additionalProperties1, additionalProperties2)) {
      const expression = context.calculate(additionalProperties1, additionalProperties2)
      quantumVariable.push(expression, calculator)
    }
  }
  quantumVariable.update((variable) => {
    if (!variable.hasRejection) {
      // Fewer required properties leave more possibilities outside the common set.
      if (extraRequired1.size > 0) {
        variable.hasExtra2 = true
      }
      if (extraRequired2.size > 0) {
        variable.hasExtra1 = true
      }
    }
  })
  const { requiredKeysCount } = splitRequiredResult
  let expression = ExpressionNone

  for (const { hasExtra1, hasExtra2, hasCommonInRequired, hasCommonOutRequired, hasRejection } of quantumVariable) {
    if (!hasCommonInRequired && requiredKeysCount > 0) {
      expression |= ExpressionRejection
    } else if (!hasCommonOutRequired && requiredKeysCount === 0) {
      expression |= ExpressionRejection
    } else if (hasRejection) {
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

function isPropertiesCountCannotMatch<E>(schema1: CompiledSchema<E>, schema2: CompiledSchema<E>): boolean {
  const splitResult = splitRange(schema1.minProperties, schema1.maxProperties, schema2.minProperties, schema2.maxProperties)
  const splitExpression = toExpressionSingleResult(splitResult)

  return splitExpression === ExpressionSingleResult.Rejection
}

type SplitRequiredResult = {
  readonly requiredKeysCount: number
  readonly commonRequired: Set<string>
  readonly extraRequired1: Set<string>
  readonly extraRequired2: Set<string>
  readonly hasOptional1: boolean
  readonly hasOptional2: boolean
}

function splitRequired<E>(schema1: CompiledSchema<E>, schema2: CompiledSchema<E>): SplitRequiredResult | null {
  const extraRequired1 = new Set<string>(schema1.required)
  const extraRequired2 = new Set<string>(schema2.required)
  const commonRequired = new Set<string>()
  const wholeRequired = new Set<string>()

  const requiredCount1 = extraRequired1.size
  const requiredCount2 = extraRequired2.size

  for (const key of extraRequired1) {
    if (extraRequired2.has(key)) {
      commonRequired.add(key)
    }
    wholeRequired.add(key)
  }
  for (const key of extraRequired2) {
    if (extraRequired1.has(key)) {
      commonRequired.add(key)
    }
    wholeRequired.add(key)
  }
  const requiredKeysCount = wholeRequired.size

  for (const key of commonRequired) {
    extraRequired1.delete(key)
    extraRequired2.delete(key)
  }
  const maxProperties1 = schema1.maxProperties ?? Number.MAX_SAFE_INTEGER
  const maxProperties2 = schema2.maxProperties ?? Number.MAX_SAFE_INTEGER

  if (requiredKeysCount > maxProperties1 || requiredKeysCount > maxProperties2) {
    return null
  }
  return {
    requiredKeysCount,
    extraRequired1,
    extraRequired2,
    commonRequired,
    hasOptional1: maxProperties1 > requiredCount1,
    hasOptional2: maxProperties2 > requiredCount2,
  }
}

function getOptionalKeys<E>(schema1: CompiledSchema<E>, schema2: CompiledSchema<E>): Set<string> {
  const optionalKeys = new Set<string>(schema1.required)
  const properties1 = schema1.properties
  const properties2 = schema2.properties
  const required1 = schema1.required
  const required2 = schema2.required

  if (properties1) {
    for (const key in properties1) {
      optionalKeys.add(key)
    }
  }
  if (properties2) {
    for (const key in properties2) {
      optionalKeys.add(key)
    }
  }
  if (required1) {
    for (const key of required1) {
      optionalKeys.delete(key)
    }
  }
  if (required2) {
    for (const key of required2) {
      optionalKeys.delete(key)
    }
  }
  return optionalKeys
}

const calculateCommonRequiredExpression = (singleExpression: ExpressionSingleResult, variable: QuantumVariableType<typeof quantum>): void => {
  switch (singleExpression) {
    case ExpressionSingleResult.Equals: {
      variable.hasCommonInRequired = true
      break
    }
    case ExpressionSingleResult.Containing: {
      variable.hasExtra1 = true
      variable.hasCommonInRequired = true
      break
    }
    case ExpressionSingleResult.ContainedBy: {
      variable.hasExtra2 = true
      variable.hasCommonInRequired = true
      break
    }
    case ExpressionSingleResult.Intersection: {
      variable.hasExtra1 = true
      variable.hasExtra2 = true
      variable.hasCommonInRequired = true
      break
    }
    case ExpressionSingleResult.Rejection: {
      variable.hasRejection = true
      break
    }
  }
}

const calculateExtraRequiredExpression1 = (singleExpression: ExpressionSingleResult, variable: QuantumVariableType<typeof quantum>): void => {
  switch (singleExpression) {
    case ExpressionSingleResult.Equals:
    case ExpressionSingleResult.ContainedBy: {
      variable.hasCommonInRequired = true
      break
    }
    case ExpressionSingleResult.Intersection:
    case ExpressionSingleResult.Containing: {
      variable.hasExtra1 = true
      variable.hasCommonInRequired = true
      break
    }
    case ExpressionSingleResult.Rejection: {
      variable.hasRejection = true
      break
    }
  }
}

const calculateExtraRequiredExpression2 = (singleExpression: ExpressionSingleResult, variable: QuantumVariableType<typeof quantum>): void => {
  switch (singleExpression) {
    case ExpressionSingleResult.Equals:
    case ExpressionSingleResult.Containing: {
      variable.hasCommonInRequired = true
      break
    }
    case ExpressionSingleResult.Intersection:
    case ExpressionSingleResult.ContainedBy: {
      variable.hasExtra2 = true
      variable.hasCommonInRequired = true
      break
    }
    case ExpressionSingleResult.Rejection: {
      variable.hasRejection = true
      break
    }
  }
}

const calculateOptionalExpression =
  (hasOptional1: boolean, hasOptional2: boolean) =>
  (singleExpression: ExpressionSingleResult, variable: QuantumVariableType<typeof quantum>): void => {
    if (variable.hasRejection) {
      return
    }
    let foundExtraPossibility1 = false
    let foundExtraPossibility2 = false
    let foundCommonPossibility = false

    switch (singleExpression) {
      case ExpressionSingleResult.Equals: {
        foundCommonPossibility = true
        break
      }
      case ExpressionSingleResult.Containing: {
        foundExtraPossibility1 = true
        foundCommonPossibility = true
        break
      }
      case ExpressionSingleResult.ContainedBy: {
        foundExtraPossibility2 = true
        foundCommonPossibility = true
        break
      }
      case ExpressionSingleResult.Intersection: {
        foundExtraPossibility1 = true
        foundExtraPossibility2 = true
        foundCommonPossibility = true
        break
      }
      case ExpressionSingleResult.Rejection: {
        foundExtraPossibility1 = true
        foundExtraPossibility2 = true
        break
      }
    }
    if (hasOptional1 && foundExtraPossibility1) {
      variable.hasExtra1 = true
    }
    if (hasOptional2 && foundExtraPossibility2) {
      variable.hasExtra2 = true
    }
    if (hasOptional1 && hasOptional2 && foundCommonPossibility) {
      variable.hasCommonOutRequired = true
    }
  }

type PropertySchemaGetter<E> = (key: string) => Schema<E>

function createPropertySchemaGetter<E>(schema: CompiledSchema<E>): PropertySchemaGetter<E> {
  const properties = schema.properties as Readonly<{ [key: string]: CompiledSchema<E> }> | undefined
  const propertyNames = schema.propertyNames as CompiledSchema<E> | undefined
  const additionalProperties = schema.additionalProperties as Schema<E> | undefined
  const patternProperties: { pattern: RegExp; schema: Schema<E> }[] = []

  if (schema.patternProperties) {
    for (const pattern in schema.patternProperties) {
      const valueSchema = schema.patternProperties[pattern] as Schema<E>
      const regExp = new RegExp(pattern, 'i')
      patternProperties.push({ pattern: regExp, schema: valueSchema })
    }
  }
  return (key) => {
    if (propertyNames && valid(propertyNames, key) === ValidResult.Invalid) {
      return NEVER
    }
    for (const { pattern, schema: patternSchema } of patternProperties) {
      if (pattern.test(key)) {
        return patternSchema
      }
    }
    const propertySchema = (properties && properties[key]) ?? additionalProperties

    if (!propertySchema) {
      return ANY
    }
    return propertySchema
  }
}

function areNotBothNever<E>(schema1: Schema<E>, schema2: Schema<E>): boolean {
  const kind1 = getKind(schema1)
  const kind2 = getKind(schema2)
  return kind1 !== CompiledKind.Never || kind2 !== CompiledKind.Never
}
