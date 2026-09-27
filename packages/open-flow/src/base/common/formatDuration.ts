export function formatDuration(elapsed: number): string {
  let milliseconds = Math.max(0, elapsed)
  const parts: string[] = []
  for (const [unit, size] of [
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1000],
    ['ms', 1],
  ] as const) {
    const amount = Math.floor(milliseconds / size)
    if (amount > 0) parts.push(`${amount}${unit}`)
    milliseconds %= size
    if (parts.length === 2) break
  }
  return parts.join(' ') || '0ms'
}
