import type { ManagedTaskDefinition } from '../../../../flow/common/change.ts'

import { dequal } from 'dequal/lite'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ArrayValueFields } from '../../../../form/browser/collectionValueFields.tsx'
import { FieldTable } from '../../../../form/browser/fieldTable.tsx'
import { skipDuplicatesConfigSchema } from '../../../../state/common/state.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldDescription } from '../../../../ui/browser/field.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { TaskExecutorChanges } from './taskExecutorChanges.ts'

const fieldsSchema = { type: 'array', items: { type: 'string' } } as const
const ignoreDraft = () => {}

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
  const saveRef = useRef(onSave)
  useLayoutEffect(() => {
    taskRef.current = task
    saveRef.current = onSave
  }, [task, onSave])
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
  const [fields, setFields] = useState(initial)
  const [error, setError] = useState<'invalid' | 'save'>()
  useEffect(() => {
    const previous = changes.value
    changes.sync(task.executor)
    if (previous.kind === 'skip-duplicates' && changes.value.kind === 'skip-duplicates' && !dequal(previous.fields, changes.value.fields)) {
      request.current?.abort()
      setFields(changes.value.fields)
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
    setFields(next)
    await Promise.resolve()
    if (controller.signal.aborted || request.current !== controller) return
    const normalized = next.map((field) => field.trim())
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
          <span id={`${id}-label`} className="min-w-0 flex-1">
            {t('flowState.field')}
          </span>
          {history}
        </>
      }
    >
      <div className="node-settings flex flex-col gap-3">
        <Field
          aria-labelledby={`${id}-label`}
          aria-invalid={error === 'invalid' || undefined}
          aria-describedby={`${id}-description${error === 'invalid' ? ` ${id}-error` : ''}`}
          onBlur={(event) => {
            if (event.target instanceof HTMLInputElement) void commit()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.target instanceof HTMLInputElement) void commit()
          }}
        >
          <FieldDescription id={`${id}-description`} className="text-xs">
            {t('flowState.fieldDescription')}
          </FieldDescription>
          <FieldTable layout="values" typeColumn={false} columnHeadings={false} actionSlots={2} standalone>
            <ArrayValueFields
              label={t('flowState.field')}
              showIndices={false}
              schema={fieldsSchema}
              value={fields}
              path="/fields"
              disabled={disabled}
              readOnly={disabled}
              hideValueTools
              onDraftIssue={ignoreDraft}
              onChange={(value) => {
                const next = value as string[]
                change(next)
                if (next.length !== fields.length) void commit(next)
              }}
            />
          </FieldTable>
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
      </div>
    </InspectorSection>
  )
}
