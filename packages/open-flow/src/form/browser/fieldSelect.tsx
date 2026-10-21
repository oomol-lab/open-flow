import type { ReactNode, ReactElement, ComponentProps } from 'react'

import { Children, isValidElement, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../../ui/browser/select.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/browser/tooltip.tsx'
import { FieldTypeDisplay } from './fieldTypeDisplay.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from './selectionMenuStyles.ts'

export const fieldSelectTriggerClass = 'w-full min-w-0 px-2 text-xs font-normal text-foreground'

/** The field editor uses the product selection surface instead of the browser menu. */
export function FieldSelect({
  id,
  value,
  onChange,
  children,
  disabled,
  readOnly,
  danger,
  icons,
  displayValue,
  renderOption,
  showTooltip,
  variant,
  'aria-label': label,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: {
  'variant'?: 'addon'
  'id'?: string
  'value': string | number
  'onChange': (value: string) => void
  'children': ReactNode
  'disabled'?: boolean
  'readOnly'?: boolean
  'danger'?: boolean
  'icons'?: Readonly<Record<string, string>>
  'displayValue'?: ReactNode
  'renderOption'?: (value: string, label: ReactNode) => ReactNode
  'showTooltip'?: boolean
  'size'?: string
  'aria-label': string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}) {
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const entries = Children.toArray(children)
    .filter(isValidElement)
    .map((child) => {
      if (child.type === 'hr') return { kind: 'separator' as const, key: child.key }
      const props = (child as ReactElement<ComponentProps<'option'>>).props
      return { kind: 'option' as const, value: String(props.value ?? props.children), label: props.children, disabled: props.disabled }
    })
  const options = entries.filter((entry) => entry.kind === 'option')
  const selected = options.find((option) => option.value === String(value))
  if (readOnly && icons?.[value]) {
    return (
      <FieldTypeDisplay
        addon={variant === 'addon'}
        id={id}
        label={selected?.label}
        accessibleLabel={`${label}: ${selected?.label ?? value}`}
        icon={<i aria-hidden="true" className={`${icons[value]} inline-block shrink-0 text-base`} />}
      />
    )
  }
  const trigger = (
    <SelectTrigger
      id={id}
      size="field"
      variant={variant}
      aria-label={label}
      aria-invalid={invalid || danger}
      aria-describedby={describedBy}
      data-field-prompt={danger || undefined}
      className={variant === 'addon' ? undefined : fieldSelectTriggerClass}
    >
      <SelectValue className={variant === 'addon' ? 'flex-none justify-center' : undefined}>
        {displayValue ??
          (icons?.[value] ? (
            <>
              <i aria-hidden="true" className={`${icons[value]} inline-block shrink-0 text-base`} />
              <span className="sr-only">{selected?.label}</span>
            </>
          ) : undefined)}
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
        disabled={disabled || readOnly}
        items={options}
      >
        {icons || showTooltip ? (
          <Tooltip>
            <TooltipTrigger render={trigger} />
            <TooltipContent container={container}>{selected?.label}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <SelectContent
          container={container}
          align="start"
          alignItemWithTrigger={false}
          className={`${selectionMenuContentClass} w-max min-w-[max(9rem,var(--anchor-width))] max-w-(--available-width)`}
        >
          {entries.map((entry) =>
            entry.kind === 'separator' ? (
              <SelectSeparator key={entry.key} className="mx-2 bg-border/50" />
            ) : entry.disabled ? null : (
              <SelectItem key={entry.value} value={entry.value} className={selectionMenuItemClass}>
                {renderOption ? (
                  renderOption(entry.value, entry.label)
                ) : (
                  <>
                    {icons?.[entry.value] && <i aria-hidden="true" className={`${icons[entry.value]} inline-block shrink-0 text-base`} />}
                    {entry.label}
                  </>
                )}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
    </div>
  )
}
