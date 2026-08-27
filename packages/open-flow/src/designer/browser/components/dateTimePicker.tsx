import styles from './dateTimePicker.module.scss'
import type { JSX } from 'react/jsx-runtime'

import { clsx } from 'clsx'
import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../ui/browser/button.tsx'
import { Input } from '../../../ui/browser/input.tsx'

export interface DateTimePickerProps {
  className?: string
  style?: React.CSSProperties
  showDate?: boolean
  showTime?: boolean
  defaultValue?: Date
  value?: Date | null
  isClearable?: boolean
  onChange?: (value: Date | null) => void
  disabled?: boolean
  isSuffix?: boolean
}

export function DateTimePicker(props: DateTimePickerProps): JSX.Element {
  const t = useTranslate()
  const showDate = props.showDate ?? true
  const showTime = props.showTime ?? false
  const [uncontrolledValue, setUncontrolledValue] = useState<Date | null>(props.defaultValue ?? null)
  const selected = props.value === undefined ? uncontrolledValue : props.value
  const onChange = (value: Date | null) => {
    if (props.value === undefined) setUncontrolledValue(value)
    props.onChange?.(value)
  }

  return (
    <div className={clsx(styles.wrapper, props.isSuffix && styles.isSuffix, props.className)} style={props.style}>
      <Input
        className={styles.input}
        disabled={props.disabled}
        onChange={(event) => onChange(parseValue(event.target.value, showDate, showTime, selected))}
        step={showTime ? 60 : undefined}
        type={showDate ? (showTime ? 'datetime-local' : 'date') : 'time'}
        value={formatValue(selected, showDate, showTime)}
      />
      {props.isClearable && selected && !props.disabled && (
        <Button aria-label={t('components.clearDateTime')} className={styles.clear} onClick={() => onChange(null)} size="icon-xs" type="button" variant="ghost">
          <i className="i-codicon:close" />
        </Button>
      )}
    </div>
  )
}

function formatValue(value: Date | null, showDate: boolean, showTime: boolean): string {
  if (!value) return ''
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  const time = `${pad(value.getHours())}:${pad(value.getMinutes())}`
  return showDate ? (showTime ? `${date}T${time}` : date) : time
}

function parseValue(value: string, showDate: boolean, showTime: boolean, previous: Date | null): Date | null {
  if (!value) return null
  if (showDate) return new Date(showTime ? value : `${value}T00:00`)
  const [hours = 0, minutes = 0] = value.split(':').map(Number)
  const date = previous ? new Date(previous) : new Date()
  date.setHours(hours, minutes, 0, 0)
  return date
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}
