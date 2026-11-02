import type { ManagedTaskDefinition } from '../../../../flow/common/change.ts'

import { dequal } from 'dequal/lite'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { skipDuplicatesConfigSchema } from '../../../../state/common/state.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { TaskExecutorChanges } from './taskExecutorChanges.ts'

export function SkipDuplicatesSection({
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
  const request = useRef<AbortController>()
  const [changes] = useState(
    () =>
      new TaskExecutorChanges(task.executor, (_before, next) => {
        const current = taskRef.current
        if (next.kind !== 'skip-duplicates' || current.executor.kind !== 'skip-duplicates') return Promise.resolve(false)
        return saveRef.current(current, { ...current, executor: { ...current.executor, fields: next.fields } })
      }),
  )
  const initial = task.executor.kind === 'skip-duplicates' ? task.executor.fields : []
  const [fields, setFields] = useState(initial.length ? initial : [''])
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const focusField = useRef<number>()
  useEffect(() => {
    if (focusField.current == null) return
    inputs.current[focusField.current]?.focus()
    focusField.current = undefined
  }, [fields])
  const [error, setError] = useState<'invalid' | 'save'>()
  useEffect(() => {
    const previous = changes.value
    changes.sync(task.executor)
    if (previous.kind === 'skip-duplicates' && changes.value.kind === 'skip-duplicates' && !dequal(previous.fields, changes.value.fields)) {
      request.current?.abort()
      setFields(changes.value.fields.length ? changes.value.fields : [''])
      setError(undefined)
    }
  }, [changes, task.executor])
  useEffect(() => () => request.current?.abort(), [disabled])
  function change(next: string[]) {
    request.current?.abort()
    setFields(next)
    setError(undefined)
  }
  async function commit(next: string[] = fields) {
    if (disabled || changes.value.kind !== 'skip-duplicates') return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const rows = next.length ? next : ['']
    setFields(rows)
    await Promise.resolve()
    if (controller.signal.aborted || request.current !== controller) return
    const normalized = rows.map((field) => field.trim())
    const parsed = skipDuplicatesConfigSchema.safeParse({ fields: normalized.filter(Boolean) })
    if (!parsed.success) {
      setError('invalid')
      return
    }
    setFields(normalized)
    setError(undefined)
    changes.value = { ...changes.value, fields: parsed.data.fields }
    try {
      const saved = await changes.save()
      if (!controller.signal.aborted && request.current === controller) setError(saved ? undefined : 'save')
    } catch {
      if (!controller.signal.aborted && request.current === controller) setError('save')
    }
  }
  if (task.executor.kind !== 'skip-duplicates') return null
  return (
    <InspectorSection
      title={
        <>
          <span className="min-w-0 flex-1">{t('flowState.nodeTitle')}</span>
          {history}
        </>
      }
    >
      <div className="node-settings flex flex-col gap-3">
        <Field>
          <FieldLabel htmlFor={`${id}-field-0`}>{t('flowState.field')}</FieldLabel>
          {fields.map((field, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                ref={(element) => {
                  inputs.current[index] = element
                }}
                id={`${id}-field-${index}`}
                aria-label={t('flowState.fieldIndex', { index: index + 1 })}
                aria-invalid={error === 'invalid' || undefined}
                aria-describedby={error === 'invalid' ? `${id}-error` : undefined}
                disabled={disabled}
                value={field}
                placeholder={t(fields.length === 1 ? 'flowState.fieldPlaceholder' : 'flowState.pathPlaceholder')}
                onChange={(event) => change(fields.map((value, at) => (at === index ? event.target.value : value)))}
                onBlur={() => {
                  void commit()
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                }}
              />
              {!disabled && (fields.length > 1 || field !== '') && (
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={t('flowState.removeField', { index: index + 1 })}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    focusField.current = Math.max(0, index - 1)
                    void commit(fields.filter((_, at) => at !== index))
                  }}
                >
                  {t('flowState.delete')}
                </Button>
              )}
            </div>
          ))}
          {!disabled && (
            <div className="flex">
              <Button
                variant="ghost"
                size="sm"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const empty = fields.findIndex((field) => field.trim() === '')
                  if (empty >= 0) {
                    inputs.current[empty]?.focus()
                    return
                  }
                  focusField.current = fields.length
                  change([...fields, ''])
                }}
              >
                {t('flowState.addField')}
              </Button>
            </div>
          )}
        </Field>
        {error != null && (
          <div role="alert" id={`${id}-error`}>
            <p>{t(error === 'invalid' ? 'flowState.invalidFields' : 'flowState.saveFailed')}</p>
            {error === 'save' && (
              <Button disabled={disabled} onClick={() => void commit()} variant="outline" size="sm">
                {t('flowState.retry')}
              </Button>
            )}
          </div>
        )}
        <p className="m-0 text-muted-foreground text-xs">{t('flowState.warning')}</p>
      </div>
    </InspectorSection>
  )
}
