import type { ReactElement } from 'react'
import type { WaitAutoContinue } from '../../../../flow/common/change.ts'
import type { ResolvedNode } from '../revisionView.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'

import { dequal } from 'dequal/lite'
import { useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { waitAutoContinueSchema } from '../../../../flow/common/wait.ts'
import { DateEditor } from '../../../../form/browser/dateEditor.tsx'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { dateInTimeZone, dateFromTimeZone, dateTimeWall } from '../../../../form/common/dateValue.ts'
import { Field, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { HelpButton } from '../../../../ui/browser/helpButton.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { NativeSelect, NativeSelectOption } from '../../../../ui/browser/native-select.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { TimeZoneSelect } from './timeZoneSelect.tsx'

interface TimingDraft {
  readonly mode: 'off' | 'after' | 'at'
  readonly value: string
  readonly timezone: string
}

function timingDraft(config: WaitAutoContinue | undefined): TimingDraft {
  const timezone = config?.kind == 'at' && config.timezone != null ? config.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone
  if (config?.kind == 'after') return { mode: 'after', value: config.durationMs == null ? '' : String(config.durationMs / 1000), timezone }
  if (config?.kind == 'at') {
    const value = waitAutoContinueSchema.safeParse(config).success ? dateTimeWall(dateInTimeZone(config.at, timezone)) : config.at
    return { mode: 'at', value, timezone }
  }
  return { mode: 'off', value: '', timezone }
}

function timing({ mode, value, timezone }: TimingDraft): WaitAutoContinue | null {
  if (mode == 'off') return null
  if (mode == 'at') return { kind: 'at', at: dateFromTimeZone(value, timezone) ?? value, timezone }
  const duration = value.trim() == '' ? null : Number(value) * 1000
  return { kind: 'after', durationMs: duration != null && Number.isFinite(duration) ? duration : null }
}

function AutoContinue({
  selection,
  disabled,
  store,
}: {
  readonly selection: Extract<ResolvedNode, { readonly kind: 'wait' }>
  readonly disabled: boolean
  readonly store?: WorkspaceStore
}): ReactElement {
  const t = useTranslate()
  const config = selection.node.autoContinue
  const [draft, setDraft] = useState(() => timingDraft(config))
  const saved = useRef({ nodeId: selection.id, config })
  const [error, setError] = useState(false)
  const request = useRef<AbortController>()
  useEffect(() => {
    if (saved.current.nodeId == selection.id && dequal(saved.current.config, config)) return
    saved.current = { nodeId: selection.id, config }
    request.current?.abort()
    setDraft(timingDraft(config))
  }, [config, selection.id])
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    void Promise.resolve().then(() => {
      if (controller.signal.aborted || request.current !== controller) return
      const candidate = timing(draft)
      setError(candidate != null && !waitAutoContinueSchema.safeParse(candidate).success)
    })
    return () => controller.abort()
  }, [draft])
  const change = (next: TimingDraft) => {
    request.current?.abort()
    setDraft(next)
  }
  const save = async (next = draft): Promise<void> => {
    if (disabled || store == null) return
    await store.nodes.saveResolution(selection.id, {
      name: selection.node.name,
      prompt: selection.node.prompt,
      autoContinue: timing(next),
    })
  }
  const { mode, value, timezone } = draft
  const id = `wait-${selection.id}-auto`
  return (
    <InspectorSection
      title={
        <>
          <FieldLabel htmlFor={id}>{t('inspector.wait.autoContinue')}</FieldLabel>
          <HelpButton label={t('inspector.wait.autoContinue')}>{t('inspector.wait.autoDescription')}</HelpButton>
        </>
      }
    >
      <div className="node-settings">
        <FieldGroup>
          <Field>
            <NativeSelect
              id={id}
              disabled={disabled}
              value={mode}
              onChange={(event) => {
                const next = { ...draft, mode: event.target.value as typeof mode, value: '' }
                change(next)
                void save(next)
              }}
            >
              <NativeSelectOption value="off">{t('inspector.wait.autoOff')}</NativeSelectOption>
              <NativeSelectOption value="after">{t('inspector.wait.autoAfter')}</NativeSelectOption>
              <NativeSelectOption value="at">{t('inspector.wait.autoAt')}</NativeSelectOption>
            </NativeSelect>
          </Field>
          {mode == 'after' && (
            <Field>
              <FieldLabel htmlFor={`${id}-value`}>{t('inspector.wait.autoSeconds')}</FieldLabel>
              <ValueEditorFeedback error={error ? t('inspector.wait.autoInvalid') : undefined}>
                {(errorId) => (
                  <Input
                    id={`${id}-value`}
                    type="number"
                    min="0.001"
                    step="0.001"
                    disabled={disabled}
                    value={value}
                    aria-invalid={error}
                    aria-describedby={errorId}
                    onChange={(event) => change({ ...draft, value: event.target.value })}
                    onBlur={() => void save()}
                    onKeyDown={(event) => {
                      if (event.key == 'Enter') {
                        event.preventDefault()
                        void save()
                      }
                    }}
                  />
                )}
              </ValueEditorFeedback>
            </Field>
          )}
          {mode == 'at' && (
            <>
              <Field>
                <FieldLabel htmlFor={`${id}-value`}>{t('inspector.wait.autoDate')}</FieldLabel>
                <ValueEditorFeedback error={error ? t('inspector.wait.autoInvalid') : undefined}>
                  {(errorId) => (
                    <DateEditor
                      id={`${id}-value`}
                      label={t('inspector.wait.autoDate')}
                      format="date-time"
                      precision="minute"
                      value={value}
                      disabled={disabled}
                      invalid={error}
                      describedBy={errorId}
                      onChange={(next) => change({ ...draft, value: dateTimeWall(next) })}
                      onCommit={(next) => void save({ ...draft, value: dateTimeWall(next) })}
                    />
                  )}
                </ValueEditorFeedback>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-timezone`}>{t('triggerSchedule.scheduleTimezone')}</FieldLabel>
                <TimeZoneSelect
                  id={`${id}-timezone`}
                  label={t('triggerSchedule.scheduleTimezone')}
                  value={timezone}
                  disabled={disabled}
                  at={new Date(dateFromTimeZone(value, timezone) ?? Date.now())}
                  onChange={(zone) => {
                    const next = { ...draft, timezone: zone }
                    change(next)
                    void save(next)
                  }}
                />
              </Field>
            </>
          )}
        </FieldGroup>
      </div>
    </InspectorSection>
  )
}

export function ResolutionDefinition({
  disabled,
  selection,
  store,
}: {
  readonly disabled: boolean
  readonly selection: Extract<ResolvedNode, { readonly kind: 'approval' | 'wait' }>
  readonly store?: WorkspaceStore
}): ReactElement {
  const t = useTranslate()
  const node = selection.node
  const [prompt, setPrompt] = useState(node.prompt)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setPrompt(node.prompt)
    setError(undefined)
  }, [node])
  const save = async (text = prompt): Promise<void> => {
    if (disabled || store == null) return
    const value = text.trim()
    if (value.length == 0 || [...value].length > 1000) {
      setError(t('inspector.wait.promptError'))
      return
    }
    setError(undefined)
    await store?.nodes.saveResolution(selection.id, { name: node.name, prompt: value })
  }
  return (
    <form
      className="inspector-form wait-form"
      data-inspector-section="resolution"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <FieldGroup>
        <Field className="inspector-field-section">
          <FieldLabel className="inspector-section-title" htmlFor={`wait-${selection.id}-prompt`}>
            {t('inspector.wait.prompt')}
          </FieldLabel>
          <Textarea
            id={`wait-${selection.id}-prompt`}
            readOnly={disabled}
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onBlur={(event) => {
              if (event.currentTarget.value.trim() != node.prompt) void save(event.currentTarget.value)
            }}
          />
        </Field>
        {error != null && <FieldError>{error}</FieldError>}
      </FieldGroup>
      {selection.kind == 'wait' && <AutoContinue selection={selection} disabled={disabled} store={store} />}
    </form>
  )
}
