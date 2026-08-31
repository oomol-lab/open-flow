import styles from './TriggerSection.module.scss'
import type { TriggerPollTime } from '../../../../schema/index.ts'
import type { DesignerOption as IBasicOption } from '../../components/select.tsx'
import type { TriggerSectionStore } from '../../stores/node/nodeSection/triggerSection.store.ts'

import { useStoreApi } from '@xyflow/react'
import { memo, useId } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { HandleRow } from '../../components/handleRow.tsx'
import { Input } from '../../components/input.tsx'
import { DesignerCombobox as Select } from '../../components/select.tsx'
import { useConnectorServiceConnections } from '../../connectorConnection.ts'
import { HandleEditor } from '../../jsonSchema/handleEditor.tsx'
import { TRIGGER_SECTION_TYPE } from '../../stores/node/nodeSection/constants.ts'
import { useDesignerStore } from '../DesignerStoreContext.tsx'
import { Card } from './card.tsx'

export interface TriggerSectionProps {
  readonly section: TriggerSectionStore
}

interface PollScheduleRuleProps {
  readonly editable: boolean
  readonly rule: TriggerPollTime
  readonly section: TriggerSectionStore
}

function PollScheduleRule({ editable, rule, section }: PollScheduleRuleProps) {
  const t = useTranslate()
  const typeId = useId()
  const unitId = useId()
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
    <div className={styles.scheduleRule} data-type={rule.type}>
      <label className={styles.visuallyHidden} htmlFor={typeId}>
        {t('trigger.scheduleType')}
      </label>
      <Select
        inputId={typeId}
        disabled={!editable}
        options={typeOptions}
        value={typeOptions.find((option) => option.value == rule.type)}
        onChange={(option) => {
          if (option?.value == null || option.value == rule.type) return
          section.setPollTime(option.value == 'cron' ? { type: 'cron', expression: '0 * * * *', timezone: 'UTC' } : { type: 'every', unit: 'minute', value: 5 })
        }}
      />
      {rule.type == 'every' ? (
        <>
          <Input
            ariaLabel={t('trigger.scheduleInterval')}
            disabled={!editable}
            min={1}
            step={1}
            type="number"
            value={String(rule.value)}
            onBlur={(input) => {
              const value = Number(input.value)
              if (!Number.isSafeInteger(value) || value < 1) input.value = String(rule.value)
            }}
            onChange={(value) => {
              const interval = Number(value)
              if (Number.isSafeInteger(interval) && interval > 0) section.setPollTime({ ...rule, value: interval })
            }}
          />
          <>
            <label className={styles.visuallyHidden} htmlFor={unitId}>
              {t('trigger.scheduleUnit')}
            </label>
            <Select
              inputId={unitId}
              disabled={!editable}
              options={unitOptions}
              value={unitOptions.find((option) => option.value == rule.unit)}
              onChange={(option) => {
                if (option?.value != null) section.setPollTime({ ...rule, unit: option.value as typeof rule.unit })
              }}
            />
          </>
        </>
      ) : (
        <>
          <Input
            ariaLabel={t('trigger.scheduleExpression')}
            disabled={!editable}
            monospace
            placeholder="0 * * * *"
            value={rule.expression}
            onBlur={(input) => {
              if (input.value.trim().split(/\s+/).length != 5) input.value = rule.expression
            }}
            onChange={(value) => {
              const expression = value.trim().replace(/\s+/g, ' ')
              if (expression.split(' ').length == 5) section.setPollTime({ ...rule, expression })
            }}
          />
          <Input
            ariaLabel={t('trigger.scheduleTimezone')}
            disabled={!editable}
            placeholder="UTC"
            value={rule.timezone}
            onBlur={(input) => {
              if (input.value.trim().length == 0) input.value = rule.timezone
            }}
            onChange={(value) => {
              const timezone = value.trim()
              if (timezone.length > 0) section.setPollTime({ ...rule, timezone })
            }}
          />
        </>
      )}
    </div>
  )
}

function PollScheduleEditor({ editable, pollTime, section }: { editable: boolean; pollTime: TriggerPollTime; section: TriggerSectionStore }) {
  const t = useTranslate()
  const titleId = useId()

  return (
    <section className={styles.schedule} aria-labelledby={titleId}>
      <div className={styles.scheduleHeading}>
        <h4 id={titleId}>{t('trigger.pollSchedule')}</h4>
        <p>{t('trigger.pollScheduleHelp')}</p>
      </div>
      <PollScheduleRule editable={editable} rule={pollTime} section={section} />
    </section>
  )
}

function Connection({
  connection,
  editable,
  section,
  service,
}: {
  connection: string | undefined
  editable: boolean
  section: TriggerSectionStore
  service: string
}) {
  const t = useTranslate()
  const label = <span className={styles.connectionLabel}>{t('trigger.connection')}</span>
  const connections = useConnectorServiceConnections(service)
  if (connections == null) {
    return <HandleRow level=" " name={label} value={<span title={connection}>{connection ?? t('addNode.connectorNoActiveConnection')}</span>} />
  }

  const active = connections.filter((item) => item.status == 'active')
  const selected = connection == null ? undefined : connections.find((item) => item.id == connection)
  const resolved = selected?.status == 'active'
  const options: IBasicOption[] = active.map((item) => ({ label: `${item.displayName} (${item.id})`, value: item.id }))
  if (connection != null && !resolved) {
    options.unshift({
      isDisabled: true,
      label: `${connection} (${t('blockEditor.executor.connectionUnresolved')})`,
      value: connection,
    })
  }

  return (
    <HandleRow
      level=" "
      name={label}
      value={
        <Select
          disabled={!editable || active.length == 0}
          labelInMenu={active.length == 0 ? t('addNode.connectorNoActiveConnection') : undefined}
          options={options}
          value={options.find((option) => option.value == connection)}
          variant={resolved ? 'default' : 'danger'}
          onChange={(option) => option?.value != null && section.setConnection(option.value)}
        />
      }
    />
  )
}

export const TriggerSection: React.FC<TriggerSectionProps> = /* @__PURE__ */ memo(({ section }) => {
  const t = useTranslate()
  const designerStore = useDesignerStore()
  const reactFlowStore = useStoreApi()
  const config = useVal(section.configEditor$)
  const pollTime = useVal(section.pollTime$)
  const trigger = useVal(section.trigger$)
  const editable = useVal(designerStore.$.editable)
  const connector = trigger?.definition.connector
  if (config == null && pollTime == null && connector == null) return null

  return (
    <Card name={TRIGGER_SECTION_TYPE} icon="i-carbon:settings-adjust" title={t('trigger.configuration')} contentClassName={styles.configuration}>
      {connector != null && trigger != null && (
        <Connection connection={trigger.connection} editable={editable} section={section} service={connector.service_id} />
      )}
      {config != null && (
        <HandleEditor
          store={config}
          panelWidth$={designerStore.$$.settingsPanelWidth}
          presentation="form"
          reactFlowStore={reactFlowStore}
          showSchemaSettings={false}
        />
      )}
      {pollTime != null && <PollScheduleEditor editable={editable} pollTime={pollTime} section={section} />}
    </Card>
  )
})
