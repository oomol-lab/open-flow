export const delayUnits = { second: 1000, minute: 60_000, hour: 3_600_000 } as const
export type DelayUnit = keyof typeof delayUnits

export function displayDelay(durationMs: number | null): { value: string; unit: DelayUnit } {
  const unit =
    durationMs != null && durationMs > 0 && durationMs % delayUnits.hour === 0
      ? 'hour'
      : durationMs != null && durationMs > 0 && durationMs % delayUnits.minute === 0
        ? 'minute'
        : 'second'
  return { value: durationMs == null ? '' : String(durationMs / delayUnits[unit]), unit }
}

export function delayMilliseconds(value: string, unit: DelayUnit): number | null {
  if (value.trim() === '') return null
  const ms = Number(value) * delayUnits[unit]
  if (!Number.isFinite(ms)) return null
  const rounded = Math.round(ms)
  return Math.abs(ms - rounded) <= Number.EPSILON * Math.max(1, Math.abs(ms)) ? rounded : ms
}
