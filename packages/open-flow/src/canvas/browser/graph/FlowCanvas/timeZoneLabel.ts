import type { TFunction } from 'val-i18n'

// Use the same IANA-keyed translations as the Studio selector, with one city per label.
export function timeZoneLabel(timezone: string, t: TFunction): string {
  let canonical: string
  try {
    canonical = new Intl.DateTimeFormat('en', { timeZone: timezone }).resolvedOptions().timeZone
  } catch {
    return timezone
  }
  if (canonical === 'UTC') return 'UTC'
  const aliases: Record<string, string> = {
    'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
    'Asia/Calcutta': 'Asia/Kolkata',
  }
  for (const zone of [timezone, aliases[canonical] ?? canonical]) {
    const key = `timeZoneNames.${zone}`
    const label = t(key)
    if (label !== key) return label
  }
  // Preserve the Etc/GMT sign convention instead of turning it into a misleading UTC offset.
  if (canonical.startsWith('Etc/')) return canonical
  return (canonical.split('/').at(-1) ?? canonical).replaceAll('_', ' ')
}
