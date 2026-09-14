import styles from './valueEditor.module.scss'
import type { ReactNode } from 'react'
import type { ValueEditorProps } from './valueEditor.tsx'

import { useMemo, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../ui/browser/select.tsx'
import { choiceSchema, enumIndex, schemaChoices } from '../common/choices.ts'
import { compile } from '../common/validation/validator.ts'
import { initialValue, objectValue } from '../common/value.ts'
import { FieldSelect, fieldSelectTriggerClass } from './fieldSelect.tsx'

export function ChoiceEditor(props: ValueEditorProps & { render: (schema: unknown, index: number) => ReactNode }) {
  const { schema, value, label, disabled, onChange, render } = props
  const t = useTranslate()
  const choices = schemaChoices(schema) ?? []
  const validators = useMemo(() => choices.map((_, index) => compile(choiceSchema(schema, index))[0]), [schema])
  const [selected, setSelected] = useState<number>()
  const matching = validators.findIndex((validate) => validate?.(value))
  const activeIndex = selected != null && selected < choices.length ? selected : Math.max(0, matching)
  const labels = objectValue(objectValue(schema)?.['ui:options'])?.labels
  return (
    <div className={styles.collection}>
      <FieldSelect
        aria-label={t('valueEditor.variant', { name: label })}
        disabled={disabled || choices.length === 0}
        value={activeIndex}
        onChange={(nextValue) => {
          const index = Number(nextValue)
          setSelected(index)
          onChange(initialValue(choiceSchema(schema, index)))
        }}
      >
        {choices.map((choice, index) => (
          <option key={index} value={index}>
            {Array.isArray(labels) && typeof labels[index] === 'string'
              ? labels[index]
              : typeof objectValue(choice)?.title === 'string'
                ? String(objectValue(choice)!.title)
                : t('valueEditor.option', { index: index + 1 })}
          </option>
        ))}
      </FieldSelect>
      {choices.length > 0 && render(choiceSchema(schema, activeIndex), activeIndex)}
    </div>
  )
}

export function EnumChoices({
  options,
  labels,
  value,
  label,
  disabled,
  onChange,
}: {
  options: readonly unknown[]
  labels: unknown
  value: unknown
  label: string
  disabled?: boolean
  onChange: (value: unknown) => void
}) {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const display = (option: unknown, index: number) =>
    Array.isArray(labels) && typeof labels[index] === 'string' ? labels[index] : typeof option === 'string' ? option : JSON.stringify(option)
  const selected = options.flatMap((option, index) => (Array.isArray(value) && enumIndex(value, option) >= 0 ? [display(option, index)] : []))
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        multiple
        disabled={disabled}
        value={options.flatMap((option, index) => (Array.isArray(value) && enumIndex(value, option) >= 0 ? [String(index)] : []))}
        onValueChange={(next) => onChange(next.map((index) => structuredClone(options[Number(index)])))}
      >
        <SelectTrigger aria-label={label} className={fieldSelectTriggerClass}>
          <span className="min-w-0 flex-1 truncate text-left">{value === undefined ? t('valueEditor.unset') : selected.join(', ') || '[]'}</span>
        </SelectTrigger>
        <SelectContent container={container} align="start" alignItemWithTrigger={false} className="p-1">
          {options.map((option, index) => (
            <SelectItem key={index} value={String(index)} className="text-xs">
              {display(option, index)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
