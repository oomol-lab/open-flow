import type { ReactElement } from 'react'

import { useState } from 'react'
import { Button } from '../../../../ui/browser/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../../../../ui/browser/dropdown-menu.tsx'
import { Icon } from '../icons.tsx'

export function HostMenu({ action, onAction, title }: { readonly action: string; readonly onAction: () => void; readonly title: string }): ReactElement {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setRoot}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={action}
          render={
            <Button size="icon" title={action} variant="ghost">
              <Icon name="more" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-40" container={root} side="bottom">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{title}</DropdownMenuLabel>
            <DropdownMenuItem onClick={onAction} variant="destructive">
              {action}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
