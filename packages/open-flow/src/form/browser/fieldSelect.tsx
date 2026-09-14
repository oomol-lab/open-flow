import type { ReactNode, ReactElement, ComponentProps } from 'react'

import { Children, isValidElement, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/browser/select.tsx'

export const fieldSelectTriggerClass = 'w-full min-w-0 px-2 text-xs font-normal text-foreground'

/** The field editor uses the product selection surface instead of the browser menu. */
export function FieldSelect({
  value,
  onChange,
  children,
  disabled,
  'aria-label': label,
  'aria-invalid': invalid,
}: {
  'value': string | number
  'onChange': (value: string) => void
  'children': ReactNode
  'disabled'?: boolean
  'size'?: string
  'aria-label': string
  'aria-invalid'?: boolean
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const options = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      const props = (child as ReactElement<ComponentProps<'option'>>).props
      return { value: String(props.value ?? props.children), label: props.children, disabled: props.disabled }
    })
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        value={String(value)}
        onValueChange={(next) => {
          if (next != null) onChange(next)
        }}
        disabled={disabled}
        items={options}
      >
        <SelectTrigger size="field" aria-label={label} aria-invalid={invalid} className={fieldSelectTriggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent container={container} align="start" alignItemWithTrigger={false} className="p-1">
          {options
            .filter((option) => !option.disabled)
            .map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled} className="text-xs">
                {option.label}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  )
}
