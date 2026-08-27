import { describe, expect, test, vi } from 'vitest'
import { cycleContextPanelFocus, observeContextPanelOverlay, observeElementWidth } from './contextPanelBehavior.ts'

function focusTarget() {
  return { focus: vi.fn<() => void>() }
}

describe('Context Panel overlay behavior', () => {
  test('tracks initial and observed container widths without duplicate state updates', () => {
    let notifyWidth: ((width: number) => void) | undefined
    const disconnect = vi.fn()
    const root = {
      getBoundingClientRect: () => ({ width: 1200 }),
    } as HTMLElement
    const changes: boolean[] = []

    const cleanup = observeContextPanelOverlay(
      root,
      (overlay) => changes.push(overlay),
      (_element, onWidth) => {
        notifyWidth = onWidth
        return disconnect
      },
    )

    expect(changes).toEqual([false])
    notifyWidth?.(721)
    notifyWidth?.(720)
    notifyWidth?.(721)
    expect(changes).toEqual([false, true, false])
    cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  test('keeps the initial measurement when ResizeObserver is unavailable', () => {
    const root = {
      getBoundingClientRect: () => ({ width: 720 }),
    } as HTMLElement
    const changes: boolean[] = []

    const cleanup = observeContextPanelOverlay(
      root,
      (overlay) => changes.push(overlay),
      () => () => undefined,
    )

    expect(changes).toEqual([true])
    expect(() => cleanup()).not.toThrow()
  })

  test('observes with the supplied constructor and disconnects cleanly', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    let notify: ResizeObserverCallback | undefined
    class FakeResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notify = callback
      }

      observe = observe
      disconnect = disconnect
    }
    const element = {} as Element
    const widths: number[] = []

    const cleanup = observeElementWidth(element, (width) => widths.push(width), FakeResizeObserver as unknown as typeof ResizeObserver)
    expect(observe).toHaveBeenCalledWith(element)
    notify?.([{ contentRect: { width: 640 } } as ResizeObserverEntry], {} as ResizeObserver)
    expect(widths).toEqual([640])
    cleanup()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  test('does not fail when no ResizeObserver constructor exists', () => {
    const cleanup = observeElementWidth({} as Element, vi.fn(), null)
    expect(() => cleanup()).not.toThrow()
  })
})

describe('Context Panel focus loop', () => {
  test('wraps forward from the panel and the last focus target', () => {
    const panel = focusTarget()
    const first = focusTarget()
    const last = focusTarget()

    expect(cycleContextPanelFocus(panel, [first, last], panel, false)).toBe(true)
    expect(cycleContextPanelFocus(panel, [first, last], last, false)).toBe(true)
    expect(first.focus).toHaveBeenCalledTimes(2)
  })

  test('wraps backward from the panel and the first focus target', () => {
    const panel = focusTarget()
    const first = focusTarget()
    const last = focusTarget()

    expect(cycleContextPanelFocus(panel, [first, last], panel, true)).toBe(true)
    expect(cycleContextPanelFocus(panel, [first, last], first, true)).toBe(true)
    expect(last.focus).toHaveBeenCalledTimes(2)
  })

  test('does not intercept focus movement within the panel', () => {
    const panel = focusTarget()
    const first = focusTarget()
    const middle = focusTarget()
    const last = focusTarget()

    expect(cycleContextPanelFocus(panel, [first, middle, last], middle, false)).toBe(false)
    expect(cycleContextPanelFocus(panel, [first, middle, last], middle, true)).toBe(false)
    expect(first.focus).not.toHaveBeenCalled()
    expect(last.focus).not.toHaveBeenCalled()
  })

  test('keeps focus on the panel when it has no focusable descendants', () => {
    const panel = focusTarget()

    expect(cycleContextPanelFocus(panel, [], null, false)).toBe(true)
    expect(panel.focus).toHaveBeenCalledOnce()
  })
})
