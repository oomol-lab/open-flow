import { dequal } from 'dequal/lite'
import { objectValue } from './value.ts'

/** Selection compares JSON structure, including objects whose property order differs. */
export function enumIndex(options: readonly unknown[], value: unknown): number {
  return options.findIndex((option) => dequal(option, value))
}

export function toggleEnumValue(options: readonly unknown[], value: unknown, index: number, selected: boolean): readonly unknown[] {
  const values = Array.isArray(value) ? value : []
  const item = options[index]
  if (index < 0 || index >= options.length) return values
  if (!selected) return values.filter((entry) => !dequal(entry, item))
  return enumIndex(values, item) >= 0 ? values : [...values, structuredClone(item)]
}

export function schemaChoices(schema: unknown): readonly unknown[] | undefined {
  const source = objectValue(schema)
  if (Array.isArray(source?.oneOf)) return source.oneOf
  if (Array.isArray(source?.anyOf)) return source.anyOf
}

/** The selected branch controls presentation; validation still uses the complete original schema. */
export function choiceSchema(schema: unknown, index: number): unknown {
  const source = objectValue(schema) ?? {}
  const { anyOf: _anyOf, oneOf: _oneOf, 'ui:options': _options, ...base } = source
  const branch = schemaChoices(schema)?.[index]
  if (typeof branch === 'boolean') return branch
  return { ...base, ...objectValue(branch) }
}
