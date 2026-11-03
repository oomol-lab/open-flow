// @vitest-environment happy-dom
import type { ComponentProps, ReactNode } from 'react'

import { ReactFlowProvider } from '@xyflow/react'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { click, render } from '../../../../../test/support/render.tsx'
import { TooltipProvider } from '../../../../ui/browser/tooltip.tsx'
import { createI18n } from '../../i18n/index.ts'
import { CanvasInteractiveMode, CanvasViewControls } from './CanvasControls.tsx'

function wrap(children: ReactNode) {
  return (
    <ReactFlowProvider>
      <I18nProvider i18n={createI18n('en')}>
        <TooltipProvider>{children}</TooltipProvider>
      </I18nProvider>
    </ReactFlowProvider>
  )
}

function controls(props: Partial<ComponentProps<typeof CanvasViewControls>> = {}) {
  return wrap(
    <CanvasViewControls
      maxZoomReached={false}
      minZoomReached={false}
      onFitView={vi.fn()}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      onZoomReset={vi.fn()}
      zoom={1}
      {...props}
    />,
  )
}

function button(label: string) {
  return document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!
}

function radio(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find((element) => element.textContent?.includes(label))!
}

describe('CanvasInteractiveMode', () => {
  it('shows both interaction choices and updates the selected mode', async () => {
    const interactiveMode$ = val<'mouse' | 'touchpad'>('mouse')
    render(wrap(<CanvasInteractiveMode interactiveMode$={interactiveMode$} />))

    await click(button('Interactive'))
    expect(radio('Mouse-friendly').getAttribute('aria-checked')).toBe('true')
    expect(radio('Touchpad-friendly').getAttribute('aria-checked')).toBe('false')

    await click(radio('Touchpad-friendly'))
    expect(interactiveMode$.value).toBe('touchpad')
    expect(button('Interactive').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('CanvasViewControls', () => {
  it('keeps fit view available beside the view menu', async () => {
    const onFitView = vi.fn()
    const onRelayout = vi.fn()
    const mounted = render(controls({ onFitView, onRelayout }))

    expect(mounted.container.textContent).toContain('100%')
    expect(button('fit view')).not.toBeNull()
    expect(button('View')).not.toBeNull()

    await click(button('fit view'))
    expect(onFitView).toHaveBeenCalledOnce()
    expect(onRelayout).not.toHaveBeenCalled()
  })

  it.each([
    ['vertical', 'Vertical', 'Horizontal', 'horizontal'],
    ['horizontal', 'Horizontal', 'Vertical', 'vertical'],
  ] as const)('shows the current %s direction and changes only after a choice', async (direction, current, next, expected) => {
    const onChangeDirection = vi.fn()
    render(controls({ direction, onChangeDirection }))

    await click(button('View'))
    await click(button('Layout direction'))
    expect(onChangeDirection).not.toHaveBeenCalled()
    expect(radio(current).getAttribute('aria-checked')).toBe('true')
    expect(radio(next).getAttribute('aria-checked')).toBe('false')

    await click(radio(next))
    expect(onChangeDirection).toHaveBeenCalledExactlyOnceWith(expected)
    expect(button('Layout direction').getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the picker without relayout when choosing the current direction', async () => {
    const onChangeDirection = vi.fn()
    render(controls({ direction: 'vertical', onChangeDirection }))

    await click(button('View'))
    await click(button('Layout direction'))
    await click(radio('Vertical'))

    expect(onChangeDirection).not.toHaveBeenCalled()
    expect(button('Layout direction').getAttribute('aria-expanded')).toBe('false')
  })

  it('disables the trigger and choices while a direction change is pending', async () => {
    const onChangeDirection = vi.fn()
    const mounted = render(controls({ direction: 'vertical', onChangeDirection }))
    await click(button('View'))
    await click(button('Layout direction'))

    mounted.rerender(controls({ direction: 'vertical', onChangeDirection, changingDirection: true }))
    expect(button('Layout direction').disabled).toBe(true)
    expect(radio('Vertical').disabled).toBe(true)
    expect(radio('Horizontal').disabled).toBe(true)
    await click(radio('Horizontal'))
    expect(onChangeDirection).not.toHaveBeenCalled()
  })
})
