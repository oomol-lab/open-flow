import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../ui/browser/select.tsx'
import { enumIndex } from '../common/choices.ts'
import { fieldSelectTriggerClass, selectionMenuRowClass } from './fieldSelect.tsx'

export function EnumChoices({
  options,
  labels,
  value,
  label,
  disabled,
  invalid,
  onChange,
}: {
  options: readonly unknown[]
  labels: unknown
  value: unknown
  label: string
  disabled?: boolean
  invalid?: boolean
  onChange: (value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const display = (option: unknown, index: number) =>
    Array.isArray(labels) && typeof labels[index] === 'string' ? labels[index] : typeof option === 'string' ? option : JSON.stringify(option)
  const selected = options.flatMap((option, index) => (Array.isArray(value) && enumIndex(value, option) >= 0 ? [display(option, index)] : []))
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        open={open}
        onOpenChange={setOpen}
        multiple
        disabled={disabled}
        value={options.flatMap((option, index) => (Array.isArray(value) && enumIndex(value, option) >= 0 ? [String(index)] : []))}
        onValueChange={(next) => onChange(next.map((index) => structuredClone(options[Number(index)])))}
      >
        <SelectTrigger aria-label={label} aria-invalid={invalid || value === undefined} className={fieldSelectTriggerClass}>
          <span className="min-w-0 flex-1 truncate text-left">{value === undefined ? t('valueEditor.selectMultiple') : selected.join(', ') || '[]'}</span>
        </SelectTrigger>
        <SelectContent container={container} align="start" alignItemWithTrigger={false} className="p-1">
          {options.map((option, index) => (
            <SelectItem key={index} value={String(index)} className={selectionMenuRowClass}>
              {display(option, index)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
