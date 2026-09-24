import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'
import type { Val } from 'value-enhancer'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '../../i18n/index.ts'
import { CanvasMiniMap } from './CanvasMiniMap.tsx'
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
  Panel: ({ children, className, position }: HTMLAttributes<HTMLDivElement> & { readonly position?: string }) => (
    <div className={className} data-position={position}>
      {children}
    </div>
  ),
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

function render(miniMapExpanded$: Val<boolean | undefined>): string {
  return renderToStaticMarkup(
    <I18nProvider i18n={createI18n('en')}>
      <CanvasMiniMap miniMapExpanded$={miniMapExpanded$} />
    </I18nProvider>,
  )
}

describe('CornerControls', () => {
  beforeEach(() => {
    captured.buttons = []
    captured.controls = []
    captured.miniMap = undefined
  })

  it('shows the navigable MiniMap only when enabled', () => {
    const expanded = val<boolean | undefined>(false)
    render(expanded)
    expect(captured.miniMap).toBeUndefined()
    expanded.set(true)
    render(expanded)
    expect(captured.miniMap).toMatchObject({ ariaLabel: 'Mini map', pannable: true, position: 'bottom-left', zoomable: true })
  })

  it('keeps publication and host tools in the top-right corner', () => {
    const markup = renderToStaticMarkup(
      <CornerControls before={<button type="button">Publish</button>}>
        <button type="button">Inspector</button>
      </CornerControls>,
    )
    expect(markup.indexOf('Publish')).toBeLessThan(markup.indexOf('Inspector'))
    expect(markup).toContain('data-position="top-right"')
  })
})
