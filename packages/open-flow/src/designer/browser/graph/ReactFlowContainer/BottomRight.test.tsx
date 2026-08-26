import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'
import type { Val } from 'value-enhancer'
import type { InteractiveMode } from '../../stores/designer/designer.store.ts'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '../../i18n/index.ts'
import { BottomRight } from './BottomRight.tsx'

const captured = vi.hoisted(() => ({
  buttons: [] as ButtonHTMLAttributes<HTMLButtonElement>[],
  controls: [] as Array<{ readonly className?: string; readonly orientation?: 'horizontal' | 'vertical'; readonly position?: string }>,
  miniMap: undefined as
    | {
        readonly ariaLabel?: string | null
        readonly pannable?: boolean
        readonly position?: string
        readonly zoomable?: boolean
      }
    | undefined,
}))

vi.mock('@xyflow/react', () => ({
  ControlButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => {
    captured.buttons.push(props)
    return (
      <button aria-expanded={props['aria-expanded']} aria-label={props['aria-label']} type="button">
        {props.children}
      </button>
    )
  },
  Controls: ({
    children,
    className,
    orientation,
    position,
  }: HTMLAttributes<HTMLDivElement> & { readonly orientation?: 'horizontal' | 'vertical'; readonly position?: string }) => {
    captured.controls.push({ className, orientation, position })
    return (
      <div data-orientation={orientation} data-position={position}>
        {children}
      </div>
    )
  },
  MiniMap: (props: NonNullable<typeof captured.miniMap>) => {
    captured.miniMap = props
    return <div data-mini-map data-position={props.position} />
  },
}))

function render(interactiveMode$: Val<InteractiveMode>, miniMapExpanded$: Val<boolean | undefined>, showSettings$: Val<boolean>): string {
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <BottomRight interactiveMode$={interactiveMode$} miniMapExpanded$={miniMapExpanded$} showSettings$={showSettings$} />
    </I18nProvider>,
  )
}

describe('BottomRight', () => {
  beforeEach(() => {
    captured.buttons = []
    captured.controls = []
    captured.miniMap = undefined
  })

  it('keeps collapsed canvas commands in React Flow Controls', () => {
    const interactiveMode$ = val<InteractiveMode>('mouse')
    const miniMapExpanded$ = val<boolean | undefined>(false)
    const showSettings$ = val(false)

    const markup = render(interactiveMode$, miniMapExpanded$, showSettings$)

    expect(markup).toContain('data-position="bottom-right"')
    expect(markup).toContain('data-orientation="horizontal"')
    expect(captured.controls[0]).toMatchObject({ orientation: 'horizontal', position: 'bottom-right' })
    expect(captured.controls[0]?.className).toContain('rounded-r-none')
    expect(captured.miniMap).toBeUndefined()
    expect(captured.buttons).toHaveLength(3)
    expect(captured.buttons.every((button) => button.className?.includes('size-8'))).toBe(true)

    captured.buttons[0]?.onClick?.({} as never)
    captured.buttons[1]?.onClick?.({} as never)
    captured.buttons[2]?.onClick?.({} as never)

    expect(interactiveMode$.value).toBe('touchpad')
    expect(miniMapExpanded$.value).toBe(true)
    expect(showSettings$.value).toBe(true)
  })

  it('lets the official MiniMap own its expanded position', () => {
    const interactiveMode$ = val<InteractiveMode>('mouse')
    const miniMapExpanded$ = val<boolean | undefined>(true)
    const showSettings$ = val(false)

    render(interactiveMode$, miniMapExpanded$, showSettings$)

    expect(captured.miniMap).toMatchObject({ ariaLabel: 'Mini map', pannable: true, position: 'bottom-right', zoomable: true })
    expect(captured.buttons).toHaveLength(1)

    captured.buttons[0]?.onClick?.({} as never)
    expect(miniMapExpanded$.value).toBe(false)
  })
})
