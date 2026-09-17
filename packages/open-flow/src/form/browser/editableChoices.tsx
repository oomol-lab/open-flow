import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/browser/popover.tsx'
import { SelectChevron } from '../../ui/browser/select.tsx'
import { enumIndex } from '../common/choices.ts'
import { ChoiceOptions } from './choiceOptions.tsx'
import { selectionMenuRowClass } from './fieldSelect.tsx'

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
  onOptionsChange?: (options: unknown[]) => void
}) {
  const t = useTranslate()
  const group = useId()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const popup = useRef<HTMLDivElement>(null)
  const empty = options.length === 0
  const danger = empty || value === undefined
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
          if (next) setEditing(empty && onOptionsChange != null)
        }}
      >
        <PopoverTrigger
          render={
            <Button
              type="button"
              size="field"
              variant="field"
              data-field-control
              disabled={disabled}
              aria-label={label}
              aria-invalid={invalid || danger}
              data-field-prompt={empty || value === undefined || (!multiple && !summary) || undefined}
              className="w-full min-w-0 justify-between"
            />
          }
        >
          <span className="min-w-0 truncate">
            {empty
              ? t(onOptionsChange ? 'valueEditor.editOptions' : 'valueEditor.noOptions')
              : summary ||
                (value === undefined ? t(multiple ? 'valueEditor.selectMultiple' : 'valueEditor.select') : multiple ? '[]' : t('valueEditor.select'))}
          </span>
          <SelectChevron />
        </PopoverTrigger>
        <PopoverContent
          container={container}
          align="start"
          aria-label={`${label} ${t('valueEditor.choiceOptions')}`}
          className="w-(--anchor-width) min-w-48 max-w-[calc(100vw-24px)] gap-1 rounded-[var(--ui-control-radius,calc(var(--ui-radius)_+_2px))] p-1"
        >
          <div ref={popup} className="flex flex-col">
            {editing && onOptionsChange ? (
              <>
                <div>
                  <Button type="button" variant="ghost" size="field" onClick={() => setEditing(false)}>
                    <i aria-hidden="true" data-icon="inline-start" className="i-lucide:chevron-left" />
                    {t('valueEditor.backToChoices')}
                  </Button>
                </div>
                <div role="separator" className="mx-2 my-1 h-px bg-border/50" />
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
                        className={`relative flex cursor-default items-center gap-2 rounded-[var(--ui-control-radius,var(--ui-radius))] px-2 focus-within:bg-accent ${selectionMenuRowClass}`}
                        onPointerMove={(event) => {
                          if (event.pointerType === 'mouse') event.currentTarget.querySelector('input')?.focus({ preventScroll: true })
                        }}
                      >
                        <input
                          type={multiple ? 'checkbox' : 'radio'}
                          disabled={disabled}
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
                {onOptionsChange && !empty && <div role="separator" className="mx-2 my-1 h-px bg-border/50" />}
                {empty && !onOptionsChange && <span className={`px-2 text-muted-foreground ${selectionMenuRowClass}`}>{t('valueEditor.noOptions')}</span>}
                {onOptionsChange && (
                  <div>
                    <Button
                      type="button"
                      variant={empty ? 'destructive' : 'ghost'}
                      size="sm"
                      className={`w-full justify-start px-2 ${selectionMenuRowClass}`}
                      onPointerMove={(event) => {
                        if (event.pointerType === 'mouse') event.currentTarget.focus({ preventScroll: true })
                      }}
                      disabled={disabled}
                      onClick={() => setEditing(true)}
                    >
                      {t('valueEditor.editOptions')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
