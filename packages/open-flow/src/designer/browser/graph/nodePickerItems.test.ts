import type { FlowDesignerViewAddItem } from './FlowDesigner/model.ts'

import { describe, expect, it } from 'vitest'
import { filterCollectionItems } from '../../../ui/browser/collectionSearch.ts'
import { nodePickerItems } from './nodePickerItems.ts'

const catalog: readonly FlowDesignerViewAddItem[] = [
  { id: 'task', type: 'block', label: 'Task', description: 'Fetch records', group: 'Blocks', inputs: [], outputs: [] },
  { id: 'condition', type: 'condition', label: 'Condition', group: 'Blocks', inputs: [], outputs: [] },
  { id: 'wait', type: 'wait', label: 'Wait', group: 'Blocks', inputs: [], outputs: [] },
  { id: 'manual', type: 'trigger', label: 'Manual', group: 'Triggers', inputs: [], outputs: [] },
  { id: 'mail', type: 'connector', label: 'Mail', inputs: [], outputs: [], choices: [{ id: 'mail.send', label: 'Send' }] },
]

describe('canvas node catalog', () => {
  it('keeps the product choices and ports intact and searches product descriptions', () => {
    const rows = nodePickerItems(catalog)
    expect(rows.find((item) => item.type == 'connector')).toBe(catalog[4])
    expect(filterCollectionItems('records', rows).map((item) => item.label)).toEqual(['Blocks', 'Task'])
  })

  it('keeps incompatible execution targets visible but disabled without mutating the catalog', () => {
    for (const side of ['left', 'right'] as const) {
      const disabled = nodePickerItems(catalog, side)
        .filter((item) => item.type != 'divider' && item.disabled)
        .map((item) => item.label)
      expect(disabled).toEqual(side == 'left' ? ['Condition', 'Wait', 'Manual'] : ['Manual'])
    }
    expect(catalog.every((item) => !item.disabled)).toBe(true)
  })
})
