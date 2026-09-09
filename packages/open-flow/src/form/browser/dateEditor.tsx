import type { DateFormat } from '../common/dateValue.ts'
import type { ValueEditorProps } from './valueEditor.tsx'

import { Input } from '../../ui/browser/input.tsx'
import { datePickerChange, datePickerValue } from '../common/dateValue.ts'

export function DateEditor({ value, onChange, label, disabled, format }: ValueEditorProps & { format: DateFormat }) {
  return (
    <>
      <Input aria-label={label} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />
      <Input
        aria-label={`${label} (${format})`}
        disabled={disabled}
        type={format === 'date-time' ? 'datetime-local' : format}
        step={format === 'date' ? undefined : '0.001'}
        value={datePickerValue(value, format)}
        onChange={(event) => {
          const next = event.target.value
          const date = format === 'date-time' && next ? new Date(next) : new Date()
          onChange(datePickerChange(next, value, format, date.getTimezoneOffset()))
        }}
      />
    </>
  )
}
