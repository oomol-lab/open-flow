import type { ReactNode } from 'react'
import type { ConnectorProxyConfig } from '../../../../connector/common/proxy.ts'
import type { ManagedTaskDefinition } from '../../../../flow/common/change.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { connectorProxyIssues, connectorProxySupportsBody, connectorProxyTask } from '../../../../connector/common/proxy.ts'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { TaskExecutorChanges } from './taskExecutorChanges.ts'

export function ConnectorProxySection({
  task,
  disabled,
  readOnly = false,
  hasBody,
  parameters,
  input,
  onSave,
  onClearBody,
}: {
  task: ManagedTaskDefinition
  disabled: boolean
  readOnly?: boolean
  hasBody: boolean
  parameters: ReactNode
  input: (handle: string, label: string) => ReactNode
  onSave: (before: ManagedTaskDefinition, next: ManagedTaskDefinition) => Promise<boolean>
  onClearBody: () => Promise<boolean>
}) {
  const t = useTranslate()
  const id = useId()
  const taskRef = useRef(task)
  const saveRef = useRef(onSave)
  useEffect(() => {
    taskRef.current = task
    saveRef.current = onSave
  }, [task, onSave])
  const [changes] = useState(
    () =>
      new TaskExecutorChanges(task.executor, (before, next) => {
        const current = taskRef.current
        if (before.kind !== 'connector-proxy' || next.kind !== 'connector-proxy' || current.executor.kind !== 'connector-proxy') return Promise.resolve(false)
        const merged = { ...current.executor }
        if (before.method !== next.method) merged.method = next.method
        return saveRef.current(current, connectorProxyTask(merged, current.name, current))
      }),
  )
  const [config, setConfig] = useState(changes.value)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    changes.sync(task.executor)
    setConfig(changes.value)
  }, [changes, task.executor])
  if (config.kind !== 'connector-proxy') return null
  const supportsBody = connectorProxySupportsBody(config.method)
  const bodyError =
    task.executor.kind === 'connector-proxy' &&
    task.executor.method === config.method &&
    connectorProxyIssues(config, hasBody).some((issue) => issue.code === 'bodyUnsupported')
  async function save() {
    try {
      setFailed(!(await changes.save()))
    } catch {
      setFailed(true)
    }
  }
  function update(patch: Partial<ConnectorProxyConfig>) {
    if (disabled || changes.value.kind !== 'connector-proxy') return
    changes.value = { ...changes.value, ...patch }
    setConfig(changes.value)
    void save()
  }
  return (
    <InspectorSection title={t('connectorProxy.title')} data-inspector-section="task">
      <div className="node-settings flex flex-col gap-3" data-value-editor-scope>
        {input('endpoint', t('connectorProxy.endpoint'))}
        <Field>
          <FieldLabel htmlFor={`${id}-method`}>{t('httpRequest.method')}</FieldLabel>
          <NativeSelect
            id={`${id}-method`}
            value={config.method}
            disabled={disabled}
            className="w-full"
            onChange={(event) => update({ method: event.target.value as ConnectorProxyConfig['method'] })}
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
              <NativeSelectOption key={method} value={method}>
                {method}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {parameters}
        {supportsBody && input('body', t('httpRequest.body'))}
        {bodyError && (
          <div className="flex flex-col gap-2">
            <p id={`${id}-body-error`} role="alert" className="text-xs text-destructive">
              {t('connectorProxy.bodyUnsupported')}
            </p>
            {!readOnly && (
              <Button variant="outline" size="field" disabled={disabled} aria-describedby={`${id}-body-error`} onClick={() => void onClearBody()}>
                {t('valueEditor.clear')} {t('httpRequest.body')}
              </Button>
            )}
          </div>
        )}
        {failed && (
          <ValueEditorFeedback error={t('httpRequest.saveFailed')}>
            {(errorId) => (
              <Button variant="outline" size="field" aria-invalid aria-describedby={errorId} disabled={disabled} onClick={() => void save()}>
                {t('httpRequest.retry')}
              </Button>
            )}
          </ValueEditorFeedback>
        )}
      </div>
    </InspectorSection>
  )
}
