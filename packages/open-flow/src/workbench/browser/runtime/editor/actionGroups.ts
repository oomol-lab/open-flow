import type { AddNodeOption } from './addNodeOptions.ts'

const actionGroupTypes = ['read', 'write', 'destructive', 'other'] as const
export type ActionGroupType = (typeof actionGroupTypes)[number]
type ActionOption = Extract<AddNodeOption, { kind: 'connector' }>

export function groupActionOptions(items: readonly AddNodeOption[]) {
  const groups: Record<ActionGroupType, ActionOption[]> = { read: [], write: [], destructive: [], other: [] }
  for (const item of items) {
    if (item.kind != 'connector') continue
    const operation = item.connector.operationType
    const type = operation == 'read' || operation == 'write' || operation == 'destructive' ? operation : 'other'
    groups[type].push(item)
  }
  return actionGroupTypes.filter((type) => groups[type].length > 0).map((type) => ({ type, items: groups[type] }))
}
