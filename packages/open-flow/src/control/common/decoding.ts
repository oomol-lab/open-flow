import type { JsonValue } from '../../flow/common/change.ts'

import { ApiError } from './errors.ts'

export class InvalidResponseError extends ApiError {
  readonly detail?: string

  constructor(detail?: string) {
    super(502, 'response.invalid', `The Control API returned an invalid response.${detail == null ? '' : ` ${detail}`}`)
    this.detail = detail
  }
}

export function invalidResponse(detail?: string): never {
  throw new InvalidResponseError(detail)
}

export function record(value: unknown): Readonly<Record<string, unknown>> {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return invalidResponse('Expected an object.')
  return value as Readonly<Record<string, unknown>>
}

export function string(value: unknown): string {
  return typeof value == 'string' && value.length > 0 ? value : invalidResponse('Expected a non-empty string.')
}

export function exact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): void {
  const actual = Object.keys(value)
  if (actual.length != keys.length || actual.some((key) => !keys.includes(key))) {
    const missing = keys.filter((key) => !Object.hasOwn(value, key))
    const unexpected = actual.filter((key) => !keys.includes(key))
    invalidResponse(
      [missing.length > 0 ? `Missing fields: ${missing.join(', ')}.` : '', unexpected.length > 0 ? `Unexpected fields: ${unexpected.join(', ')}.` : '']
        .filter(Boolean)
        .join(' '),
    )
  }
}

export function integer(value: unknown): number {
  return Number.isSafeInteger(value) ? (value as number) : invalidResponse('Expected a safe integer.')
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
