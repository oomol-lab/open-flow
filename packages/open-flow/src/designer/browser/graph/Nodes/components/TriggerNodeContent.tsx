import styles from './TriggerNodeContent.module.scss'
import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { DesignerOption as IBasicOption } from '../../../components/select.tsx'
import type { WidgetType } from '../../../jsonSchema/preset.ts'
import type {
  TriggerNodeField,
  TriggerNodePresentation,
  TriggerNodeSchedule,
  TriggerNodeStore,
  TriggerNodeWebhook,
  TriggerNodeWebhookInput,
  TriggerNodeWebhookOptions,
} from '../../../stores/node/triggerNode.store.ts'

import { memo, useId, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../components/button.tsx'
import { DesignerCheckbox } from '../../../components/checkbox.tsx'
import { Input } from '../../../components/input.tsx'
import { DesignerCombobox as Select } from '../../../components/select.tsx'
import { getBaseSchema, optionOf, typeOfSchema } from '../../../jsonSchema/preset.ts'
import { isHandleDef } from '../../../stores/node/constants.ts'

interface TriggerNodeContentProps {
  readonly store: TriggerNodeStore
}

interface ScheduleRuleProps {
  readonly editable: boolean
  readonly onChange: (schedule: TriggerNodeSchedule) => void
  readonly schedule: TriggerNodeSchedule
}

interface ConfigOption extends IBasicOption {
  readonly configValue: unknown | undefined
  readonly source: string
}

const webhookFieldTypes = ['any', 'string', 'number', 'integer', 'boolean', 'object', 'array'] as const satisfies readonly WidgetType[]
const webhookMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

type WebhookFieldType = (typeof webhookFieldTypes)[number]

function kindLabel(kind: TriggerNodePresentation['kind'], t: TFunction): string {
  switch (kind) {
    case 'cron':
      return t('trigger.summaryCron')
    case 'integration':
      return t('trigger.summaryIntegration')
    case 'poll':
      return t('trigger.summaryPoll')
    case 'webhook':
      return t('trigger.summaryWebhook')
  }
}

function emptySummary(kind: TriggerNodePresentation['kind'], t: TFunction): string {
  switch (kind) {
    case 'cron':
    case 'poll':
      return t('trigger.scheduleMissing')
    case 'integration':
      return t('trigger.integrationSummary')
    case 'webhook':
      return t('trigger.webhookSummary')
  }
}

function emptyIcon(kind: TriggerNodePresentation['kind']): string {
  switch (kind) {
    case 'integration':
      return 'i-carbon:events'
    case 'webhook':
      return 'i-carbon:webhook'
    case 'cron':
    case 'poll':
      return 'i-carbon:warning-alt'
  }
}

function ScheduleRule({ editable, onChange, schedule }: ScheduleRuleProps): ReactElement {
  const t = useTranslate()
  const typeId = useId()
  const intervalId = useId()
  const unitId = useId()
  const expressionId = useId()
  const timezoneId = useId()
  const typeOptions: IBasicOption[] = [
    { label: t('trigger.scheduleEvery'), value: 'every' },
    { label: t('trigger.scheduleCron'), value: 'cron' },
  ]
  const unitOptions: IBasicOption[] = [
    { label: t('trigger.scheduleMinutes'), value: 'minute' },
    { label: t('trigger.scheduleHours'), value: 'hour' },
    { label: t('trigger.scheduleDays'), value: 'day' },
    { label: t('trigger.scheduleWeeks'), value: 'week' },
    { label: t('trigger.scheduleMonths'), value: 'month' },
  ]

  return (
    <div className={styles.scheduleRule} data-type={schedule.type}>
      <div className={styles.scheduleField}>
        <label className={styles.scheduleLabel} htmlFor={typeId}>
          {t('trigger.scheduleType')}
        </label>
        <Select
          inputId={typeId}
          disabled={!editable}
          onChange={(option) => {
            if (option?.value == null || option.value == schedule.type) return
            onChange(option.value == 'cron' ? { expression: '0 * * * *', timezone: 'UTC', type: 'cron' } : { type: 'every', unit: 'minute', value: 5 })
          }}
          options={typeOptions}
          value={typeOptions.find((option) => option.value == schedule.type)}
        />
      </div>
      {schedule.type == 'every' ? (
        <>
          <div className={styles.scheduleField}>
            <label className={styles.scheduleLabel} htmlFor={intervalId}>
              {t('trigger.scheduleInterval')}
            </label>
            <Input
              id={intervalId}
              disabled={!editable}
              min={1}
              onBlur={(input) => {
                const value = Number(input.value)
                if (!Number.isSafeInteger(value) || value < 1) {
                  input.value = String(schedule.value)
                } else if (value != schedule.value) {
                  onChange({ ...schedule, value })
                }
              }}
              step={1}
              type="number"
              value={String(schedule.value)}
            />
          </div>
          <div className={styles.scheduleField}>
            <label className={styles.scheduleLabel} htmlFor={unitId}>
              {t('trigger.scheduleUnit')}
            </label>
            <Select
              inputId={unitId}
              disabled={!editable}
              onChange={(option) => {
                if (option?.value != null && option.value != schedule.unit) onChange({ ...schedule, unit: option.value as typeof schedule.unit })
              }}
              options={unitOptions}
              value={unitOptions.find((option) => option.value == schedule.unit)}
            />
          </div>
        </>
      ) : (
        <>
          <div className={styles.scheduleField}>
            <label className={styles.scheduleLabel} htmlFor={expressionId}>
              {t('trigger.scheduleExpression')}
            </label>
            <Input
              id={expressionId}
              disabled={!editable}
              monospace
              onBlur={(input) => {
                const expression = input.value.trim().replace(/\s+/g, ' ')
                if (expression.split(' ').length != 5) {
                  input.value = schedule.expression
                } else if (expression != schedule.expression) {
                  onChange({ ...schedule, expression })
                }
              }}
              placeholder="0 * * * *"
              value={schedule.expression}
            />
          </div>
          <div className={styles.scheduleField}>
            <label className={styles.scheduleLabel} htmlFor={timezoneId}>
              {t('trigger.scheduleTimezone')}
            </label>
            <Input
              id={timezoneId}
              disabled={!editable}
              onBlur={(input) => {
                const timezone = input.value.trim()
                if (timezone.length == 0) {
                  input.value = schedule.timezone
                } else if (timezone != schedule.timezone) {
                  onChange({ ...schedule, timezone })
                }
              }}
              placeholder="UTC"
              value={schedule.timezone}
            />
          </div>
        </>
      )}
    </div>
  )
}

function TriggerField({
  editable,
  field,
  onChange,
}: {
  readonly editable: boolean
  readonly field: TriggerNodeField
  readonly onChange: (value: unknown | undefined) => void
}): ReactElement {
  const t = useTranslate()
  const inputId = useId()
  const [warning, setWarning] = useState<string>()
  const requiredWarning = field.invalid ? t('inputHandleEditor.connectionRequired') : undefined
  let control: ReactElement

  switch (field.kind) {
    case 'select': {
      const options: ConfigOption[] = [
        ...(field.required ? [] : [{ configValue: undefined, label: t('inputHandleEditor.unset'), source: '', value: 'unset' }]),
        ...field.options.map((option, index) => ({ ...option, configValue: option.value, value: `option-${index}` })),
      ]
      control = (
        <Select<ConfigOption>
          ariaInvalid={field.invalid}
          inputId={inputId}
          disabled={!editable}
          onChange={(option) => {
            if (option != null && option.source != field.source) onChange(option.configValue)
          }}
          options={options}
          value={options.find((option) => option.source == field.source)}
          variant={field.invalid ? 'danger' : undefined}
        />
      )
      break
    }
    case 'multi-select': {
      const options: ConfigOption[] = field.options.map((option, index) => ({ ...option, configValue: option.value, value: `option-${index}` }))
      control = (
        <Select<ConfigOption, true>
          ariaInvalid={field.invalid}
          inputId={inputId}
          disabled={!editable}
          isMulti
          onChange={(selected) => onChange(selected.length == 0 ? undefined : selected.map((option) => option.configValue))}
          options={options}
          value={options.filter((option) => field.selected.includes(option.source))}
          variant={field.invalid ? 'danger' : undefined}
        />
      )
      break
    }
    case 'boolean': {
      const options: ConfigOption[] = [
        ...(field.required ? [] : [{ configValue: undefined, label: t('inputHandleEditor.unset'), source: '', value: 'unset' }]),
        { configValue: true, label: 'true', source: 'true', value: 'true' },
        { configValue: false, label: 'false', source: 'false', value: 'false' },
      ]
      control = (
        <Select<ConfigOption>
          ariaInvalid={field.invalid}
          inputId={inputId}
          disabled={!editable}
          onChange={(option) => {
            if (option != null && option.source != field.source) onChange(option.configValue)
          }}
          options={options}
          value={options.find((option) => option.source == field.source)}
          variant={field.invalid ? 'danger' : undefined}
        />
      )
      break
    }
    case 'integer':
    case 'number':
      control = (
        <Input
          ariaInvalid={field.invalid}
          id={inputId}
          disabled={!editable}
          max={Number.MAX_VALUE}
          min={-Number.MAX_VALUE}
          onBlur={(input) => {
            const source = input.value.trim()
            if (source == '') {
              if (field.source != '') onChange(undefined)
              return
            }
            const value = Number(source)
            if (!Number.isFinite(value) || (field.kind == 'integer' && !Number.isInteger(value))) {
              setWarning(t('trigger.configInvalid'))
            } else {
              setWarning(undefined)
              if (source != field.source) onChange(value)
            }
          }}
          onFocus={() => setWarning(undefined)}
          step={field.kind == 'integer' ? 1 : undefined}
          type="number"
          value={field.source}
          warning={warning ?? requiredWarning}
        />
      )
      break
    case 'string':
      control = (
        <Input
          ariaInvalid={field.invalid}
          id={inputId}
          disabled={!editable}
          onBlur={(input) => {
            if (input.value != field.source) onChange(input.value == '' ? undefined : input.value)
          }}
          value={field.source}
          warning={requiredWarning}
        />
      )
      break
    case 'json':
      control = (
        <Input
          ariaInvalid={field.invalid}
          id={inputId}
          disabled={!editable}
          height={44}
          monospace
          multiline
          onBlur={(input) => {
            const source = input.value.trim()
            if (source == '') {
              setWarning(undefined)
              if (field.source != '') onChange(undefined)
              return
            }
            try {
              const value = JSON.parse(source) as unknown
              setWarning(undefined)
              if (JSON.stringify(value) != field.source) onChange(value)
            } catch {
              setWarning(t('trigger.configInvalid'))
            }
          }}
          onFocus={() => setWarning(undefined)}
          value={field.source}
          warning={warning ?? requiredWarning}
        />
      )
      break
  }

  return (
    <div className={`${styles.configField} nodrag`} data-invalid={field.invalid || undefined} data-kind={field.kind}>
      <label className={styles.scheduleLabel} htmlFor={inputId} title={field.description}>
        {field.label}
        {field.required ? ' *' : ''}
      </label>
      {control}
    </div>
  )
}

function WebhookInputRow({
  editable,
  input,
  inputs,
  onChange,
}: {
  readonly editable: boolean
  readonly input: TriggerNodeWebhookInput
  readonly inputs: readonly TriggerNodeWebhookInput[]
  readonly onChange: (input: TriggerNodeWebhookInput) => void
}): ReactElement {
  const t = useTranslate()
  const typeId = useId()
  const [warning, setWarning] = useState<string>()
  const schemaType = typeOfSchema(input.jsonSchema)
  const selectedType = webhookFieldTypes.includes(schemaType as WebhookFieldType) ? (schemaType as WebhookFieldType) : undefined
  const typeOptions: IBasicOption[] = [
    ...(selectedType == null ? [{ isDisabled: true, label: t('trigger.webhookCustomType'), value: 'custom' }] : []),
    ...webhookFieldTypes.map((type) => optionOf(t, type)),
  ]

  return (
    <div className={styles.webhookInputRow}>
      <Input
        ariaLabel={t('trigger.webhookFieldName')}
        disabled={!editable}
        onBlur={(element) => {
          const handle = element.value.trim()
          if (handle == '' || inputs.some((candidate) => candidate !== input && candidate.handle == handle)) {
            element.value = input.handle
            setWarning(t(handle == '' ? 'trigger.webhookFieldNameRequired' : 'trigger.webhookFieldNameDuplicate'))
          } else if (handle != input.handle) {
            onChange({ ...input, handle })
          }
        }}
        onFocus={() => setWarning(undefined)}
        value={input.handle}
        warning={warning}
      />
      <Select
        inputId={typeId}
        disabled={!editable}
        onChange={(option) => {
          const type = option?.value
          if (type == null || type == 'custom' || type == selectedType) return
          const { value: _, ...next } = input
          onChange({ ...next, jsonSchema: getBaseSchema(type as WebhookFieldType, input.jsonSchema) })
        }}
        options={typeOptions}
        value={typeOptions.find((option) => option.value == (selectedType ?? 'custom'))}
      />
      <DesignerCheckbox
        ariaLabel={t('trigger.webhookNullable')}
        checked={input.nullable}
        disabled={!editable}
        onChange={(nullable) => onChange({ ...input, nullable })}
        title={t('trigger.webhookNullable')}
      />
    </div>
  )
}

function nextWebhookFieldName(inputs: readonly TriggerNodeWebhookInput[]): string {
  const names = new Set(inputs.map((input) => input.handle))
  let index = 1
  while (names.has(`field${index}`)) index++
  return `field${index}`
}

function nextHeaderName(headers: Readonly<Record<string, string>>): string {
  let name = 'X-Header'
  let index = 2
  while (Object.hasOwn(headers, name)) name = `X-Header-${index++}`
  return name
}

function WebhookEditor({
  editable,
  onChange,
  webhook,
}: {
  readonly editable: boolean
  readonly onChange: (webhook: TriggerNodeWebhook) => void
  readonly webhook: TriggerNodeWebhook
}): ReactElement {
  const t = useTranslate()
  const methodsId = useId()
  const originsId = useId()
  const statusId = useId()
  const responseId = useId()
  const methodOptions: IBasicOption[] = [...new Set([...webhookMethods, ...(webhook.options.allowedMethods ?? [])])].map((method) => ({
    label: method,
    value: method,
  }))
  const headers = webhook.options.responseHeaders ?? {}

  const changeOptions = <K extends keyof TriggerNodeWebhookOptions>(key: K, value: TriggerNodeWebhookOptions[K] | undefined): void => {
    const options = { ...webhook.options }
    if (value === undefined) delete options[key]
    else options[key] = value
    if (JSON.stringify(options) == JSON.stringify(webhook.options)) return
    onChange({ ...webhook, options })
  }

  const updateInput = (index: number, input: TriggerNodeWebhookInput): void => {
    onChange({ ...webhook, inputs: webhook.inputs.with(index, input) })
  }

  const changeHeaders = (responseHeaders: Readonly<Record<string, string>>): void => {
    changeOptions('responseHeaders', Object.keys(responseHeaders).length == 0 ? undefined : responseHeaders)
  }

  return (
    <div className={styles.webhookEditor}>
      <div className={styles.webhookSectionHeader}>
        <span>{t('trigger.webhookPayloadFields')}</span>
        <button
          className={styles.webhookAddButton}
          disabled={!editable}
          onClick={() =>
            onChange({
              ...webhook,
              inputs: [...webhook.inputs, { handle: nextWebhookFieldName(webhook.inputs), jsonSchema: {}, nullable: false }],
            })
          }
          type="button"
        >
          <i className="i-codicon:add" />
          {t('trigger.webhookAddField')}
        </button>
      </div>
      {webhook.inputs.length == 0 ? (
        <div className={styles.webhookEmpty}>{t('trigger.webhookNoPayloadFields')}</div>
      ) : (
        <>
          <div className={styles.webhookInputHeader}>
            <span>{t('trigger.webhookFieldName')}</span>
            <span>{t('trigger.webhookFieldType')}</span>
            <span>{t('trigger.webhookNullable')}</span>
          </div>
          {webhook.inputs.map((input, index) => (
            <div className={styles.webhookInput} key={`${input.handle}:${index}`}>
              <WebhookInputRow editable={editable} input={input} inputs={webhook.inputs} onChange={(next) => updateInput(index, next)} />
              <Button
                disabled={!editable}
                onClick={() => onChange({ ...webhook, inputs: webhook.inputs.toSpliced(index, 1) })}
                title={t('trigger.webhookDeleteField')}
              >
                <i className="i-codicon:trash" />
              </Button>
            </div>
          ))}
        </>
      )}

      <span className={styles.webhookSectionTitle}>{t('trigger.webhookRequest')}</span>
      <div className={styles.webhookOptionsGrid}>
        <div className={styles.scheduleField}>
          <label className={styles.scheduleLabel} htmlFor={methodsId}>
            {t('trigger.webhookMethods')}
          </label>
          <Select<IBasicOption, true>
            inputId={methodsId}
            disabled={!editable}
            isMulti
            onChange={(options) => changeOptions('allowedMethods', options.length == 0 ? undefined : options.map((option) => option.value!))}
            options={methodOptions}
            value={methodOptions.filter((option) => webhook.options.allowedMethods?.includes(option.value!))}
          />
        </div>
        <div className={styles.scheduleField}>
          <label className={styles.scheduleLabel} htmlFor={originsId}>
            {t('trigger.webhookOrigins')}
          </label>
          <Input
            id={originsId}
            disabled={!editable}
            onBlur={(input) => {
              const origins = input.value
                .split(',')
                .map((origin) => origin.trim())
                .filter(Boolean)
              changeOptions('allowedOrigins', origins.length == 0 ? undefined : origins)
            }}
            placeholder="https://example.com"
            value={webhook.options.allowedOrigins?.join(', ') ?? ''}
          />
        </div>
      </div>

      <span className={styles.webhookSectionTitle}>{t('trigger.webhookResponse')}</span>
      <div className={styles.webhookResponseGrid}>
        <div className={styles.scheduleField}>
          <label className={styles.scheduleLabel} htmlFor={statusId}>
            {t('trigger.webhookStatus')}
          </label>
          <Input
            id={statusId}
            disabled={!editable}
            min={200}
            max={599}
            onBlur={(input) => {
              const value = input.value.trim()
              if (value == '') changeOptions('responseStatusCode', undefined)
              else {
                const status = Number(value)
                if (Number.isInteger(status) && status >= 200 && status <= 599) changeOptions('responseStatusCode', status)
                else input.value = webhook.options.responseStatusCode?.toString() ?? ''
              }
            }}
            placeholder="200"
            type="number"
            value={webhook.options.responseStatusCode?.toString() ?? ''}
          />
        </div>
        <div className={styles.webhookNoBody}>
          <DesignerCheckbox
            checked={webhook.options.noResponseBody ?? false}
            disabled={!editable}
            label={t('trigger.webhookNoResponseBody')}
            onChange={(checked) => changeOptions('noResponseBody', checked ? true : undefined)}
          />
        </div>
        <div className={styles.webhookResponseData}>
          <label className={styles.scheduleLabel} htmlFor={responseId}>
            {t('trigger.webhookResponseData')}
          </label>
          <Input
            id={responseId}
            disabled={!editable || webhook.options.noResponseBody}
            height={44}
            multiline
            onBlur={(input) => changeOptions('responseData', input.value == '' ? undefined : input.value)}
            value={webhook.options.responseData ?? ''}
          />
        </div>
      </div>

      <div className={styles.webhookSectionHeader}>
        <span>{t('trigger.webhookHeaders')}</span>
        <button
          className={styles.webhookAddButton}
          disabled={!editable}
          onClick={() => changeHeaders({ ...headers, [nextHeaderName(headers)]: '' })}
          type="button"
        >
          <i className="i-codicon:add" />
          {t('trigger.webhookAddHeader')}
        </button>
      </div>
      {Object.entries(headers).map(([name, value]) => (
        <div className={styles.webhookHeaderRow} key={name}>
          <Input
            ariaLabel={t('trigger.webhookHeaderName')}
            disabled={!editable}
            onBlur={(input) => {
              const nextName = input.value.trim()
              if (nextName == '' || (nextName != name && Object.hasOwn(headers, nextName))) {
                input.value = name
                return
              }
              if (nextName != name) {
                const next = Object.fromEntries(Object.entries(headers).map(([key, headerValue]) => [key == name ? nextName : key, headerValue]))
                changeHeaders(next)
              }
            }}
            value={name}
          />
          <Input
            ariaLabel={t('trigger.webhookHeaderValue')}
            disabled={!editable}
            onBlur={(input) => {
              if (input.value != value) changeHeaders({ ...headers, [name]: input.value })
            }}
            value={value}
          />
          <Button
            disabled={!editable}
            onClick={() => changeHeaders(Object.fromEntries(Object.entries(headers).filter(([key]) => key != name)))}
            title={t('trigger.webhookDeleteHeader')}
          >
            <i className="i-codicon:trash" />
          </Button>
        </div>
      ))}
    </div>
  )
}

export const TriggerNodeContent: React.FC<TriggerNodeContentProps> = /* @__PURE__ */ memo(({ store }) => {
  const t = useTranslate()
  const nodeEditable = useVal(store.display$.editable) ?? false
  const configEditable = nodeEditable && store.changeConfig != null
  const scheduleEditable = nodeEditable && store.changeSchedule != null
  const webhookEditable = nodeEditable && store.changeWebhook != null
  const presentation = useVal(store.display$.presentation)
  const outputs = useVal(store.display$.outputs_def)
  if (presentation == null) return null

  const payload = outputs?.filter(isHandleDef).find((output) => output.handle == 'payload')
  const payloadType = optionOf(t, typeOfSchema(payload?.json_schema))
  const label = kindLabel(presentation.kind, t)
  const config = presentation.config ?? []

  return (
    <div className={styles.wrapper}>
      <section className={styles.summary} aria-label={label}>
        <div className={styles.meta}>
          <span>{label}</span>
          {presentation.source != null && <span className={styles.source}>{presentation.source}</span>}
        </div>
        <div className={styles.schedules}>
          {presentation.schedules.length > 0 ? (
            presentation.schedules.map((schedule, index) => (
              <ScheduleRule
                editable={scheduleEditable}
                key={schedule.type == 'cron' ? `${schedule.expression}:${schedule.timezone}:${index}` : `${schedule.unit}:${schedule.value}:${index}`}
                onChange={(nextSchedule) => store.changeSchedule?.(presentation.schedules.with(index, nextSchedule))}
                schedule={schedule}
              />
            ))
          ) : (
            <div className={styles.schedule}>
              <i className={emptyIcon(presentation.kind)} />
              <strong>{emptySummary(presentation.kind, t)}</strong>
            </div>
          )}
        </div>
        {config.length > 0 && (
          <div className={styles.configuration}>
            <span className={styles.configurationTitle}>{t('trigger.configuration')}</span>
            <div className={styles.configFields}>
              {config.map((field) => (
                <TriggerField editable={configEditable} field={field} key={field.name} onChange={(value) => store.changeConfig?.(field.name, value)} />
              ))}
            </div>
          </div>
        )}
        {presentation.webhook != null && (
          <div className={styles.configuration}>
            <span className={styles.configurationTitle}>{t('trigger.configuration')}</span>
            <WebhookEditor editable={webhookEditable} webhook={presentation.webhook} onChange={(webhook) => store.changeWebhook?.(webhook)} />
          </div>
        )}
      </section>
      <div className={styles.payload}>
        <i className={`${payloadType.icon} ${styles.payloadIcon}`} />
        <code>payload</code>
        <span className={styles.payloadType}>{payloadType.label}</span>
      </div>
    </div>
  )
})
