import type { ReactNode } from 'react'
import type { Diagnostic, InputPort, WebhookMethod, WebhookOptions } from '../api.ts'
import type { WebhookSettings } from './flowChanges.ts'
import type { PropertyDeletion } from './propertyDeletion.ts'
import type { WorkflowResponseOutputs } from './webhookStatusSource.tsx'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { webhookResponseAllowsBody, webhookResponseTimeout } from '../../../../flow/common/webhookResponse.ts'
import { editorComponentIcons } from '../../../../form/browser/editorComponentIcon.tsx'
import { ValueControl, ValueEditorFeedback } from '../../../../form/browser/fieldControl.tsx'
import { FieldSelect } from '../../../../form/browser/fieldSelect.tsx'
import { webhookMethods, webhookSupportsBody } from '../../../../trigger/common/contract.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { Icon } from '../icons.tsx'
import { diagnosticMessage } from './diagnostics.ts'
import { InspectorSection } from './inspectorSection.tsx'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'
import { WebhookHeadersEditor } from './webhookHeadersEditor.tsx'
import { WebhookStatusSource } from './webhookStatusSource.tsx'

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
  addon,
  editor,
  error,
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
  readonly addon?: ReactNode
  readonly editor?: (id: string, errorId: string | undefined) => ReactNode
  readonly error?: string
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
  const issue = error ?? (editor == null && inspection?.draft === draft ? inspection.result.issue : undefined)
  const commit = () => {
    if (disabled || editor != null || draft === value) return
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
      <ValueControl addon={addon}>
        <ValueEditorFeedback error={issue}>
          {(errorId) =>
            editor?.(id, errorId) ?? (multiline ? <Textarea {...controlProps(errorId)} /> : <Input {...controlProps(errorId)} controlSize="field" />)
          }
        </ValueEditorFeedback>
      </ValueControl>
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

function validStatus(value: string, issue: string, signal: AbortSignal, dynamic = false): Promise<DraftInspection> {
  return deferInspection(() => {
    const normalized = value.trim()
    const status = Number(normalized)
    return {
      value: normalized,
      ...(normalized !== '' && (!Number.isInteger(status) || status < 200 || status > 599 || (dynamic && !webhookResponseAllowsBody(status))) ? { issue } : {}),
    }
  }, signal)
}

export function WebhookEditor({
  bodyFields,
  method,
  options,
  disabled,
  readOnly,
  outputSection,
  workflowOutputs,
  responseDiagnostics = [],
  onAddWorkflowOutputs,
  responseNodes = [],
  onAddResponseNode,
  onChange,
}: {
  readonly responseNodes?: readonly { readonly id: string; readonly name: string; readonly reachable: boolean }[]
  readonly onAddResponseNode?: () => void
  readonly bodyFields: readonly InputPort[]
  readonly method: WebhookMethod
  readonly options: WebhookOptions
  readonly readOnly?: boolean
  readonly disabled: boolean
  readonly workflowOutputs?: WorkflowResponseOutputs
  readonly responseDiagnostics?: readonly Diagnostic[]
  readonly onAddWorkflowOutputs?: () => void
  readonly outputSection?: ReactNode
  readonly onChange: (settings: WebhookSettings, deletion?: PropertyDeletion) => void
}) {
  const t = useTranslate()
  const policy = options.responseBody
  const response = policy?.kind === 'workflow-outputs' ? policy : undefined
  const responseNode = policy?.kind === 'webhook-response' ? policy : undefined
  const outputsMissing = responseDiagnostics.some((issue) => issue.code === 'trigger.webhook-response-outputs-missing')
  const outputsDisconnected = responseDiagnostics.some((issue) => issue.code === 'trigger.webhook-response-unreachable')
  const responseIssue =
    responseDiagnostics
      .filter((issue) => issue.path.includes('/responseBody'))
      .map((issue) => diagnosticMessage(issue, t))
      .join(' ') || undefined
  const outputDefs = workflowOutputs?.outputDefs ?? []
  const selectedMissing = response?.output != null && !outputDefs.some((port) => port.handle === response.output)
  const statusOutput = options.responseStatusCodeOutput
  const statusIssue =
    responseDiagnostics
      .filter((issue) => issue.path.endsWith('/responseStatusCodeOutput'))
      .map((issue) => diagnosticMessage(issue, t))
      .join(' ') || undefined
  const changeOption = <K extends keyof WebhookOptions>(key: K, value: WebhookOptions[K] | undefined, deletion?: PropertyDeletion) => {
    const next = { ...options }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange({ bodyFields, method, options: next }, deletion)
  }
  const statusSource =
    response == null || readOnly ? undefined : (
      <WebhookStatusSource
        outputs={workflowOutputs}
        value={statusOutput}
        disabled={disabled || outputsMissing || outputsDisconnected}
        onChange={(output) => changeOption('responseStatusCodeOutput', output)}
      />
    )
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
              readOnly={readOnly}
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
      <InspectorSection title={t('webhookEditor.webhookResponse')} className="inspector-form" data-inspector-section="trigger">
        <FieldGroup>
          <Field>
            <FieldLabel>{t('webhookEditor.webhookResponseMode')}</FieldLabel>
            <FieldSelect
              aria-label={t('webhookEditor.webhookResponseMode')}
              disabled={disabled}
              value={policy?.kind === 'webhook-response' ? 'node' : response == null ? 'immediate' : 'workflow'}
              onChange={(mode) => {
                const next = { ...options }
                if (mode === 'immediate') delete next.responseBody
                else next.responseBody = mode === 'node' ? { kind: 'webhook-response' } : { kind: 'workflow-outputs' }
                delete next.responseStatusCodeOutput
                delete next.responseHeadersSource
                delete next.responseHeaderOutputs
                onChange({ bodyFields, method, options: next })
              }}
            >
              <option value="immediate">{t('webhookEditor.webhookImmediate')}</option>
              <option value="workflow">{t('webhookEditor.webhookAfterWorkflow')}</option>
              <option value="node">{t('addNode.webhookResponse')}</option>
            </FieldSelect>
          </Field>
          {responseNode != null ? (
            <Field data-invalid={responseIssue != null || undefined}>
              <FieldLabel>{t('addNode.webhookResponse')}</FieldLabel>
              <ValueEditorFeedback error={responseIssue}>
                {(errorId) =>
                  responseNodes.length === 0 ? (
                    <Button
                      type="button"
                      variant="field"
                      size="field"
                      className="w-full justify-start"
                      data-field-control
                      data-field-prompt
                      aria-invalid={responseIssue != null || undefined}
                      aria-describedby={errorId}
                      disabled={disabled || readOnly || onAddResponseNode == null}
                      onClick={onAddResponseNode}
                    >
                      {t('webhookEditor.webhookAddResponse')}
                    </Button>
                  ) : (
                    <FieldSelect
                      showDisabledOptions
                      aria-label={t('addNode.webhookResponse')}
                      aria-describedby={errorId}
                      danger={responseIssue != null}
                      disabled={disabled || !responseNodes.some((node) => node.reachable)}
                      value={responseNode.nodeId ?? ''}
                      displayValue={
                        (responseNode.nodeId == null && !responseNodes.some((node) => node.reachable)) ||
                        responseNodes.some((node) => node.id === responseNode.nodeId && !node.reachable)
                          ? t('webhookEditor.webhookResponseDisconnected')
                          : undefined
                      }
                      onChange={(nodeId) => changeOption('responseBody', { ...responseNode, nodeId })}
                    >
                      <option value="" disabled hidden>
                        {t('webhookEditor.webhookSelectResponse')}
                      </option>
                      {responseNodes.map((node) => (
                        <option key={node.id} value={node.id} disabled={!node.reachable}>
                          {node.name}
                        </option>
                      ))}
                      {responseNode.nodeId != null && !responseNodes.some((node) => node.id === responseNode.nodeId) && (
                        <option value={responseNode.nodeId} disabled>
                          {t('webhookEditor.webhookMissingResponse')}
                        </option>
                      )}
                    </FieldSelect>
                  )
                }
              </ValueEditorFeedback>
            </Field>
          ) : response == null ? (
            <DraftTextField
              label={t('webhookEditor.webhookResponseData')}
              multiline
              value={options.responseData ?? ''}
              disabled={disabled}
              placeholder={t('webhookEditor.webhookResponseDataPlaceholder')}
              onSave={(text) => changeOption('responseData', text === '' ? undefined : text)}
            />
          ) : (
            <>
              <Field data-invalid={responseIssue != null || undefined}>
                <FieldLabel>{t('webhookEditor.webhookResponseContent')}</FieldLabel>
                <ValueEditorFeedback error={responseIssue}>
                  {(errorId) =>
                    outputsMissing ? (
                      <Button
                        type="button"
                        variant="field"
                        size="field"
                        className="w-full justify-start"
                        data-field-control
                        data-field-prompt
                        aria-invalid
                        aria-describedby={errorId}
                        disabled={disabled || readOnly || onAddWorkflowOutputs == null}
                        onClick={onAddWorkflowOutputs}
                      >
                        {t('webhookEditor.webhookAddOutputs')}
                      </Button>
                    ) : (
                      <FieldSelect
                        aria-label={t('webhookEditor.webhookResponseContent')}
                        aria-describedby={errorId}
                        danger={responseIssue != null}
                        disabled={disabled || outputsDisconnected}
                        value={response.output == null ? 'all' : `field:${response.output}`}
                        displayValue={outputsDisconnected ? t('webhookEditor.webhookOutputsDisconnected') : undefined}
                        renderOption={(value, label) => (
                          <>
                            <i
                              aria-hidden="true"
                              className={`${value === 'all' ? editorComponentIcons.object : 'i-lucide-light:corner-down-right'} size-3.5 shrink-0 text-muted-foreground`}
                            />
                            <span className={`min-w-0 flex-1 truncate ${value === 'all' ? '' : 'font-mono'}`}>{label}</span>
                          </>
                        )}
                        onChange={(value) =>
                          changeOption(
                            'responseBody',
                            value === 'all'
                              ? { kind: response.kind, ...(response.timeoutMs == null ? {} : { timeoutMs: response.timeoutMs }) }
                              : { ...response, output: value.slice(6) },
                          )
                        }
                      >
                        <option value="all">{t('webhookEditor.webhookAllOutputs')}</option>
                        {(outputDefs.length > 0 || selectedMissing) && <hr />}
                        {outputDefs.map((port) => (
                          <option key={port.handle} value={`field:${port.handle}`}>
                            {port.handle}
                          </option>
                        ))}
                        {selectedMissing && (
                          <option value={`field:${response.output}`}>{t('webhookEditor.webhookMissingOutput', { output: response.output })}</option>
                        )}
                      </FieldSelect>
                    )
                  }
                </ValueEditorFeedback>
              </Field>
            </>
          )}
          {policy != null && (
            <DraftTextField
              label={t('webhookEditor.webhookTimeout')}
              description={t('webhookEditor.webhookTimeoutDescription')}
              value={String((policy.timeoutMs ?? webhookResponseTimeout.defaultMs) / 1000)}
              disabled={disabled}
              inputMode="numeric"
              inspect={(draft, signal) =>
                deferInspection(() => {
                  const timeoutMs = Number(draft) * 1000
                  return {
                    value: draft.trim(),
                    ...(!Number.isInteger(timeoutMs) || timeoutMs < webhookResponseTimeout.minMs || timeoutMs > webhookResponseTimeout.maxMs
                      ? { issue: t('webhookEditor.webhookTimeoutInvalid') }
                      : {}),
                  }
                }, signal)
              }
              onSave={(value) => changeOption('responseBody', { ...policy, timeoutMs: Number(value) * 1000 })}
            />
          )}
          {responseNode == null && (
            <>
              <DraftTextField
                key={response == null ? 'immediate' : 'workflow'}
                label={t('webhookEditor.webhookStatus')}
                value={options.responseStatusCode?.toString() ?? ''}
                disabled={disabled}
                inputMode="numeric"
                placeholder={t('webhookEditor.webhookStatusDefault')}
                inspect={(draft, signal) =>
                  validStatus(
                    draft,
                    t(response == null ? 'webhookEditor.webhookStatusInvalid' : 'webhookEditor.webhookDynamicStatusInvalid'),
                    signal,
                    response != null,
                  )
                }
                onSave={(text) => changeOption('responseStatusCode', text === '' ? undefined : Number(text))}
                addon={statusSource}
                error={statusIssue}
                editor={
                  response != null && statusOutput != null
                    ? (id, errorId) => (
                        <Input
                          id={id}
                          controlSize="field"
                          readOnly
                          disabled={disabled}
                          aria-label={t('webhookEditor.webhookStatus')}
                          aria-invalid={statusIssue != null}
                          aria-describedby={errorId}
                          value={`${workflowOutputs?.name ?? t('addNode.outputs')} · ${statusOutput}`}
                        />
                      )
                    : undefined
                }
              />
              <WebhookHeadersEditor
                options={options}
                outputs={workflowOutputs}
                disabled={disabled}
                readOnly={readOnly}
                sourceDisabled={outputsMissing || outputsDisconnected || workflowOutputs == null}
                diagnostics={responseDiagnostics}
                onChange={(next, deletion) => onChange({ bodyFields, method, options: next }, deletion)}
              />
            </>
          )}
        </FieldGroup>
      </InspectorSection>
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
          </FieldGroup>
        </div>
      </details>
    </>
  )
}
