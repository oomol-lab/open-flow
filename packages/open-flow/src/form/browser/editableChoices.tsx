import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/browser/popover.tsx'
import { enumIndex } from '../common/choices.ts'
import { ChoiceOptions } from './choiceOptions.tsx'

/** A selection and its definition share one popup, with separate selection and editing views. */
export function EditableChoices({
  options,
  labels,
  value,
  label,
  disabled,
  invalid,
  multiple,
  onChange,
  onOptionsChange,
}: {
  options: readonly unknown[]
  labels: unknown
  value: unknown
  label: string
  disabled?: boolean
  invalid?: boolean
  multiple: boolean
  onChange: (value: unknown) => void
  onOptionsChange: (options: unknown[]) => void
}) {
  const t = useTranslate()
  const group = useId()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const popup = useRef<HTMLDivElement>(null)
  const empty = options.length === 0
  const display = (option: unknown, index: number): string =>
    Array.isArray(labels) && typeof labels[index] === 'string'
      ? labels[index]
      : option === ''
        ? t('valueEditor.emptyStringValue')
        : typeof option === 'string'
          ? option
          : JSON.stringify(option)
  const selected = (option: unknown) => (multiple ? Array.isArray(value) && enumIndex(value, option) >= 0 : enumIndex([option], value) === 0)
  const summary = options.flatMap((option, index) => (selected(option) ? [display(option, index)] : [])).join(', ')
  useLayoutEffect(() => {
    if (!open) return
    const target = popup.current?.querySelector<HTMLElement>(editing ? 'input' : 'input:checked') ?? popup.current?.querySelector<HTMLElement>('input, button')
    target?.focus()
  }, [editing, open])
  return (
    <div ref={setContainer} className="min-w-0">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setEditing(empty)
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="field"
              variant="outline"
              disabled={disabled}
              aria-label={label}
              aria-invalid={invalid || empty}
              className={`w-full min-w-0 justify-between bg-[var(--ui-control-background,var(--ui-muted))] ${empty ? 'text-destructive hover:text-destructive aria-expanded:text-destructive' : ''}`}
            />
          }
        >
          <span className={`min-w-0 truncate ${!empty && !summary ? 'text-muted-foreground' : ''}`}>
            {empty ? t('valueEditor.editOptions') : summary || (value === undefined ? t('valueEditor.unset') : multiple ? '[]' : t('valueEditor.select'))}
          </span>
          <i aria-hidden="true" className="i-lucide-light:chevron-down size-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          container={container}
          align="start"
          aria-label={`${label} ${t('valueEditor.choiceOptions')}`}
          className="w-(--anchor-width) min-w-48 max-w-[calc(100vw-24px)] gap-1 p-1"
        >
          <div ref={popup} className="flex flex-col gap-1">
            {editing ? (
              <>
                <div className="border-b border-border pb-1">
                  <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(false)}>
                    <i aria-hidden="true" data-icon="inline-start" className="i-lucide-light:arrow-left" />
                    {t('valueEditor.backToChoices')}
                  </Button>
                </div>
                <div className="max-h-[min(60vh,360px)] overflow-y-auto p-1">
                  <ChoiceOptions options={options} disabled={disabled} onChange={onOptionsChange} />
                </div>
              </>
            ) : (
              <>
                {options.length > 0 && (
                  <div role={multiple ? 'group' : 'radiogroup'} aria-label={label} className="max-h-[min(60vh,360px)] overflow-y-auto">
                    {options.map((option, index) => (
                      <label
                        key={index}
                        className="relative flex cursor-default items-center gap-2 rounded-[var(--ui-control-radius,var(--ui-radius))] px-2 py-1 text-xs focus-within:bg-accent"
                        onPointerMove={(event) => {
                          if (event.pointerType === 'mouse') event.currentTarget.querySelector('input')?.focus({ preventScroll: true })
                        }}
                      >
                        <input
                          type={multiple ? 'checkbox' : 'radio'}
                          name={group}
                          checked={selected(option)}
                          className="sr-only"
                          onChange={() => {
                            if (multiple) {
                              const current = Array.isArray(value) ? value : []
                              onChange(selected(option) ? current.filter((entry) => enumIndex([option], entry) < 0) : [...current, structuredClone(option)])
                            } else {
                              onChange(structuredClone(option))
                              setOpen(false)
                            }
                          }}
                        />
                        <span className="min-w-0 flex-1 break-words">{display(option, index)}</span>
                        <i aria-hidden="true" className={`i-lucide-light:check size-4 shrink-0 ${selected(option) ? '' : 'invisible'}`} />
                      </label>
                    ))}
                  </div>
                )}
                {!empty && <div role="separator" className="mx-2 h-px bg-border/50" />}
                <div>
                  <Button
                    type="button"
                    variant={empty ? 'destructive' : 'ghost'}
                    size="field"
                    className="w-full justify-start"
                    onPointerMove={(event) => {
                      if (event.pointerType === 'mouse') event.currentTarget.focus({ preventScroll: true })
                    }}
                    onClick={() => setEditing(true)}
                  >
                    {t('valueEditor.editOptions')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
