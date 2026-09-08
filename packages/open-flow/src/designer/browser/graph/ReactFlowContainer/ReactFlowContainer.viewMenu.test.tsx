import type { ButtonHTMLAttributes, HTMLAttributes, ReactElement } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../../i18n/index.ts'
import { CanvasViewMenu } from './ReactFlowContainer.tsx'

const captured = vi.hoisted(() => ({ items: [] as ButtonHTMLAttributes<HTMLButtonElement>[] }))

vi.mock('../../../../ui/browser/dropdown-menu.tsx', () => ({
  DropdownMenu: ({ children }: HTMLAttributes<HTMLDivElement>) => <>{children}</>,
  DropdownMenuContent: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DropdownMenuItem: (props: ButtonHTMLAttributes<HTMLButtonElement>) => {
    captured.items.push(props)
    return <button type="button">{props.children}</button>
  },
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ render: trigger }: { readonly render: ReactElement }) => trigger,
}))

describe('CanvasViewMenu', () => {
  it('exposes working layout, interaction, and settings commands', () => {
    captured.items = []
    const interactiveMode$ = val<'mouse' | 'touchpad'>('mouse')
    const showSettings$ = val(false)
    const onRelayout = vi.fn()

    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <CanvasViewMenu interactiveMode$={interactiveMode$} onRelayout={onRelayout} showSettings$={showSettings$} />
      </I18nProvider>,
    )

    expect(markup).toContain('View')
    expect(captured.items).toHaveLength(4)

    captured.items[0]?.onClick?.({} as never)
    captured.items[2]?.onClick?.({} as never)
    captured.items[3]?.onClick?.({} as never)

    expect(onRelayout).toHaveBeenCalledOnce()
    expect(interactiveMode$.value).toBe('touchpad')
    expect(showSettings$.value).toBe(true)
  })
})
