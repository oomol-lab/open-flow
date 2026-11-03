// @vitest-environment happy-dom
import type { ComponentProps } from 'react'

import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { render } from '../../../../../../test/support/render.tsx'
import { TooltipProvider } from '../../../../../ui/browser/tooltip.tsx'
import { NodeResizeHandle } from './NodeResizeHandle.tsx'

vi.mock('@xyflow/react', () => ({ useStoreApi: () => ({ getState: () => ({ transform: [0, 0, 0.5] }) }) }))

function setup(overrides: Partial<ComponentProps<typeof NodeResizeHandle>> = {}) {
  const onStart = vi.fn()
  const onResize = vi.fn()
  const onCommit = vi.fn()
  const onCancel = vi.fn()
  const mounted = render(
    <TooltipProvider>
      <NodeResizeHandle
        className="resize"
        label="Resize"
        position="right"
        size={{ width: 500, height: 200 }}
        minimum={{ width: 320, height: 160 }}
        onStart={onStart}
        onResize={onResize}
        onCommit={onCommit}
        onCancel={onCancel}
        {...overrides}
      />
    </TooltipProvider>,
  )
  const button = mounted.container.querySelector('button')!
  let capture = false
  Object.assign(button, {
    setPointerCapture: () => {
      capture = true
    },
    hasPointerCapture: () => capture,
    releasePointerCapture: () => {
      capture = false
      button.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true }))
    },
  })
  const pointer = (type: string, x: number, y = 0) =>
    act(() => {
      button.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, bubbles: true, button: 0, clientX: x, clientY: y }))
    })
  return { ...mounted, button, pointer, onStart, onResize, onCommit, onCancel }
}

it('converts screen distance to canvas width and commits a drag once', () => {
  const { pointer, onResize, onCommit, onCancel } = setup({ showTooltip: false })
  pointer('pointerdown', 100)
  pointer('pointermove', 120)
  pointer('pointermove', 140)
  expect(onResize).toHaveBeenLastCalledWith({ width: 580, height: 200, offsetX: 0 })
  expect(onCommit).not.toHaveBeenCalled()
  pointer('pointerup', 140)
  expect(onCommit).toHaveBeenCalledExactlyOnceWith({ width: 580, height: 200, offsetX: 0 })
  expect(onCancel).not.toHaveBeenCalled()
})

it('keeps the right edge fixed when resizing from the left and clamps to the minimum', () => {
  const { pointer, onResize, onCommit } = setup({ position: 'left' })
  pointer('pointerdown', 100)
  pointer('pointermove', 300)
  expect(onResize).toHaveBeenLastCalledWith({ width: 320, height: 200, offsetX: 180 })
  pointer('pointerup', 300)
  expect(onCommit).toHaveBeenCalledExactlyOnceWith({ width: 320, height: 200, offsetX: 180 })
})

it('shares two-axis resizing with Comment and supports keyboard steps', () => {
  const { pointer, button, onResize, onCommit } = setup({ position: 'bottom-right' })
  pointer('pointerdown', 100, 100)
  pointer('pointermove', 120, 130)
  pointer('pointerup', 120, 130)
  expect(onCommit).toHaveBeenLastCalledWith({ width: 540, height: 260, offsetX: 0 })
  act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true })))
  expect(onResize).toHaveBeenLastCalledWith({ width: 500, height: 240, offsetX: 0 })
})

it('cancels an interrupted resize without committing', () => {
  const { pointer, onCancel, onCommit, unmount } = setup()
  pointer('pointerdown', 100)
  pointer('pointermove', 120)
  unmount()
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(onCommit).not.toHaveBeenCalled()
})
