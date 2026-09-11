import type { JsonValue } from '../../flow/common/change.ts'

import { ApiError } from './errors.ts'

export function invalidResponse(): never {
  throw new ApiError(502, 'response.invalid', 'The Control API returned an invalid response.')
}

export function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return invalidResponse()
  return value as Readonly<Record<string, unknown>>
}

export function string(value: unknown): string {
  return typeof value == 'string' && value.length > 0 ? value : invalidResponse()
}

export function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(value)
  if (actual.length != keys.length || actual.some((key) => !keys.includes(key))) invalidResponse()
}

export function integer(value: unknown): number {
  return Number.isSafeInteger(value) ? (value as number) : invalidResponse()
}

export function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value == 'boolean' || typeof value == 'string') return value
  if (typeof value == 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(jsonValue)
  const source = record(value)
  return Object.fromEntries(Object.entries(source).map(([key, item]) => [key, jsonValue(item)]))
}

export function optionalString(value: unknown): string | undefined {
  if (value == null) return
  return string(value)
}
