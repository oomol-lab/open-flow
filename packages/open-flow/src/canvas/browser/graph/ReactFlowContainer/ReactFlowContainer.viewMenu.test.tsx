import type { ButtonHTMLAttributes, HTMLAttributes, ReactElement } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../../i18n/index.ts'
import { CanvasInteractiveMode, CanvasViewControls } from './CanvasControls.tsx'

const captured = vi.hoisted(() => ({ buttons: [] as ButtonHTMLAttributes<HTMLButtonElement>[] }))

vi.mock('../../../../ui/browser/button.tsx', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => {
    captured.buttons.push(props)
    return (
      <button aria-checked={props['aria-checked']} aria-label={props['aria-label']} role={props.role} type="button">
        {props.children}
      </button>
    )
  },
}))

vi.mock('../../../../ui/browser/popover.tsx', () => ({
  Popover: ({ children }: HTMLAttributes<HTMLDivElement>) => <>{children}</>,
  PopoverContent: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  PopoverTitle: ({ children }: HTMLAttributes<HTMLHeadingElement>) => <h2>{children}</h2>,
  PopoverTrigger: ({ render: trigger }: { readonly render: ReactElement }) => trigger,
}))

describe('CanvasInteractiveMode', () => {
  it('shows both interaction choices and updates the selected mode', () => {
    captured.buttons = []
    const interactiveMode$ = val<'mouse' | 'touchpad'>('mouse')

    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <CanvasInteractiveMode interactiveMode$={interactiveMode$} />
      </I18nProvider>,
    )

    expect(markup).toContain('Interactive')
    expect(markup).toContain('Mouse-friendly')
    expect(markup).toContain('Touchpad-friendly')

    const touchpad = captured.buttons.find((button) => button.role == 'radio' && button['aria-checked'] === false)
    touchpad?.onClick?.({} as never)
    expect(interactiveMode$.value).toBe('touchpad')
  })
})

describe('CanvasViewControls', () => {
  it('renders the production view actions in order and invokes their callbacks', () => {
    captured.buttons = []
    const onFitView = vi.fn()
    const onRelayout = vi.fn()

    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <CanvasViewControls
          maxZoomReached={false}
          minZoomReached={false}
          onFitView={onFitView}
          onRelayout={onRelayout}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onZoomReset={vi.fn()}
          zoom={1}
        />
      </I18nProvider>,
    )

    const fitView = captured.buttons.findIndex((button) => button['aria-label'] == 'fit view')
    const relayout = captured.buttons.findIndex((button) => button['aria-label'] == 'optimize layout')
    expect(markup).toContain('100%')
    expect(fitView).toBeGreaterThan(-1)
    expect(relayout).toBeGreaterThan(fitView)

    captured.buttons[fitView]?.onClick?.({} as never)
    captured.buttons[relayout]?.onClick?.({} as never)
    expect(onFitView).toHaveBeenCalledOnce()
    expect(onRelayout).toHaveBeenCalledOnce()
  })
})
