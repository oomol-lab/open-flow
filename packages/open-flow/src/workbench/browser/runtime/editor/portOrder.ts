import type { Group, InputPort } from '../api.ts'

/** Reordering a field preserves its group and the identities used by values and edges. */
export function movePort(values: readonly (InputPort | Group)[], from: number, to: number): readonly (InputPort | Group)[] {
  if (from === to || from < 0 || to < 0 || from >= values.length || to >= values.length) return values
  if (!('handle' in values[from]!) || !('handle' in values[to]!)) return values
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  if (values.slice(start, end + 1).some((entry) => 'group' in entry)) return values
  const next = [...values]
  next.splice(to, 0, next.splice(from, 1)[0]!)
  return next
}
