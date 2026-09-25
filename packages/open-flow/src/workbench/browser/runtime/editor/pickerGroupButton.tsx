import type { MouseEventHandler, ReactNode } from 'react'

import { Button } from '../../../../ui/browser/button.tsx'

export function PickerGroupButton({ children, onClick }: { children: ReactNode; onClick: MouseEventHandler<HTMLButtonElement> }) {
  return (
    <Button
      type="button"
      variant="link"
      className="h-auto w-full cursor-pointer justify-start rounded-sm border-0 p-0 text-left text-xs text-inherit hover:text-foreground"
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
