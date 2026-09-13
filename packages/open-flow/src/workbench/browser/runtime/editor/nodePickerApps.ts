import type { ConnectorConnection } from '../api.ts'

const collator = new Intl.Collator(['zh-CN', 'en'], { numeric: true, sensitivity: 'base' })
const han = /\p{Script=Han}/u

// Lower values come first: connected, built-in account, no setup, unconfigured.
export function pickerConnectionPriorities(connections: readonly ConnectorConnection[]): ReadonlyMap<string, number> {
  const priorities = new Map<string, number>()
  for (const connection of connections) {
    if (connection.status != 'active') continue
    const priority = connection.connectionId.startsWith('no_auth:') ? 2 : connection.builtInAccount ? 1 : 0
    priorities.set(connection.serviceId, Math.min(priorities.get(connection.serviceId) ?? 3, priority))
  }
  return priorities
}

export function comparePickerApps(left: { label: string; priority?: number }, right: { label: string; priority?: number }): number {
  return (
    (left.priority ?? 3) - (right.priority ?? 3) || Number(han.test(right.label)) - Number(han.test(left.label)) || collator.compare(left.label, right.label)
  )
}
