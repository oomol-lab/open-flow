import type { DurationUnit } from '../common/durationValue.ts'
import type { ValueControlProps } from './valueControlProps.ts'

import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { InputGroup, InputGroupInput } from '../../ui/browser/input-group.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/browser/select.tsx'
import { durationDraft, durationMilliseconds, durationUnits } from '../common/durationValue.ts'
import { selectionMenuContentClass, selectionMenuItemClass } from './selectionMenuStyles.ts'

/** Edits milliseconds; the containing field owns validation and source selection. */
export function DurationInput({
  value,
  onChange,
  label,
  disabled,
  invalid,
  valueActions,
}: Pick<ValueControlProps, 'value' | 'onChange' | 'label' | 'disabled' | 'invalid' | 'valueActions'>) {
  const t = useTranslate()
  const [draft, setDraft] = useState(() => durationDraft(typeof value === 'number' ? value : null))
  const saved = useRef(value)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (saved.current === value) return
    saved.current = value
    setDraft(durationDraft(typeof value === 'number' ? value : null))
  }, [value])
  const change = (next: typeof draft) => {
    if (disabled) return
    setDraft(next)
    const milliseconds = durationMilliseconds(next.value, next.unit) ?? undefined
    saved.current = milliseconds
    onChange(milliseconds)
  }
  return (
    <InputGroup ref={setContainer} controlSize="field" data-disabled={disabled || undefined}>
      <InputGroupInput
        controlSize="field"
        type="number"
        step="any"
        aria-label={label}
        aria-invalid={invalid}
        readOnly={disabled}
        value={draft.value}
        onChange={(event) => change({ ...draft, value: event.target.value })}
      />
      {valueActions}
      <Select
        disabled={disabled}
        value={draft.unit}
        onValueChange={(unit) => {
          if (unit != null) change({ ...draft, unit: unit as DurationUnit })
        }}
      >
        <SelectTrigger variant="inline" size="field" aria-label={t('valueEditor.durationUnit')}>
          <SelectValue>{t(`valueEditor.durationUnits.${draft.unit}`)}</SelectValue>
        </SelectTrigger>
        <SelectContent container={container} align="end" alignItemWithTrigger={false} className={selectionMenuContentClass}>
          {Object.keys(durationUnits).map((unit) => (
            <SelectItem key={unit} value={unit} className={selectionMenuItemClass}>
              {t(`valueEditor.durationUnits.${unit}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </InputGroup>
  )
}
