import type { CompiledSchema } from '../compiler/index.ts'
import type { ExtendsContext } from '../extends/index.ts'
import type { Schema } from '../types.ts'

import { getId, isCompiledSchema } from '../compiler/index.ts'

export function schemaEqualsChecker<E>(extendsContext: ExtendsContext): (schema1: Schema<E>, schema2: Schema<E>) => boolean {
  function isSchemaEquals(schema1: Schema<E>, schema2: Schema<E>): boolean {
    const isExtends1 = extendsContext.isExtendsSchema(schema1)
    const isExtends2 = extendsContext.isExtendsSchema(schema2)

    if (isExtends1 || isExtends2) {
      return extendsContext.equals(schema1, schema2)
    } else {
      return isCompiledSchemaEquals(schema1, schema2)
    }
  }
  const equalsMap = new Map<string, boolean>()

  function isCompiledSchemaEquals(schema1: CompiledSchema<E>, schema2: CompiledSchema<E>): boolean {
    const id1 = getId(schema1)
    const id2 = getId(schema2)

    if (id1 === id2) {
      return true
    }
    const key = `${id1}/${id2}`
    let isEquals = equalsMap.get(key)

    if (isEquals === undefined) {
      isEquals = isObjectLikeEquals(schema1, schema2)
      equalsMap.set(key, isEquals)
    }
    return isEquals
  }

  function isObjectLikeEquals(object1: object, object2: object): boolean {
    if (Array.isArray(object1)) {
      if (!Array.isArray(object2)) {
        return false
      }
      if (object1.length !== object2.length) {
        return false
      }
      for (const [i, value1Element] of object1.entries()) {
        if (!isValueEquals(value1Element, object2[i])) {
          return false
        }
      }
    } else {
      if (Array.isArray(object2)) {
        return false
      }
      for (const key in object1) {
        if (!(key in object2)) {
          return false
        }
        const value1: unknown = Reflect.get(object1, key)
        const value2: unknown = Reflect.get(object2, key)
        if (!isValueEquals(value1, value2)) {
          return false
        }
      }
      for (const key in object2) {
        if (!(key in object1)) {
          return false
        }
      }
    }
    return true
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isValueEquals(value1: any, value2: any): boolean {
    if (value1 === value2) {
      return true
    }
    if (value1 === null || value2 === null) {
      return false
    }
    if (typeof value1 !== 'object') {
      return false
    }
    if (typeof value1 !== typeof value2) {
      return false
    }
    if (isCompiledSchema<E>(value1) && isCompiledSchema<E>(value2)) {
      return isCompiledSchemaEquals(value1, value2)
    }
    return isObjectLikeEquals(value1, value2)
  }
  return isSchemaEquals
}
