import type { ReactElement } from 'react'
import type { TriggerSchedule } from '../api.ts'

import { useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'

function ScheduleText({
  value,
  disabled,
  label,
  commit,
  numeric = false,
}: {
  readonly numeric?: boolean
  readonly value: string
  readonly disabled: boolean
  readonly label: string
  readonly commit: (value: string) => void
}): ReactElement {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [previous, setPrevious] = useState(value)
  if (previous !== value) {
    setPrevious(value)
    setDraft(value)
  }
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={numeric ? 'number' : 'text'}
        min={numeric ? 1 : undefined}
        step={numeric ? 1 : undefined}
        disabled={disabled}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          commit(draft)
          setDraft(value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          else if (event.key === 'Escape') {
            setDraft(value)
            event.preventDefault()
          }
        }}
      />
    </Field>
  )
}

export function TriggerScheduleEditor({
  schedules,
  disabled,
  onChange,
  testHint = false,
}: {
  readonly schedules: readonly TriggerSchedule[]
  readonly disabled: boolean
  readonly onChange: (schedules: readonly TriggerSchedule[]) => void
  readonly testHint?: boolean
}): ReactElement {
  const t = useTranslate()
  const id = useId()
  return (
    <section className="inspector-section" data-inspector-section="trigger">
      <FieldGroup>
        {schedules.map((schedule, index) => {
          const save = (next: TriggerSchedule) => onChange(schedules.with(index, next))
          return (
            <FieldGroup key={index}>
              <Field>
                <FieldLabel htmlFor={`${id}-${index}-type`}>{t('triggerSchedule.scheduleType')}</FieldLabel>
                <NativeSelect
                  id={`${id}-${index}-type`}
                  disabled={disabled}
                  value={schedule.type}
                  onChange={(event) => {
                    if (event.target.value !== schedule.type)
                      save(
                        event.target.value === 'cron'
                          ? { type: 'cron', expression: '0 * * * *', timezone: 'UTC' }
                          : { type: 'every', unit: 'minute', value: 5 },
                      )
                  }}
                >
                  <NativeSelectOption value="every">{t('triggerSchedule.scheduleEvery')}</NativeSelectOption>
                  <NativeSelectOption value="cron">{t('triggerSchedule.scheduleCron')}</NativeSelectOption>
                </NativeSelect>
              </Field>
              {schedule.type === 'every' ? (
                <>
                  <ScheduleText
                    disabled={disabled}
                    numeric
                    label={t('triggerSchedule.scheduleInterval')}
                    value={String(schedule.value)}
                    commit={(draft) => {
                      const value = Number(draft)
                      if (Number.isSafeInteger(value) && value >= 1 && value !== schedule.value) save({ ...schedule, value })
                    }}
                  />
                  <Field>
                    <FieldLabel htmlFor={`${id}-${index}-unit`}>{t('triggerSchedule.scheduleUnit')}</FieldLabel>
                    <NativeSelect
                      id={`${id}-${index}-unit`}
                      disabled={disabled}
                      value={schedule.unit}
                      onChange={(event) => save({ ...schedule, unit: event.target.value as typeof schedule.unit })}
                    >
                      {(['minute', 'hour', 'day', 'week', 'month'] as const).map((unit) => (
                        <NativeSelectOption key={unit} value={unit}>
                          {t(
                            {
                              minute: 'triggerSchedule.scheduleMinutes',
                              hour: 'triggerSchedule.scheduleHours',
                              day: 'triggerSchedule.scheduleDays',
                              week: 'triggerSchedule.scheduleWeeks',
                              month: 'triggerSchedule.scheduleMonths',
                            }[unit],
                          )}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </>
              ) : (
                <>
                  <ScheduleText
                    disabled={disabled}
                    label={t('triggerSchedule.scheduleExpression')}
                    value={schedule.expression}
                    commit={(draft) => {
                      const expression = draft.trim().replace(/\s+/g, ' ')
                      if (expression.split(' ').length === 5 && expression !== schedule.expression) save({ ...schedule, expression })
                    }}
                  />
                  <ScheduleText
                    disabled={disabled}
                    label={t('triggerSchedule.scheduleTimezone')}
                    value={schedule.timezone}
                    commit={(draft) => {
                      const timezone = draft.trim()
                      if (timezone !== '' && timezone !== schedule.timezone) save({ ...schedule, timezone })
                    }}
                  />
                </>
              )}
            </FieldGroup>
          )
        })}
        {schedules.length === 0 && <p>{t('triggerSchedule.scheduleMissing')}</p>}
        {testHint && <FieldDescription>{t('triggerSchedule.scheduleTestHint')}</FieldDescription>}
      </FieldGroup>
    </section>
  )
}
