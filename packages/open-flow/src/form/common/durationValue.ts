import { objectValue, valueType } from './value.ts'

export const durationUnits = { second: 1000, minute: 60_000, hour: 3_600_000 } as const
export type DurationUnit = keyof typeof durationUnits

export function isDurationInput(schema: unknown, value: unknown): boolean {
  const type = valueType(schema, value)
  return objectValue(schema)?.['ui:widget'] === 'duration' && (type === 'number' || type === 'integer') && typeof value === 'number'
}

export function durationDraft(durationMs: number | null): { value: string; unit: DurationUnit } {
  const unit =
    durationMs != null && durationMs > 0 && durationMs % durationUnits.hour === 0
      ? 'hour'
      : durationMs != null && durationMs > 0 && durationMs % durationUnits.minute === 0
        ? 'minute'
        : 'second'
  return { value: durationMs == null ? '' : String(durationMs / durationUnits[unit]), unit }
}

export function durationMilliseconds(value: string, unit: DurationUnit): number | null {
  if (value.trim() === '') return null
  const ms = Number(value) * durationUnits[unit]
  if (!Number.isFinite(ms)) return null
  const rounded = Math.round(ms)
  return Math.abs(ms - rounded) <= Number.EPSILON * Math.max(1, Math.abs(ms)) ? rounded : ms
}
