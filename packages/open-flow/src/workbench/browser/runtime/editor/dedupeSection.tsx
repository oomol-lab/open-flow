import type { ManagedTaskDefinition } from '../../../../flow/common/change.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { TaskExecutorChanges } from './taskExecutorChanges.ts'

export function DedupeSection({
  task,
  disabled,
  onSave,
  history,
}: {
  task: ManagedTaskDefinition
  disabled: boolean
  onSave: (before: ManagedTaskDefinition, value: ManagedTaskDefinition) => Promise<boolean>
  history?: import('react').ReactNode
}) {
  const t = useTranslate()
  const id = useId()
  const taskRef = useRef(task)
  taskRef.current = task
  const saveRef = useRef(onSave)
  saveRef.current = onSave
  const [changes] = useState(
    () =>
      new TaskExecutorChanges(task.executor, (before, next) => {
        const current = taskRef.current
        if (before.kind !== 'dedupe' || next.kind !== 'dedupe' || current.executor.kind !== 'dedupe') return Promise.resolve(false)
        const executor = { ...current.executor }
        for (const key of ['field', 'mode', 'space'] as const) {
          if (before[key] !== next[key]) Object.assign(executor, { [key]: next[key] })
        }
        return saveRef.current(current, { ...current, executor })
      }),
  )
  const [config, setConfig] = useState(changes.value)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    changes.sync(task.executor)
    setConfig(changes.value)
  }, [changes, task.executor])
  async function save() {
    try {
      setFailed(!(await changes.save()))
    } catch {
      setFailed(true)
    }
  }
  function update(patch: Partial<import('../../../../state/common/state.ts').DedupeConfig>) {
    if (disabled || changes.value.kind !== 'dedupe') return
    changes.value = { ...changes.value, ...patch }
    setConfig(changes.value)
    void save()
  }
  if (config.kind !== 'dedupe') return null
  return (
    <InspectorSection title={t('flowState.nodeTitle')}>
      <div className="node-settings flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">{t('flowState.warning')}</p>
        <Field>
          <FieldLabel htmlFor={`${id}-field`}>{t('flowState.field')}</FieldLabel>
          <Input
            key={config.field}
            id={`${id}-field`}
            disabled={disabled}
            defaultValue={config.field}
            onBlur={(event) => {
              if (event.target.value !== config.field) update({ field: event.target.value })
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-mode`}>{t('flowState.mode')}</FieldLabel>
          <NativeSelect
            id={`${id}-mode`}
            disabled={disabled}
            value={config.mode}
            onChange={(event) => update({ mode: event.target.value as 'new' | 'increasing' })}
          >
            <NativeSelectOption value="new">{t('flowState.new')}</NativeSelectOption>
            <NativeSelectOption value="increasing">{t('flowState.increasing')}</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-space`}>{t('flowState.space')}</FieldLabel>
          <NativeSelect
            id={`${id}-space`}
            disabled={disabled}
            value={config.space}
            onChange={(event) => update({ space: event.target.value as 'node' | 'flow' })}
          >
            <NativeSelectOption value="node">{t('flowState.nodeSpace')}</NativeSelectOption>
            <NativeSelectOption value="flow">{t('flowState.flowSpace')}</NativeSelectOption>
          </NativeSelect>
        </Field>
        {failed && (
          <div role="alert">
            <p>{t('httpRequest.saveFailed')}</p>
            <Button disabled={disabled} onClick={() => void save()} variant="outline" size="sm">
              {t('httpRequest.retry')}
            </Button>
          </div>
        )}
        {history}
      </div>
    </InspectorSection>
  )
}
