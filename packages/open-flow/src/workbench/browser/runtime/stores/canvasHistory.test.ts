import type { CanvasHistoryEntry } from './canvasHistory.ts'

import { describe, expect, it } from 'vitest'
import { CanvasHistory } from './canvasHistory.ts'

const entry: CanvasHistoryEntry = {
  action: 'move',
  count: 1,
  target: { kind: 'flow' },
  forward: [],
  inverse: [],
  beforeSelection: [],
  afterSelection: [],
  presentation: { before: {}, after: {}, nodeIds: [], beforeOrder: [], afterOrder: [] },
}
describe('canvas history limits', () => {
  it('retains 30 steps, moves entries between stacks, and discards redo on a new action', () => {
    const history = new CanvasHistory()
    for (let i = 0; i < 35; i++) history.record({ ...entry, count: i })
    for (let i = 34; i >= 5; i--) {
      expect(history.state$.value.undo?.count).toBe(i)
      history.complete(false)
    }
    expect(history.state$.value.canUndo).toBe(false)
    expect(history.state$.value.canRedo).toBe(true)
    history.record(entry)
    expect(history.state$.value.canRedo).toBe(false)
  })
  it('accounts for UTF-8 bytes and refuses an oversized action', () => {
    const history = new CanvasHistory()
    history.record(entry)
    const generation = history.generation
    expect(history.record({ ...entry, beforeSelection: ['字'.repeat(4 * 1024 * 1024)] })).toBe(false)
    expect(history.generation).toBeGreaterThan(generation)
    expect(history.state$.value.canUndo).toBe(false)
  })
  it('evicts older entries under the total byte limit and blocks pending operations', () => {
    const history = new CanvasHistory()
    history.record({ ...entry, count: 1, beforeSelection: ['a'.repeat(6 * 1024 * 1024)] })
    history.record({ ...entry, count: 2, beforeSelection: ['a'.repeat(6 * 1024 * 1024)] })
    history.pending++
    history.publish()
    expect(history.state$.value.canUndo).toBe(false)
    history.pending--
    history.complete(false)
    expect(history.state$.value.canUndo).toBe(false)
    expect(history.state$.value.redo?.count).toBe(2)
  })
})
