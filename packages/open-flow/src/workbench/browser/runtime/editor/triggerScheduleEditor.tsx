import styles from './triggerScheduleEditor.module.scss'
import type { ReactElement, ReactNode } from 'react'
import type { TriggerSchedule } from '../api.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { FieldSelect } from '../../../../form/browser/fieldSelect.tsx'
import { cronDescription } from '../../../../trigger/browser/cronDescription.ts'
import { validateCronExpression } from '../../../../trigger/common/cron.ts'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Icon } from '../icons.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { TimeZoneSelect } from './timeZoneSelect.tsx'
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
