import { dequal } from 'dequal/lite'

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
