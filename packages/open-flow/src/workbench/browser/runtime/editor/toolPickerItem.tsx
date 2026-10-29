import type { ReactNode } from 'react'

import { useId } from 'react'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Label } from '../../../../ui/browser/label.tsx'

export function ToolPickerItem({
  icon,
  name,
  subtitle,
  description,
  checked,
  disabled,
  onToggle,
}: {
  readonly icon: ReactNode
  readonly name: string
  readonly subtitle?: string
  readonly description?: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly onToggle: () => void
}) {
  const id = useId()
  return (
    <Label className="group/app flex cursor-pointer text-[13px] font-normal items-start gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-accent has-[:focus-visible]:bg-accent has-data-checked:bg-accent has-data-disabled:cursor-default has-data-disabled:opacity-50">
      {icon}
      <span className="flex min-w-0 flex-1 flex-col gap-1 py-1 leading-5">
        <span id={id} className="truncate font-medium" title={name}>
          {name}
        </span>
        {subtitle && <span className="truncate text-muted-foreground">{subtitle}</span>}
        {description && (
          <span className="line-clamp-2 text-xs leading-[18px] text-muted-foreground" title={description}>
            {description}
          </span>
        )}
      </span>
      <Checkbox className="mt-1.5 shrink-0" checked={checked} disabled={disabled} onCheckedChange={onToggle} aria-labelledby={id} />
    </Label>
  )
}
