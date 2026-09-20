import styles from './valueEditor.module.scss'
import type { ValueControlProps } from './valueControlProps.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Input } from '../../ui/browser/input.tsx'
import { Switch } from '../../ui/browser/switch.tsx'
import { Textarea } from '../../ui/browser/textarea.tsx'
import { isDateFormat } from '../common/dateValue.ts'
import { objectValue, valueType } from '../common/value.ts'
import { ColorEditor } from './colorEditor.tsx'
import { DateEditor } from './dateEditor.tsx'

/** Scalar input controls. The containing field owns validation and presentation state. */
export function ValueEditor(props: ValueControlProps) {
  const { value, schema, label, disabled, onChange, invalid, onDraftIssue: reportDraftIssue } = props
  const t = useTranslate()
  const id = useId()
  const source = objectValue(schema) ?? {}
  const type = valueType(schema, value)
  const presence = value === undefined ? 'unset' : value === null ? 'null' : 'value'
  return type === 'boolean' ? (
    <div className={styles.booleanControl}>
      <Button
        type="button"
        variant="field"
        size="field"
        data-field-control
        role="switch"
        aria-label={label}
        aria-checked={value === true}
        data-field-prompt={invalid || undefined}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        onClick={() => onChange(value !== true)}
      >
        {presence === 'unset' ? t('valueEditor.select') : value === true ? 'True' : value === false ? 'False' : String(value)}
      </Button>
      <Switch
        render={<span />}
        size="sm"
        checked={value === true}
        readOnly
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        className={styles.booleanIndicator}
      />
    </div>
  ) : type === 'null' ? (
    value === null ? (
      <div className={styles.nullValue} data-field-control data-readonly={disabled || undefined} aria-label={`${label} null`}>
        <span className={styles.nullChip}>null</span>
      </div>
    ) : (
      <Button
        type="button"
        size="field"
        variant="outline"
        className={styles.nullValue}
        data-field-prompt={invalid || undefined}
        disabled={disabled}
        aria-label={`${label} ${t('valueEditor.setValue')}: null`}
        aria-invalid={invalid || undefined}
        onClick={() => onChange(null)}
      >
        {presence === 'unset' ? t('valueEditor.unset') : JSON.stringify(value)}
      </Button>
    )
  ) : type === 'string' && source['ui:widget'] === 'color' ? (
    <ColorEditor {...props} onDraftIssue={reportDraftIssue} value={value} invalid={invalid} />
  ) : type === 'string' && isDateFormat(source.format) ? (
    <DateEditor {...props} value={value} invalid={invalid} format={source.format} />
  ) : type === 'number' || type === 'integer' ? (
    <NumberEditor {...props} onDraftIssue={reportDraftIssue} value={value} invalid={invalid} integer={type === 'integer'} />
  ) : (
    <>
      <label className={styles.srOnly} htmlFor={id}>
        {label}
      </label>
      {source['ui:widget'] === 'text' ? (
        <Textarea
          id={id}
          aria-invalid={invalid}
          className={value === '' ? styles.emptyString : undefined}
          placeholder={t(value === '' ? 'valueEditor.emptyStringValue' : 'valueEditor.unset')}
          readOnly={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          controlSize="field"
          aria-invalid={invalid}
          className={value === '' ? styles.emptyString : undefined}
          placeholder={t(value === '' ? 'valueEditor.emptyStringValue' : 'valueEditor.unset')}
          readOnly={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </>
  )
}

function NumberEditor(props: ValueControlProps & { integer: boolean }) {
  const { value, onChange, label, disabled, path, onDraftIssue, integer } = props
  const t = useTranslate()
  const lastValue = useRef(value)
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    if (lastValue.current === value) return
    lastValue.current = value
    setText(value === undefined ? '' : String(value))
    setInvalid(false)
    onDraftIssue(path, false)
  }, [value, path, onDraftIssue])
  useEffect(() => () => onDraftIssue(path, false), [path, onDraftIssue])
  return (
    <>
      <Input
        type="text"
        controlSize="field"
        placeholder={t('valueEditor.unset')}
        inputMode={integer ? 'numeric' : 'decimal'}
        aria-label={label}
        aria-invalid={invalid || props.invalid}
        readOnly={disabled}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value
          setText(nextText)
          const next = nextText.trim() === '' ? undefined : Number(nextText)
          const draftInvalid = next !== undefined && (!Number.isFinite(next) || (integer && !Number.isInteger(next)))
          setInvalid(draftInvalid)
          onDraftIssue(path, draftInvalid)
          if (!draftInvalid) {
            lastValue.current = next
            onChange(next)
          }
        }}
      />
      {invalid && (
        <p className={styles.error} role="alert">
          {t('valueEditor.invalidNumber')}
        </p>
      )}
    </>
  )
}
