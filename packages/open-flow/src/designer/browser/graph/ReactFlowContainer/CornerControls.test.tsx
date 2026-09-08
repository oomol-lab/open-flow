import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import type { Val } from 'value-enhancer'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '../../i18n/index.ts'
import { CornerControls } from './CornerControls.tsx'

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

vi.mock('../../../../ui/browser/button.tsx', () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => {
    captured.buttons.push(props)
    return (
      <button aria-expanded={props['aria-expanded']} aria-label={props['aria-label']} type="button">
        {props.children}
      </button>
    )
  },
}))

function render(miniMapExpanded$: Val<boolean | undefined>, children?: ReactNode): string {
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <CornerControls miniMapExpanded$={miniMapExpanded$}>{children}</CornerControls>
    </I18nProvider>,
  )
}

describe('CornerControls', () => {
  beforeEach(() => {
    captured.buttons = []
    captured.controls = []
    captured.miniMap = undefined
  })

  it('keeps the collapsed MiniMap control in the top-right corner', () => {
    const miniMapExpanded$ = val<boolean | undefined>(false)

    const markup = render(miniMapExpanded$)

    expect(captured.miniMap).toBeUndefined()
    expect(captured.controls).toContainEqual(expect.objectContaining({ position: 'top-right' }))
    expect(captured.buttons).toHaveLength(1)
    expect(markup).toContain('data-icon="mini-map-open"')

    captured.buttons[0]?.onClick?.({} as never)

    expect(miniMapExpanded$.value).toBe(true)
  })

  it('keeps the expanded MiniMap below its top-right control', () => {
    const miniMapExpanded$ = val<boolean | undefined>(true)

    const markup = render(miniMapExpanded$)

    expect(captured.miniMap).toMatchObject({ ariaLabel: 'Mini map', pannable: true, position: 'top-right', zoomable: true })
    expect(captured.controls).toContainEqual(expect.objectContaining({ position: 'top-right' }))
    expect(captured.buttons).toHaveLength(1)
    expect(markup).toContain('data-icon="mini-map-close"')

    captured.buttons[0]?.onClick?.({} as never)
    expect(miniMapExpanded$.value).toBe(false)
  })

  it('places host tools after the MiniMap button in the same control group', () => {
    const markup = render(val<boolean | undefined>(false), <button aria-label="Inspector" type="button" />)

    expect(captured.controls).toHaveLength(1)
    expect(markup.indexOf('Mini map')).toBeLessThan(markup.indexOf('Inspector'))
  })
})
