import type { ReactElement } from 'react'

import { useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { fieldSelectTriggerClass } from '../../../../form/browser/fieldSelect.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { selectableTimeZones, timeZoneLabel, timeZoneLongLabel, timeZoneOffset, timeZoneOffsetMinutes } from '../../../../trigger/browser/timeZones.ts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'

export function TimeZoneSelect({
  id,
  value,
  disabled,
  label,
  onChange,
  at = new Date(),
}: {
  readonly id: string
  readonly value: string
  readonly disabled: boolean
  readonly label: string
  readonly at?: Date
  readonly onChange: (value: string) => void
}): ReactElement {
  const t = useTranslate()
  const language = useLang()
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const timezones = (selectableTimeZones.includes(value) ? selectableTimeZones : [value, ...selectableTimeZones]).toSorted((left, right) => {
    const offset = (timeZoneOffsetMinutes(left, at) ?? Number.POSITIVE_INFINITY) - (timeZoneOffsetMinutes(right, at) ?? Number.POSITIVE_INFINITY)
    return offset || timeZoneLongLabel(left, language).localeCompare(timeZoneLongLabel(right, language), language)
  })
  const items = timezones.map((timezone) => ({ value: timezone, label: timeZoneLongLabel(timezone, language) }))
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        open={open}
        onOpenChange={setOpen}
        value={value}
        onValueChange={(next) => {
          if (next != null) onChange(next)
        }}
        disabled={disabled}
        items={items}
      >
        <SelectTrigger id={id} size="field" aria-label={label} className={fieldSelectTriggerClass}>
          <SelectValue>{timeZoneLabel(value, t, language)}</SelectValue>
        </SelectTrigger>
        <SelectContent container={container} align="start" alignItemWithTrigger={false} className={selectionMenuContentClass}>
          {timezones.map((timezone) => (
            <SelectItem key={timezone} value={timezone} className={selectionMenuItemClass}>
              <span className="flex w-full min-w-0 items-baseline gap-3">
                <span className="w-[72px] shrink-0 font-mono text-[11px] text-muted-foreground">{timeZoneOffset(timezone, at) ?? '—'}</span>
                <span className="min-w-0 flex-1 truncate">{timeZoneLongLabel(timezone, language)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
