import type { Result } from '@wopjs/tsur'
import type { ValConfig } from 'value-enhancer'

import { isBoolean, isDefined, isPlainObject, isString, isTruthy } from '@wopjs/cast'
import { Err, Ok } from '@wopjs/tsur'
import { isEqual, isNumber } from 'radash'

export const isBannedName = (name: string): boolean => name === '__proto__'

export const lerp = (t: number, a: number, b: number): number => a + t * (b - a)

export const identity = <T>(value: T): T => value

export function arrayFindIndexOrLength<T>(array: readonly T[], predicate: (value: T, index: number, array: readonly T[]) => boolean): number {
  const i = array.findIndex(predicate)
  return i >= 0 ? i : array.length
}

// Predefined option for value-enhancer.
export const equalConfig: ValConfig = /*#__PURE__*/ Object.freeze({ equal: isEqual })

// Predefined option for checkbox and toggle switch.
export const trueFalse = { true: 'True', false: 'False' }

export function noop(): any {
  // do nothing
}

export async function asyncNoop(): Promise<any> {
  // do nothing
}

export const MAX_I32 = 2147483647

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function isFunction(value: unknown): value is Function {
  return typeof value === 'function'
}

export function asArray<T>(value: readonly T[] | undefined | null | void): readonly T[]
export function asArray<T>(value: T | readonly T[]): readonly T[]
export function asArray(value: unknown): any[]
export function asArray(value: unknown): any[] {
  return value == null ? [] : Array.isArray(value) ? value : [value]
}

export function toArray<T>(value: T | T[]): T[] | undefined {
  return Array.isArray(value) ? value : undefined
}

export function toSomeTruthyArray<T>(value: T[]): T[] | undefined {
  return value.some(isTruthy) ? value : undefined
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString)
}

export function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(asString) : undefined
}

export function splitToStringArray(value: string, separator = ','): string[] {
  return value
    .split(separator)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function last<T>(array: readonly T[] | undefined): T | undefined {
  return array?.[array.length - 1]
}

export function coalesce<T>(array: ReadonlyArray<T | undefined | null>): T[] {
  return (array as T[]).filter((e) => e != null)
}

export const Negative: unique symbol = Symbol('Negative')
export type Negative = typeof Negative
export function filterMap<T, U>(array: ReadonlyArray<T>, fn: (value: T, index: number) => U | Negative, thisArg?: any): U[] {
  const result: U[] = []
  for (let i = 0; i < array.length; i++) {
    const value = fn.call(thisArg, array[i], i)
    if (value !== Negative) {
      result.push(value)
    }
  }
  return result
}

export function asObject(value: unknown): Record<PropertyKey, unknown> {
  return isPlainObject(value) ? value : {}
}

/**
 * @returns the value if it is a plain object, otherwise undefined.
 */
export function toPlainObject(value: unknown): Record<PropertyKey, unknown> | undefined {
  if (isPlainObject(value)) {
    return value
  }
}

export function toNonEmptyPlainObject<T extends Record<PropertyKey, unknown>>(value: T): T | undefined
export function toNonEmptyPlainObject(value: unknown): Record<PropertyKey, unknown> | undefined
export function toNonEmptyPlainObject<T>(value: T): T | undefined {
  if (isPlainObject(value)) {
    for (const v of Object.values(value)) {
      if (isDefined(v)) {
        return value
      }
    }
  }
}

export function toPlainObjectOf<T>(obj: unknown, valuePredicate: (value: unknown) => value is T): Record<PropertyKey, T> | undefined {
  if (isPlainObject(obj)) {
    let hasResult = false
    const result: Record<PropertyKey, T> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (valuePredicate(value)) {
        hasResult = true
        result[key] = value
      }
    }
    if (hasResult) {
      return result
    }
  }
}

export function isTrue(value: unknown): value is true {
  return value === true
}

export function toTrue(value: unknown): true | undefined {
  return value === true ? true : undefined
}

export function toPlainObjectOfTrue(obj: unknown): Record<PropertyKey, true> | undefined {
  return toPlainObjectOf(obj, isTrue)
}

export function asString(value: unknown): string {
  if (isString(value)) {
    return value
  }
  if (value == null) {
    return ''
  }
  try {
    return JSON.stringify(value)
  } catch {
    try {
      // Insane case: data = { toString: () => { throw data } }
      return value + ''
    } catch {
      return ''
    }
  }
}

/**
 * @returns `"undefined"` and `"null"` respectively and fallback to json.
 */
export function inspect(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }
  try {
    return JSON.stringify(value)
  } catch {
    try {
      // Insane case: data = { toString: () => { throw data } }
      return value + ''
    } catch {
      return ''
    }
  }
}

export function filterString(value: unknown): string | undefined {
  return isString(value) ? value : undefined
}

export function toNonEmptyString(value: unknown): string | undefined {
  return value && isString(value) ? value : undefined
}

export function asNumber(value: unknown, integer?: boolean): number {
  const num = Number(value)
  return Number.isFinite(num) ? (integer ? Math.floor(num) : num) : 0
}

/**
 * @returns the number if it is a number, otherwise undefined.
 */
export function toNumber(value: unknown): number | undefined {
  return isNumber(value) ? value : undefined
}

export function isPositiveNumber(value: unknown): value is number {
  return isNumber(value) && value > 0
}

/**
 * @returns `true` if the value is `true`, otherwise `false`.
 */
export function asTrue(value: unknown): boolean {
  return isBoolean(value) ? value : false
}

export function toBoolean(value: unknown): boolean | undefined {
  return isBoolean(value) ? value : undefined
}

export function inferNewItemName(prefix: string, items: Iterable<string>): string {
  let max = 0
  for (const item of items) {
    if (item.startsWith(prefix)) {
      if (item === prefix) {
        max = Math.max(max, 1)
        continue
      }
      const num = Number.parseInt(item.slice(prefix.length))
      if (Number.isSafeInteger(num) && num > max) {
        max = num
      }
    }
  }
  return max === 0 ? prefix : `${prefix}${max + 1}`
}

/**
 * ```js
 * const setName = setPartial(object$, "name")
 * ```
 */
export function setPartial<P = unknown, T = {}>(
  val: { readonly value: T; set(value: T): void },
  field: keyof NonNullable<T>,
  equal: (value1: any, value2: any) => boolean = Object.is,
): (fieldValue: P) => void {
  return (fieldValue: P) => {
    if (!equal((val.value as any)?.[field], fieldValue)) {
      val.set({ ...val.value, [field]: fieldValue })
    }
  }
}

/**
 * Skips the update when the object has already been removed from the reactive value.
 *
 * ```js
 * const setName = updatePartial(object$, "name")
 * ```
 */
export function updatePartial<P = unknown, T = {}>(
  val: { readonly value: T; set(value: T): void },
  field: keyof NonNullable<T>,
  equal: (value1: any, value2: any) => boolean = Object.is,
): (fieldValue: P) => void {
  return (fieldValue: P) => {
    if (val.value && !equal((val.value as any)[field], fieldValue)) {
      val.set({ ...val.value, [field]: fieldValue })
    }
  }
}

export function deepGet<T>(obj: unknown, keys: PropertyKey[], def?: T): T {
  for (let p = 0; p < keys.length; p++) {
    obj = obj ? (obj as any)[keys[p]] : undefined
  }
  return (obj === undefined ? def : obj) as T
}

export function tryParseJSON(value: string): Result<unknown, string> {
  try {
    return Ok(JSON.parse(value))
  } catch (e) {
    return Err(e + '')
  }
}

/** Returns `'{}'` if failed to stringify. */
export function stringifyJSON(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch (error) {
    console.warn(error)
    return '{}'
  }
}

export function isWorkspaceBlock(name: string | null | undefined): boolean {
  return !!name && (name.startsWith('self::') || name.startsWith('./') || name.startsWith('../'))
}

export function toggle(val: { readonly value: boolean; set(value: boolean): void } | undefined): (() => void) | undefined {
  return val ? () => val.set(!val.value) : undefined
}

export function isUserTranslateKey(str: string | undefined): str is `%${string}%` {
  return !!str && str.startsWith('%') && str.endsWith('%') && str.length > 2
}

/** `"%key%"` → `"key"`, otherwise `undefined` */
export function toUserTranslateKey(str: string | undefined): string | undefined {
  return isUserTranslateKey(str) ? str.slice(1, -1) : undefined
}

/** `"%key%"` → `undefined` */
export function toNotUserTranslateKey(str: string | undefined): string | undefined {
  return isUserTranslateKey(str) ? undefined : str
}

const MaxKeyLength = 64

/** `"hello world!"` → `"hello-world"` */
export function generateTranslateKey(str: string | undefined, locale: Record<string, string>): string {
  let key = str
    ?.toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, MaxKeyLength)
    .replace(/-+$/, '')
  if (key && !isBannedName(key)) {
    let uniqueKey = key
    let i = 1
    while (locale[uniqueKey] != null) {
      uniqueKey = `${key}${i++}`
    }
    return uniqueKey
  } else {
    for (let i = 1; ; i++) {
      key = `key${i}`
      if (locale[key] == null) {
        return key
      }
    }
  }
}

/** `"foo"` → `"foo2"` */
export function fixTranslateKey(str: string, locale: Record<string, string>): string {
  if (isBannedName(str)) {
    str = '_' + str
  }
  let uniqueKey = str
  let i = 1
  while (locale[uniqueKey] != null) {
    uniqueKey = `${str}${i++}`
  }
  return uniqueKey
}

export function isEnglish(str: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x09\x0A\x0D\x20-\x7E]+$/.test(str)
}

export function getOwnValue<T extends {}, K extends keyof T>(obj: T, key: K): T[K] | undefined {
  return Object.hasOwn(obj, key) ? obj[key] : undefined
}
