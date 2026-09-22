import type { ReactNode } from 'react'
import type { InputPort, WebhookMethod, WebhookOptions } from '../api.ts'
import type { WebhookSettings } from './flowChanges.ts'
import type { PropertyDeletion } from './propertyDeletion.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { FieldSelect } from '../../../../form/browser/fieldSelect.tsx'
import { webhookMethods, webhookSupportsBody } from '../../../../trigger/common/contract.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { Icon } from '../icons.tsx'
import { FieldSectionHeader } from './fieldSectionHeader.tsx'
import { InspectorSection } from './inspectorSection.tsx'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'

interface DraftInspection {
  readonly issue?: string
  readonly value: string
}

function deferInspection(check: () => DraftInspection, signal: AbortSignal): Promise<DraftInspection> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    queueMicrotask(() => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else resolve(check())
    })
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

function DraftTextField({
  label,
  value,
  disabled,
  description,
  inputMode,
  multiline,
  placeholder,
  inspect,
  onSave,
}: {
  readonly label: string
  readonly value: string
  readonly disabled: boolean
  readonly description?: string
  readonly inputMode?: React.HTMLAttributes<HTMLElement>['inputMode']
  readonly multiline?: boolean
  readonly placeholder?: string
  readonly inspect?: (value: string, signal: AbortSignal) => Promise<DraftInspection>
  readonly onSave: (value: string) => void
}) {
  const id = useId()
  const descriptionId = `${id}-description`
  const [draft, setDraft] = useState(value)
  const [previous, setPrevious] = useState(value)
  const [inspection, setInspection] = useState<{ readonly draft: string; readonly result: DraftInspection }>()
  const commitController = useRef<AbortController>()
  const inspectRef = useRef(inspect)
  inspectRef.current = inspect
  if (previous !== value) {
    setPrevious(value)
    setDraft(value)
  }
  useEffect(() => {
    if (inspectRef.current == null) {
      setInspection(undefined)
      return
    }
    const controller = new AbortController()
    void inspectRef.current(draft, controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setInspection({ draft, result })
      },
      () => {},
    )
    return () => controller.abort()
  }, [draft])
  useEffect(() => () => commitController.current?.abort(), [])
  const issue = inspection?.draft === draft ? inspection.result.issue : undefined
  const commit = () => {
    if (disabled || draft === value) return
    commitController.current?.abort()
    const controller = new AbortController()
    commitController.current = controller
    const validation: Promise<DraftInspection> = inspectRef.current?.(draft, controller.signal) ?? Promise.resolve({ value: draft })
    void validation.then(
      (result) => {
        if (controller.signal.aborted) return
        setInspection({ draft, result })
        if (result.issue == null) onSave(result.value)
      },
      () => {},
    )
  }
  const controlProps = (errorId: string | undefined) => ({
    id,
    'aria-describedby': [description == null ? undefined : descriptionId, errorId].filter(Boolean).join(' ') || undefined,
    'aria-invalid': issue != null || undefined,
    'className': 'placeholder:text-muted-foreground/60',
    disabled,
    inputMode,
    placeholder,
    'value': draft,
    'onChange': (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      commitController.current?.abort()
      setDraft(event.target.value)
    },
    'onBlur': commit,
    'onKeyDown': (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !multiline) event.currentTarget.blur()
      else if (event.key === 'Escape') {
        commitController.current?.abort()
        setDraft(value)
        event.preventDefault()
      }
    },
  })
  return (
    <Field data-invalid={issue != null || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <ValueEditorFeedback error={issue}>
        {(errorId) => (multiline ? <Textarea {...controlProps(errorId)} /> : <Input {...controlProps(errorId)} controlSize="field" />)}
      </ValueEditorFeedback>
      {description != null && (
        <FieldDescription id={descriptionId} className="px-2 text-[11px] leading-4">
          {description}
        </FieldDescription>
      )}
    </Field>
  )
}

function validOriginList(value: string, issue: string, signal: AbortSignal): Promise<DraftInspection> {
  return deferInspection(() => {
    const origins = value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
    const invalid = origins.some((origin) => {
      if (origin === '*') return false
      try {
        const url = new URL(origin)
        return (url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== origin
      } catch {
        return true
      }
    })
    return { value: origins.join(', '), ...(invalid ? { issue } : {}) }
  }, signal)
}

function validStatus(value: string, issue: string, signal: AbortSignal): Promise<DraftInspection> {
  return deferInspection(() => {
    const normalized = value.trim()
    const status = Number(normalized)
    return {
      value: normalized,
      ...(normalized !== '' && (!Number.isInteger(status) || status < 200 || status > 599) ? { issue } : {}),
    }
  }, signal)
}

function validHeaderName(
  value: string,
  current: string,
  headers: Readonly<Record<string, string>>,
  messages: { readonly invalid: string; readonly duplicate: string },
  signal: AbortSignal,
): Promise<DraftInspection> {
  return deferInspection(() => {
    const normalized = value.trim()
    if (normalized === '') return { value: normalized, issue: messages.invalid }
    if (hasHeader(headers, normalized, current)) return { value: normalized, issue: messages.duplicate }
    try {
      const parsed = new Headers([[normalized, 'value']])
      void parsed
      return { value: normalized }
    } catch {
      return { value: normalized, issue: messages.invalid }
    }
  }, signal)
}

function hasHeader(headers: Readonly<Record<string, string>>, candidate: string, except?: string): boolean {
  const normalized = candidate.toLowerCase()
  return Object.keys(headers).some((name) => name !== except && name.toLowerCase() === normalized)
}

export function WebhookEditor({
  bodyFields,
  method,
  options,
  disabled,
  outputSection,
  onChange,
}: {
  readonly bodyFields: readonly InputPort[]
  readonly method: WebhookMethod
  readonly options: WebhookOptions
  readonly disabled: boolean
  readonly outputSection?: ReactNode
  readonly onChange: (settings: WebhookSettings, deletion?: PropertyDeletion) => void
}) {
  const t = useTranslate()
  const headers = options.responseHeaders ?? {}
  const changeOption = <K extends keyof WebhookOptions>(key: K, value: WebhookOptions[K] | undefined, deletion?: PropertyDeletion) => {
    const next = { ...options }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange({ bodyFields, method, options: next }, deletion)
  }
  const changeHeaders = (next: Readonly<Record<string, string>>, deletion?: PropertyDeletion) =>
    changeOption('responseHeaders', Object.keys(next).length === 0 ? undefined : next, deletion)
  const addHeader = () => {
    let name = 'X-Header'
    let index = 2
    while (hasHeader(headers, name)) name = `X-Header-${index++}`
    changeHeaders({ ...headers, [name]: '' })
  }
  return (
    <>
      <InspectorSection title={t('webhookEditor.webhookRequest')} className="inspector-form" data-inspector-section="trigger">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('webhookEditor.webhookMethod')}</FieldLabel>
            <FieldSelect
              aria-label={t('webhookEditor.webhookMethod')}
              disabled={disabled}
              value={method}
              onChange={(value) => {
                const next = value as WebhookMethod
                if (next === method) return
                const supportsBody = webhookSupportsBody(next)
                onChange(
                  { bodyFields: supportsBody ? bodyFields : [], method: next, options },
                  !supportsBody && bodyFields.length > 0 ? { target: 'webhookBody' } : undefined,
                )
              }}
            >
              {webhookMethods.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </FieldSelect>
          </Field>
          {webhookSupportsBody(method) && (
            <PortDefinitionEditor
              layout="ports"
              title={t('webhookEditor.webhookBodyFields')}
              emptyMessage={t('webhookEditor.webhookNoBodyFields')}
              embedded
              values={bodyFields}
              defaultNullable={false}
              disabled={disabled}
              onChange={(next, deletion) => onChange({ bodyFields: next, method, options }, deletion)}
            />
          )}
        </FieldGroup>
      </InspectorSection>
      {outputSection}
      <details className="inspector-disclosure" data-inspector-section="trigger">
        <summary>
          <Icon name="chevron-down" size={14} />
          <span className="inspector-disclosure-summary">
            <strong className="inspector-section-title-text">{t('webhookEditor.webhookAdvanced')}</strong>
          </span>
        </summary>
        <div className="inspector-disclosure-content inspector-form">
          <FieldGroup>
            <DraftTextField
              label={t('webhookEditor.webhookOrigins')}
              value={options.allowedOrigins?.join(', ') ?? ''}
              disabled={disabled}
              description={t('webhookEditor.webhookOriginsHint')}
              placeholder="https://example.com, *"
              inspect={(draft, signal) => validOriginList(draft, t('webhookEditor.webhookOriginsInvalid'), signal)}
              onSave={(text) => changeOption('allowedOrigins', text === '' ? undefined : text.split(', '))}
            />
            <DraftTextField
              label={t('webhookEditor.webhookStatus')}
              value={options.responseStatusCode?.toString() ?? ''}
              disabled={disabled}
              inputMode="numeric"
              placeholder={t('webhookEditor.webhookStatusDefault')}
              inspect={(draft, signal) => validStatus(draft, t('webhookEditor.webhookStatusInvalid'), signal)}
              onSave={(text) => changeOption('responseStatusCode', text === '' ? undefined : Number(text))}
            />
            <DraftTextField
              label={t('webhookEditor.webhookResponseData')}
              multiline
              value={options.responseData ?? ''}
              disabled={disabled}
              placeholder={t('webhookEditor.webhookResponseDataPlaceholder')}
              onSave={(text) => changeOption('responseData', text === '' ? undefined : text)}
            />
            <Field>
              <FieldSectionHeader
                compact
                title={t('webhookEditor.webhookHeaders')}
                disabled={disabled}
                canSort={false}
                sorting={false}
                onToggleSorting={() => {}}
                addLabel={t('webhookEditor.webhookAddHeader')}
                onAdd={addHeader}
              />
              {Object.keys(headers).length === 0 ? (
                <p className="m-0 pl-4 text-xs text-muted-foreground">{t('webhookEditor.webhookNoHeaders')}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] gap-2 text-xs text-muted-foreground">
                    <span>{t('webhookEditor.webhookHeaderName')}</span>
                    <span>{t('webhookEditor.webhookHeaderValue')}</span>
                    <span />
                  </div>
                  {Object.entries(headers).map(([name, value]) => (
                    <div key={name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_28px] items-start gap-2 [&_[data-slot=field-label]]:sr-only">
                      <DraftTextField
                        label={t('webhookEditor.webhookHeaderName')}
                        value={name}
                        disabled={disabled}
                        inspect={(draft, signal) =>
                          validHeaderName(
                            draft,
                            name,
                            headers,
                            {
                              invalid: t('webhookEditor.webhookHeaderNameInvalid'),
                              duplicate: t('webhookEditor.webhookHeaderNameDuplicate'),
                            },
                            signal,
                          )
                        }
                        onSave={(nextName) => {
                          if (nextName === name) return
                          changeHeaders(Object.fromEntries(Object.entries(headers).map(([key, content]) => [key === name ? nextName : key, content])))
                        }}
                      />
                      <DraftTextField
                        label={t('webhookEditor.webhookHeaderValue')}
                        value={value}
                        disabled={disabled}
                        onSave={(text) => changeHeaders({ ...headers, [name]: text })}
                      />
                      {!disabled && (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                aria-label={t('webhookEditor.webhookDeleteHeader')}
                                onClick={() =>
                                  changeHeaders(Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name)), {
                                    target: 'objectItem',
                                    name,
                                  })
                                }
                              />
                            }
                          >
                            <i aria-hidden="true" className="i-lucide-light:trash-2 text-base" />
                          </TooltipTrigger>
                          <TooltipContent>{t('webhookEditor.webhookDeleteHeader')}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Field>
          </FieldGroup>
        </div>
      </details>
    </>
  )
}
