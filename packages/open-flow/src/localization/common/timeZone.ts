/** Validate a named timezone using the same runtime data used for date conversion. */
export function isTimeZone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function timeZoneOffsetMinutes(timezone: string, at: Date = new Date()): number | undefined {
  try {
    const offset = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((part) => part.type === 'timeZoneName')?.value
    if (offset == null) return
    if (offset === 'GMT') return 0
    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset)
    if (match == null) return
    const minutes = Number(match[2]) * 60 + Number(match[3])
    return match[1] === '-' ? -minutes : minutes
  } catch {
    return
  }
}
