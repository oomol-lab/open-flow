import { describe, expect, it } from 'vitest'
import {
  canvasPresentationChange,
  flowPresentation,
  restoreCanvasPresentation,
  savedDirection,
  savedPositions,
  savedVerticalNodeWidths,
  setCanvasLayout,
  setComment,
  setFlowViewport,
  setNodeContentHidden,
  setNodePositions,
  setVerticalNodeWidth,
} from './canvasPresentation.ts'

describe('canvas layout presentation', () => {
  it('preserves vertical widths across layout, navigation and position changes and restores them through history', () => {
    const original = setCanvasLayout({ host: 'keep' }, 'vertical', { condition: { x: 100, y: 200 } })
    const widened = setVerticalNodeWidth(original, 'condition', 700)
    const change = canvasPresentationChange(original, widened)
    const horizontal = setCanvasLayout(widened, 'horizontal', { condition: { x: 300, y: 0 } })
    expect(savedVerticalNodeWidths(horizontal)).toEqual({ condition: 700 })
    expect(savedVerticalNodeWidths(setCanvasLayout(horizontal, 'vertical'))).toEqual({ condition: 700 })
    const navigated = setFlowViewport(widened, { x: 500, y: 300, zoom: 0.7 })
    const undone = restoreCanvasPresentation(navigated, change, false)
    expect(savedVerticalNodeWidths(undone)).toEqual({})
    expect(flowPresentation(undone)?.viewport).toEqual({ x: 500, y: 300, zoom: 0.7 })
    expect(savedVerticalNodeWidths(restoreCanvasPresentation(undone, change, true))).toEqual({ condition: 700 })
    expect(setVerticalNodeWidth(widened, 'condition', 700)).toBe(widened)
    expect(savedVerticalNodeWidths(setVerticalNodeWidth(widened, 'condition', undefined))).toEqual({})
  })

  it('ignores malformed width preferences and rejects invalid writes', () => {
    expect(savedVerticalNodeWidths({ designer: { version: 1, flow: { verticalNodeWidths: { a: -5, b: '600', c: null, d: 600 } } } })).toEqual({ d: 600 })
    expect(() => setVerticalNodeWidth({}, 'condition', Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => setVerticalNodeWidth({}, 'condition', 0)).toThrow(RangeError)
  })
  it('reads omitted and empty legacy directions as horizontal', () => {
    expect(savedDirection({})).toBe('horizontal')
    expect(savedDirection({ designer: { version: 1, flow: { direction: null } } })).toBe('horizontal')
    expect(savedDirection(setCanvasLayout({}, 'vertical'))).toBe('vertical')
  })

  it('preserves direction and unrelated metadata through other presentation edits', () => {
    const original = { host: 'keep', designer: { version: 1, extension: 'keep', flow: { extra: 'keep' } } }
    let value = setCanvasLayout(original, 'vertical', { task: { x: 100, y: 200 } })
    value = setComment(value, 'note', { title: 'Note', content: 'Keep this', position: { x: 0, y: 0 } })
    value = setNodeContentHidden(value, 'task', true)
    value = setFlowViewport(value, { x: 20, y: 30, zoom: 0.5 })
    value = setNodePositions(value, { task: { x: 120, y: 240 } })
    expect(savedDirection(value)).toBe('vertical')
    expect(value).toMatchObject({ host: 'keep', designer: { extension: 'keep', flow: { extra: 'keep' } } })
    expect(savedPositions(value).task).toEqual({ x: 120, y: 240 })
  })

  it('restores direction-only changes on empty canvases without restoring viewport navigation', () => {
    const before = { designer: { version: 1, flow: { direction: null } } }
    const after = setCanvasLayout(before, 'vertical')
    const change = canvasPresentationChange(before, after)
    expect(change.nodeIds).toEqual([])
    expect(change.directionChanged).toBe(true)
    const navigated = setFlowViewport(after, { x: 250, y: 500, zoom: 0.4 })
    const undone = restoreCanvasPresentation(navigated, change, false)
    expect(flowPresentation(undone)?.direction).toBeNull()
    expect(flowPresentation(undone)?.viewport).toEqual({ x: 250, y: 500, zoom: 0.4 })
    expect(savedDirection(restoreCanvasPresentation(undone, change, true))).toBe('vertical')
    const absent = canvasPresentationChange({}, setCanvasLayout({}, 'vertical'))
    expect(flowPresentation(restoreCanvasPresentation(after, absent, false))).not.toHaveProperty('direction')
  })
})
