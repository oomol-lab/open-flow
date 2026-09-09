import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from './button.tsx'
import { useDelayedTrue } from './hooks.ts'
import { Input } from './input.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './popover.tsx'

export interface VariablePickerProps {
  readonly disabled?: boolean
  readonly enabled: boolean
  readonly loaded: boolean
  readonly loading: boolean
  readonly name?: string
  readonly names: readonly string[]
  readonly onChange: (name: string | undefined) => void
  readonly onOpen: () => void
}

export function VariablePicker({ disabled, enabled, loaded, loading, name, names, onChange, onOpen }: VariablePickerProps) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const displayedLoading = useDelayedTrue(loading, 200)
  const missing = enabled && loaded && name != null && !names.includes(name)
  const unavailable = !enabled
  const issue = unavailable ? t('variablePicker.variableUnavailableHelp') : missing ? t('variablePicker.variableMissingHelp', { name }) : undefined
  const label =
    unavailable && name != null
      ? t('variablePicker.variableUnavailable', { name })
      : missing
        ? t('variablePicker.variableMissing', { name })
        : (name ?? t('variablePicker.selectVariable'))
  const filtered = names.filter((item) => item.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const choose = (next: string | undefined) => {
    onChange(next)
    setOpen(false)
  }
  return (
    <div className="min-w-0" ref={setContainer}>
      <Popover
        open={open && !disabled && enabled}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            setQuery('')
            onOpen()
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="max-w-full justify-start"
              disabled={disabled || unavailable}
              aria-invalid={missing || unavailable}
              title={issue}
            />
          }
        >
          <span className="truncate">{label}</span>
        </PopoverTrigger>
        <PopoverContent
          container={container}
          align="start"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-variable-option]')]
            if (buttons.length === 0) return
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : index <= 0 ? buttons.length - 1 : index - 1
            buttons[next]?.focus()
            event.preventDefault()
          }}
        >
          <PopoverTitle>{t('variablePicker.selectVariable')}</PopoverTitle>
          <Input
            aria-label={t('variablePicker.search')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && filtered[0] != null) {
                choose(filtered[0])
                event.preventDefault()
              }
            }}
          />
          {displayedLoading && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('variablePicker.variablesLoading')}
            </p>
          )}
          <div className="flex max-h-56 flex-col overflow-y-auto">
            {filtered.map((item) => (
              <Button
                key={item}
                data-variable-option
                type="button"
                size="sm"
                variant="ghost"
                className="justify-start"
                aria-pressed={name === item}
                onClick={() => choose(item)}
              >
                {item}
              </Button>
            ))}
            {!loading && filtered.length === 0 && (
              <p role="status" className="text-sm text-muted-foreground">
                {t('variablePicker.empty')}
              </p>
            )}
          </div>
          {name != null && (
            <Button type="button" size="sm" variant="ghost" onClick={() => choose(undefined)}>
              {t('variablePicker.clear')}
            </Button>
          )}
        </PopoverContent>
      </Popover>
      {issue && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {issue}
        </p>
      )}
    </div>
  )
}
