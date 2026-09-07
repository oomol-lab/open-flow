import type { CompiledObject, CompiledSchema, CompiledValue } from '../compiler/index.ts'
import type { ExpressionResult } from '../expression/index.ts'
import type { ExtendsSchema } from '../extends/index.ts'
import type { Schema } from '../types.ts'
import type { DeepReadonly } from '../utils.ts'

import { getId, isCompiledObject } from '../compiler/index.ts'

export type Context<E> = {
  readonly isEquals: EqualsChecker
  readonly calculate: SchemaCalculator<E>
}

export type EqualsChecker = (value1: CompiledValue, value2: CompiledValue) => boolean
export type SchemaCalculator<E> = (superSchema: Schema<E>, subSchema: Schema<E>) => ExpressionResult

export function wrapEqualsCheckerWithCache(check: (object1: CompiledObject, object2: CompiledObject) => boolean): EqualsChecker {
  const map = new Map<string, boolean>()

  return (value1, value2) => {
    const isObject1 = isCompiledObject(value1)
    const isObject2 = isCompiledObject(value2)

    if (isObject1 !== isObject2) {
      return false
    }
    if (!isObject1) {
      return value1 === value2
    }
    const object1 = value1 as CompiledObject
    const object2 = value2 as CompiledObject

    return getWithCache(map, object1, object2, check)
  }
}

export function wrapSchemaCalculatorWithCache<E>(check: SchemaCalculator<E>): SchemaCalculator<E> {
  const map = new Map<string, ExpressionResult>()
  return (schema1, schema2) => getWithCache(map, schema1, schema2, check)
}

function getWithCache<R, E, N extends ExtendsSchema | DeepReadonly<CompiledSchema<E>> | DeepReadonly<CompiledObject>>(
  map: Map<string, R>,
  node1: N,
  node2: N,
  check: (n1: N, n2: N) => R,
): R {
  const id1 = getId(node1)
  const id2 = getId(node2)
  const key = `${id1}/${id2}`

  let result = map.get(key)
  if (result === undefined) {
    map.set(key, (result = check(node1, node2)))
  }
  return result
}
