import type { FlowCanvasViewAddItem } from './FlowCanvas/model.ts'

export type NodePickerItem = FlowCanvasViewAddItem | { readonly type: 'divider'; readonly label: string }

/** Present the product catalog without converting node or port definitions. */
export function nodePickerItems(items: readonly FlowCanvasViewAddItem[], connectionSide?: 'left' | 'right'): NodePickerItem[] {
  const result: NodePickerItem[] = []
  let group: string | undefined
  for (const item of items) {
    if (item.group != null && group != item.group) {
      group = item.group
      result.push({ type: 'divider', label: group })
    }
    const incompatible = connectionSide != null && (item.type == 'trigger' || (connectionSide == 'left' && (item.type == 'condition' || item.type == 'wait')))
    result.push(incompatible && !item.disabled ? { ...item, disabled: true } : item)
  }
  return result
}
