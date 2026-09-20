import type { FixedInputValue, InputValues, InputMapping, JsonValue } from './change.ts'

/** An explicit clear suppresses the default; absent mappings still inherit it. */
export function inputValue(mapping: InputMapping | undefined, fallback: JsonValue | undefined): JsonValue | undefined {
  if (mapping?.kind === 'unset') return undefined
  return mapping?.kind === 'value' ? mapping.value : fallback
}

/** Converts explicit user values at authoring boundaries, never persisted legacy data. */
export function inputValues(values: Readonly<Record<string, JsonValue>>): InputValues {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { kind: 'value', value }]))
}

export function fixedInputValue(value: JsonValue | undefined): FixedInputValue {
  return value === undefined ? { kind: 'unset' } : { kind: 'value', value }
}
