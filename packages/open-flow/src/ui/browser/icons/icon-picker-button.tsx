import type { ReactNode } from 'react'

import { useState } from 'react'
import { Button } from '../button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../popover.tsx'
import { IconPicker } from './picker/IconPicker.tsx'

export function IconPickerButton({
  children,
  className,
  disabled,
  label,
  onChange,
  side = 'bottom',
}: {
  readonly children: ReactNode
  readonly className?: string
  readonly disabled?: boolean
  readonly label: string
  readonly onChange: (icon: string) => void
  readonly side?: 'top' | 'bottom'
}) {
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <div className="inline-flex" ref={setContainer}>
      <Popover open={open && !disabled} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button aria-label={label} className={className} disabled={disabled} size="icon-xs" variant="ghost" />}>
          {children}
        </PopoverTrigger>
        <PopoverContent aria-label={label} container={container} side={side} className="w-auto p-0">
          <IconPicker
            emoji
            onCancel={() => setOpen(false)}
            onChange={(collection, icon, color) => {
              onChange(color.toLowerCase() === 'currentcolor' ? `:${collection}:${icon}:` : `:${collection}:${icon}:${color}:`)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
