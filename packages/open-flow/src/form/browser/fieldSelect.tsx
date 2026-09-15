import type { ReactNode, ReactElement, ComponentProps } from 'react'

import { Children, isValidElement, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/browser/select.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/browser/tooltip.tsx'

export const selectionMenuRowClass = 'min-h-7 py-1 text-xs leading-5 font-normal'

export const fieldSelectTriggerClass = 'w-full min-w-0 px-2 text-xs font-normal text-foreground'

/** The field editor uses the product selection surface instead of the browser menu. */
export function FieldSelect({
  id,
  value,
  onChange,
  children,
  disabled,
  danger,
  icons,
  'aria-label': label,
  'aria-invalid': invalid,
}: {
  'id'?: string
  'value': string | number
  'onChange': (value: string) => void
  'children': ReactNode
  'disabled'?: boolean
  'danger'?: boolean
  'icons'?: Readonly<Record<string, string>>
  'size'?: string
  'aria-label': string
  'aria-invalid'?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      const props = (child as ReactElement<ComponentProps<'option'>>).props
      return { value: String(props.value ?? props.children), label: props.children, disabled: props.disabled }
    })
  const selected = options.find((option) => option.value === String(value))
  const trigger = (
    <SelectTrigger id={id} size="field" aria-label={label} aria-invalid={invalid || danger} className={fieldSelectTriggerClass}>
      <SelectValue>
        {icons?.[value] ? (
          <>
            <i aria-hidden="true" className={`${icons[value]} inline-block shrink-0 text-base`} />
            <span className="sr-only">{selected?.label}</span>
          </>
        ) : undefined}
      </SelectValue>
    </SelectTrigger>
  )
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        open={open}
        onOpenChange={setOpen}
        value={String(value)}
        onValueChange={(next) => {
          if (next != null) onChange(next)
        }}
        disabled={disabled}
        items={options}
      >
        {icons ? (
          <Tooltip>
            <TooltipTrigger render={trigger} />
            <TooltipContent container={container}>{selected?.label}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <SelectContent container={container} align="start" alignItemWithTrigger={false} className="p-1">
          {options
            .filter((option) => !option.disabled)
            .map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled} className={selectionMenuRowClass}>
                {icons?.[option.value] && <i aria-hidden="true" className={`${icons[option.value]} inline-block shrink-0 text-base`} />}
                {option.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  )
}
