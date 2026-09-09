import styles from './valueEditor.module.scss'
import type { ReactNode } from 'react'
import type { ValueEditorProps } from './valueEditor.tsx'

import { useMemo, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Checkbox } from '../../ui/browser/checkbox.tsx'
import { NativeSelect } from '../../ui/browser/native-select.tsx'
import { choiceSchema, enumIndex, schemaChoices, toggleEnumValue } from '../common/choices.ts'
import { compile } from '../common/validation/validator.ts'
import { initialValue, objectValue } from '../common/value.ts'

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
      <NativeSelect
        aria-label={t('valueEditor.variant', { name: label })}
        disabled={disabled || choices.length === 0}
        value={activeIndex}
        onChange={(event) => {
          const index = Number(event.target.value)
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
      </NativeSelect>
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
  return (
    <div className={styles.collection} role="group" aria-label={label}>
      {value === undefined && (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([])}>
          {t('valueEditor.createArray')}
        </Button>
      )}
      {options.map((option, index) => (
        <label className={styles.option} key={index}>
          <Checkbox
            disabled={disabled}
            checked={Array.isArray(value) && enumIndex(value, option) >= 0}
            onCheckedChange={(checked) => onChange(toggleEnumValue(options, value, index, checked))}
          />
          <span>
            {Array.isArray(labels) && typeof labels[index] === 'string' ? labels[index] : typeof option === 'string' ? option : JSON.stringify(option)}
          </span>
        </label>
      ))}
    </div>
  )
}
