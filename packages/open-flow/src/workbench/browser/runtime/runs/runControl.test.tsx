import type { ButtonHTMLAttributes, HTMLAttributes, ReactElement } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { I18nProvider } from 'val-i18n-react'
import { describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n.ts'
import { RunControl } from './runControl.tsx'

const captured = vi.hoisted(() => ({
  items: [] as ButtonHTMLAttributes<HTMLButtonElement>[],
  onValueChange: undefined as ((value: string) => void) | undefined,
}))

vi.mock('../../../../ui/browser/dropdown-menu.tsx', async () => {
  const { createContext, useContext } = await import('react')
  const MenuGroupContext = createContext(false)

  return {
    DropdownMenu: ({ children }: HTMLAttributes<HTMLDivElement>) => <>{children}</>,
    DropdownMenuContent: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
    DropdownMenuGroup: ({ children }: HTMLAttributes<HTMLDivElement>) => <MenuGroupContext.Provider value>{children}</MenuGroupContext.Provider>,
    DropdownMenuRadioGroup: ({ children, onValueChange }: HTMLAttributes<HTMLDivElement> & { onValueChange: (value: string) => void }) => {
      captured.onValueChange = onValueChange
      return <div>{children}</div>
    },
    DropdownMenuRadioItem: (props: ButtonHTMLAttributes<HTMLButtonElement>) => {
      captured.items.push(props)
      return <div>{props.children}</div>
    },
    DropdownMenuLabel: ({ children }: HTMLAttributes<HTMLDivElement>) => {
      if (!useContext(MenuGroupContext)) throw new Error('Dropdown menu label must be inside a group.')
      return <div>{children}</div>
    },
    DropdownMenuTrigger: ({ render }: { readonly render: ReactElement }) => render,
  }
})

describe('RunControl', () => {
  it('groups the trigger label and switches the selected trigger', () => {
    captured.items = []
    const onSelectTrigger = vi.fn()

    const markup = renderToStaticMarkup(
      <I18nProvider i18n={createI18n('en')}>
        <RunControl
          disabled={false}
          inputOpen={false}
          inputStatus="none"
          onInputOpenChange={() => undefined}
          onRun={() => undefined}
          onSelectTrigger={onSelectTrigger}
          selectedTriggerId="manual"
          starting={false}
          triggers={[
            { id: 'manual', title: 'Manual' },
            { id: 'cron', title: 'Schedule' },
          ]}
        />
      </I18nProvider>,
    )

    expect(markup).toContain('Start node')
    expect(captured.items).toHaveLength(2)

    expect(captured.items[1]?.value).toBe('cron')
    captured.onValueChange?.('cron')
    expect(onSelectTrigger).toHaveBeenCalledWith('cron')
  })
})
