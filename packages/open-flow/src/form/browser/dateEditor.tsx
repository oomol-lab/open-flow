import type { DateFormat } from '../common/dateValue.ts'
import type { ValueControlProps } from './valueControlProps.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Calendar } from '../../ui/browser/calendar.tsx'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../../ui/browser/input-group.tsx'
import { Input } from '../../ui/browser/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/browser/popover.tsx'
import { calendarChange, calendarDate, datePickerChange, datePickerValue } from '../common/dateValue.ts'

export function DateEditor({
  value,
  onChange,
  label,
  disabled,
  invalid,
  format,
}: Pick<ValueControlProps, 'value' | 'onChange' | 'label' | 'disabled' | 'invalid'> & { format: DateFormat }) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const wall = datePickerValue(value, format)
  const time = (format === 'time' ? wall : wall.split('T')[1]) || '00:00:00'
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <div ref={setContainer} className="min-w-0">
      <InputGroup className="h-[30px]">
        <InputGroupInput
          className="h-full min-w-0 px-2 text-xs md:text-xs"
          aria-label={label}
          aria-invalid={invalid}
          readOnly={disabled}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`${label} (${format})`} />}>
              <i aria-hidden="true" className={format === 'time' ? 'i-lucide-light:clock' : 'i-lucide-light:calendar'} />
            </PopoverTrigger>
            <PopoverContent container={container} align="end" className="w-auto">
              {format !== 'time' && (
                <Calendar
                  mode="single"
                  required
                  selected={calendarDate(value, format)}
                  defaultMonth={calendarDate(value, format)}
                  disabled={disabled}
                  onSelect={(day) => {
                    onChange(calendarChange(day, value, format))
                    if (format === 'date') setOpen(false)
                  }}
                />
              )}
              {format !== 'date' && (
                <div className="grid grid-cols-3 gap-2">
                  {(['hours', 'minutes', 'seconds'] as const).map((part, index) => (
                    <label key={part} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                      {t(`valueEditor.${part}`)}
                      <Input
                        key={time.split(':')[index]}
                        type="number"
                        aria-label={`${label} ${t(`valueEditor.${part}`)}`}
                        min={0}
                        max={index === 0 ? 23 : index === 1 ? 59 : 59.999}
                        step={index === 2 ? 0.001 : 1}
                        defaultValue={time.split(':')[index]}
                        readOnly={disabled}
                        className="w-16 text-xs md:text-xs"
                        onBlur={(event) => {
                          const input = event.currentTarget
                          if (!input.value || !input.validity.valid) {
                            input.value = time.split(':')[index]!
                            return
                          }
                          const parts = time.split(':')
                          parts[index] = input.value.padStart(2, '0')
                          const date = calendarDate(value, format) ?? new Date()
                          const next = format === 'time' ? parts.join(':') : `${calendarChange(date, undefined, 'date')}T${parts.join(':')}`
                          onChange(datePickerChange(next, value, format, date.getTimezoneOffset()))
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}
