import type { ReactElement } from 'react'
import type { DelayUnit } from '../delayDuration.ts'
import type { ResolvedNode } from '../revisionView.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { delayDurationSchema } from '../../../../flow/common/delay.ts'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { delayMilliseconds, delayUnits, displayDelay } from '../delayDuration.ts'
import { InspectorSection } from './inspectorSection.tsx'

export function DelayDefinition({
  selection,
  disabled,
  store,
}: {
  readonly selection: Extract<ResolvedNode, { kind: 'delay' }>
  readonly disabled: boolean
  readonly store?: WorkspaceStore
}): ReactElement {
  const t = useTranslate()
  const [draft, setDraft] = useState(() => displayDelay(selection.node.durationMs))
  const [invalid, setInvalid] = useState(false)
  const validation = useRef<AbortController>()
  const saved = useRef(selection.node.durationMs)
  useEffect(() => {
    if (saved.current === selection.node.durationMs) return
    saved.current = selection.node.durationMs
    validation.current?.abort()
    setDraft((current) => (delayMilliseconds(current.value, current.unit) === selection.node.durationMs ? current : displayDelay(selection.node.durationMs)))
  }, [selection.node.durationMs])
  useEffect(() => {
    const request = new AbortController()
    validation.current = request
    void Promise.resolve().then(() => {
      if (!request.signal.aborted && validation.current === request)
        setInvalid(!delayDurationSchema.safeParse(delayMilliseconds(draft.value, draft.unit)).success)
    })
    return () => request.abort()
  }, [draft])
  const change = (next: typeof draft) => {
    validation.current?.abort()
    setDraft(next)
  }
  const save = (next = draft) => {
    if (!disabled && store != null) void store.nodes.saveDelay(selection.id, delayMilliseconds(next.value, next.unit))
  }
  const id = `delay-${selection.id}`
  return (
    <InspectorSection title={<FieldLabel htmlFor={id}>{t('delay.duration')}</FieldLabel>}>
      <div className="node-settings">
        <Field>
          <div className="flex items-start gap-2">
            <ValueEditorFeedback error={invalid ? t('delay.invalid') : undefined}>
              {(errorId) => (
                <Input
                  id={id}
                  type="number"
                  className="min-w-0 flex-1"
                  min={1 / delayUnits[draft.unit]}
                  step="any"
                  disabled={disabled}
                  value={draft.value}
                  aria-invalid={invalid}
                  aria-describedby={errorId}
                  onChange={(event) => change({ ...draft, value: event.target.value })}
                  onBlur={() => save()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      save()
                    }
                  }}
                />
              )}
            </ValueEditorFeedback>
            <NativeSelect
              aria-label={t('delay.unit')}
              disabled={disabled}
              value={draft.unit}
              onChange={(event) => {
                const next = { ...draft, unit: event.target.value as DelayUnit }
                change(next)
                save(next)
              }}
            >
              {Object.keys(delayUnits).map((unit) => (
                <NativeSelectOption key={unit} value={unit}>
                  {t(`delay.units.${unit}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </Field>
      </div>
    </InspectorSection>
  )
}
