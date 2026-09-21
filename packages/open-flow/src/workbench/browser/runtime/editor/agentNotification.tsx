import type { SetStateAction } from 'react'
import type { InputPort, ManagedTaskExecutor } from '../../../../flow/common/change.ts'
import type { WorkbenchTheme } from '../contract.ts'
import type { RevisionView } from '../revisionView.ts'

import { useTranslate } from 'val-i18n-react'
import { Field, FieldLabel, FieldDescription } from '../../../../ui/browser/field.tsx'
import { WorkbenchSelect } from '../shell/workbenchSelect.tsx'
import { AgentInputSource } from './agentInputSource.tsx'

export function AgentNotification({
  config,
  setConfig,
  disabled,
  portalRoot,
  inputs,
  theme,
  validity,
  save,
  revision,
}: {
  readonly config: Extract<ManagedTaskExecutor, { kind: 'agent' }>
  readonly setConfig: (value: SetStateAction<ManagedTaskExecutor>, commit?: boolean) => void
  readonly disabled: boolean
  readonly portalRoot: HTMLElement | null
  readonly inputs: readonly InputPort[]
  readonly theme: WorkbenchTheme
  readonly validity: (key: string, valid: boolean) => void
  readonly save: () => void
  readonly revision: RevisionView
}) {
  const t = useTranslate()
  const notifications = revision.tasks().filter(([, item]) => 'executor' in item && item.executor.kind == 'connector')
  const notificationTask = config.notification == null ? undefined : revision.task(config.notification.taskId)

  return (
    <>
      {' '}
      <Field>
        <FieldLabel>{t('agent.notification')}</FieldLabel>
        <WorkbenchSelect
          size="sm"
          variant="subtle"
          ariaLabel={t('agent.notification')}
          value={config.notification?.taskId ?? ''}
          onValueChange={(value) => {
            const { notification: _notification, ...rest } = config
            const selected = revision.task(value)
            const message = selected?.inputs.find(
              (port) =>
                'handle' in port &&
                typeof port.jsonSchema == 'object' &&
                port.jsonSchema != null &&
                'type' in port.jsonSchema &&
                port.jsonSchema.type == 'string',
            )
            if (value == '') setConfig(rest)
            else
              setConfig({
                ...rest,
                notification: { taskId: value, messageHandle: message != null && 'handle' in message ? message.handle : '', inputs: {} },
              })
          }}
          disabled={disabled}
          portalRoot={portalRoot}
          className="w-full min-w-0"
          options={[{ value: '', label: t('agent.noNotification') }, ...notifications.map(([id, item]) => ({ value: id, label: item.name }))]}
        />
        <FieldDescription>{t('agent.notificationHint')}</FieldDescription>
      </Field>
      {config.notification != null && notificationTask != null && (
        <>
          <Field>
            <FieldLabel>{t('agent.messageField')}</FieldLabel>
            <WorkbenchSelect
              size="sm"
              variant="subtle"
              ariaLabel={t('agent.messageField')}
              value={config.notification.messageHandle}
              onValueChange={(value) => {
                if (config.notification == null) return
                setConfig({ ...config, notification: { ...config.notification, messageHandle: value } })
              }}
              disabled={disabled}
              portalRoot={portalRoot}
              className="w-full min-w-0"
              options={[
                { value: '', label: t('agent.chooseInput') },
                ...notificationTask.inputs.flatMap((port) =>
                  'handle' in port &&
                  typeof port.jsonSchema == 'object' &&
                  port.jsonSchema != null &&
                  'type' in port.jsonSchema &&
                  port.jsonSchema.type == 'string'
                    ? [{ value: port.handle, label: port.handle }]
                    : [],
                ),
              ]}
            />
          </Field>
          {notificationTask.inputs.flatMap((port) =>
            !('handle' in port) || port.handle == config.notification?.messageHandle
              ? []
              : [
                  <Field key={port.handle}>
                    <FieldLabel id={`notice-${port.handle}-label`}>{port.handle}</FieldLabel>
                    <AgentInputSource
                      disabled={disabled}
                      portalRoot={portalRoot}
                      labelledBy={`notice-${port.handle}-label`}
                      model={false}
                      port={port}
                      inputs={inputs}
                      theme={theme}
                      onValidChange={(valid) => validity(`notice:${port.handle}`, valid)}
                      source={config.notification?.inputs[port.handle] ?? { kind: 'value', value: port.value ?? null }}
                      onCommit={save}
                      onChange={(source, commit) => {
                        if (source.kind == 'model') return
                        setConfig(
                          (current) =>
                            current.kind != 'agent' || current.notification == null
                              ? current
                              : {
                                  ...current,
                                  notification: { ...current.notification, inputs: { ...current.notification.inputs, [port.handle]: source } },
                                },
                          commit,
                        )
                      }}
                    />
                  </Field>,
                ],
          )}
        </>
      )}
    </>
  )
}
