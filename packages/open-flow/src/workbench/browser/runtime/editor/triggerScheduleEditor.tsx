import styles from './triggerScheduleEditor.module.scss'
import type { ReactElement, ReactNode } from 'react'
import type { TriggerSchedule } from '../api.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { FieldSelect, fieldSelectTriggerClass } from '../../../../form/browser/fieldSelect.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from '../../../../form/browser/selectionMenuStyles.ts'
import { cronDescription } from '../../../../trigger/browser/cronDescription.ts'
import { selectableTimeZones, timeZoneLabel, timeZoneLongLabel, timeZoneOffset, timeZoneOffsetMinutes } from '../../../../trigger/browser/timeZones.ts'
import { validateCronExpression } from '../../../../trigger/common/cron.ts'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../../ui/browser/select.tsx'
import { Icon } from '../icons.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { deferScheduleCheck } from './triggerScheduleValidation.ts'

interface ScheduleInspection {
  readonly description?: ReactNode
  readonly issue?: ReactNode
}

interface CronDraftInspection extends ScheduleInspection {
  readonly expression: string
}

function inspectCronDraft(draft: string, language: string, invalidMessage: string, signal: AbortSignal): Promise<CronDraftInspection> {
  return deferScheduleCheck(() => {
    const expression = draft.trim().replace(/\s+/g, ' ')
    try {
      // Expression validity is independent of the separately edited schedule time zone.
      validateCronExpression(expression, 'UTC')
    } catch {
      return { expression, issue: invalidMessage }
    }
    const description = cronDescription(expression, language)
    return { expression, description: description === expression ? undefined : description }
  }, signal)
}

function ScheduleText({
  value,
  disabled,
  label,
  commit,
  inspect,
  numeric = false,
}: {
  readonly numeric?: boolean
  readonly value: string
  readonly disabled: boolean
  readonly label: string
  readonly commit: (value: string, signal: AbortSignal) => Promise<string | undefined>
  readonly inspect?: (value: string, signal: AbortSignal) => Promise<ScheduleInspection>
}): ReactElement {
  const id = useId()
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  const [draft, setDraft] = useState(value)
  const [previous, setPrevious] = useState(value)
  const [inspection, setInspection] = useState<{ readonly draft: string; readonly result: ScheduleInspection }>()
  const commitController = useRef<AbortController>()
  if (previous !== value) {
    setPrevious(value)
    setDraft(value)
  }
  useEffect(() => {
    if (inspect == null) {
      setInspection(undefined)
      return
    }
    const controller = new AbortController()
    void inspect(draft, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setInspection({ draft, result })
      },
      () => {},
    )
    return () => controller.abort()
  }, [draft, inspect])
  useEffect(() => () => commitController.current?.abort(), [])
  const currentInspection = inspection?.draft === draft ? inspection.result : undefined
  const description = currentInspection?.description
  const issue = currentInspection?.issue
  const describedBy = issue != null ? errorId : description != null ? descriptionId : undefined
  return (
    <Field data-invalid={issue != null || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className={description == null ? undefined : styles.describedControl}>
        <Input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={issue != null || undefined}
          className={description == null ? undefined : styles.describedInput}
          controlSize="field"
          type={numeric ? 'number' : 'text'}
          min={numeric ? 1 : undefined}
          step={numeric ? 1 : undefined}
          disabled={disabled}
          value={draft}
          onChange={(event) => {
            commitController.current?.abort()
            setDraft(event.target.value)
          }}
          onBlur={() => {
            commitController.current?.abort()
            const controller = new AbortController()
            commitController.current = controller
            void commit(draft, controller.signal).then(
              (next) => {
                if (!controller.signal.aborted && next != null) setDraft(next)
              },
              () => {},
            )
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            else if (event.key === 'Escape') {
              commitController.current?.abort()
              setDraft(value)
              event.preventDefault()
            }
          }}
        />
        {description != null && (
          <FieldDescription id={descriptionId} className={styles.descriptionCard}>
            {description}
          </FieldDescription>
        )}
        {issue != null && <FieldError id={errorId}>{issue}</FieldError>}
      </div>
    </Field>
  )
}

function TimeZoneSelect({
  id,
  value,
  disabled,
  label,
  onChange,
}: {
  readonly id: string
  readonly value: string
  readonly disabled: boolean
  readonly label: string
  readonly onChange: (value: string) => void
}): ReactElement {
  const t = useTranslate()
  const language = useLang()
  const [open, setOpen] = useState(false)
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const at = new Date()
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

export function TriggerScheduleEditor({
  schedules,
  disabled,
  collapsible = false,
  onChange,
}: {
  readonly schedules: readonly TriggerSchedule[]
  readonly disabled: boolean
  readonly collapsible?: boolean
  readonly onChange: (schedules: readonly TriggerSchedule[]) => void
}): ReactElement {
  const t = useTranslate()
  const language = useLang()
  const id = useId()
  const fields = (
    <FieldGroup>
      {schedules.map((schedule, index) => {
        const save = (next: TriggerSchedule) => onChange(schedules.with(index, next))
        return (
          <FieldGroup key={index}>
            <Field>
              <FieldLabel htmlFor={`${id}-${index}-type`}>{t('triggerSchedule.scheduleType')}</FieldLabel>
              <FieldSelect
                id={`${id}-${index}-type`}
                aria-label={t('triggerSchedule.scheduleType')}
                disabled={disabled}
                value={schedule.type}
                onChange={(value) => {
                  if (value !== schedule.type)
                    save(value === 'cron' ? { type: 'cron', expression: '0 * * * *', timezone: 'UTC' } : { type: 'every', unit: 'minute', value: 5 })
                }}
              >
                <option value="every">{t('triggerSchedule.scheduleEvery')}</option>
                <option value="cron">{t('triggerSchedule.scheduleCron')}</option>
              </FieldSelect>
            </Field>
            {schedule.type === 'every' ? (
              <>
                <ScheduleText
                  disabled={disabled}
                  numeric
                  label={t('triggerSchedule.scheduleInterval')}
                  value={String(schedule.value)}
                  commit={(draft, signal) =>
                    deferScheduleCheck(() => {
                      const value = Number(draft)
                      if (!Number.isSafeInteger(value) || value < 1) return String(schedule.value)
                      if (value !== schedule.value) save({ ...schedule, value })
                      return String(value)
                    }, signal)
                  }
                />
                <Field>
                  <FieldLabel htmlFor={`${id}-${index}-unit`}>{t('triggerSchedule.scheduleUnit')}</FieldLabel>
                  <FieldSelect
                    id={`${id}-${index}-unit`}
                    aria-label={t('triggerSchedule.scheduleUnit')}
                    disabled={disabled}
                    value={schedule.unit}
                    onChange={(value) => save({ ...schedule, unit: value as typeof schedule.unit })}
                  >
                    {(['minute', 'hour', 'day', 'week', 'month'] as const).map((unit) => (
                      <option key={unit} value={unit}>
                        {t(
                          {
                            minute: 'triggerSchedule.scheduleMinutes',
                            hour: 'triggerSchedule.scheduleHours',
                            day: 'triggerSchedule.scheduleDays',
                            week: 'triggerSchedule.scheduleWeeks',
                            month: 'triggerSchedule.scheduleMonths',
                          }[unit],
                        )}
                      </option>
                    ))}
                  </FieldSelect>
                </Field>
              </>
            ) : (
              <>
                <ScheduleText
                  disabled={disabled}
                  label={t('triggerSchedule.scheduleExpression')}
                  value={schedule.expression}
                  inspect={(draft, signal) => inspectCronDraft(draft, language, t('triggerSchedule.scheduleExpressionInvalid'), signal)}
                  commit={async (draft, signal) => {
                    const result = await inspectCronDraft(draft, language, t('triggerSchedule.scheduleExpressionInvalid'), signal)
                    if (result.issue != null) return
                    if (result.expression !== schedule.expression) save({ ...schedule, expression: result.expression })
                    return result.expression
                  }}
                />
                <Field>
                  <FieldLabel htmlFor={`${id}-${index}-timezone`}>{t('triggerSchedule.scheduleTimezone')}</FieldLabel>
                  <TimeZoneSelect
                    id={`${id}-${index}-timezone`}
                    label={t('triggerSchedule.scheduleTimezone')}
                    disabled={disabled}
                    value={schedule.timezone}
                    onChange={(timezone) => {
                      if (timezone !== schedule.timezone) save({ ...schedule, timezone })
                    }}
                  />
                </Field>
              </>
            )}
          </FieldGroup>
        )
      })}
      {schedules.length === 0 && <p>{t('triggerSchedule.scheduleMissing')}</p>}
    </FieldGroup>
  )
  if (collapsible)
    return (
      <details className="inspector-disclosure" data-inspector-section="trigger">
        <summary>
          <Icon name="chevron-down" size={14} />
          <span className="inspector-disclosure-summary">
            <strong className="inspector-section-title-text">{t('triggerSchedule.title')}</strong>
          </span>
        </summary>
        <div className="inspector-disclosure-content node-settings">{fields}</div>
      </details>
    )
  return (
    <InspectorSection title={t('triggerSchedule.title')} className="node-settings" data-inspector-section="trigger">
      {fields}
    </InspectorSection>
  )
}
