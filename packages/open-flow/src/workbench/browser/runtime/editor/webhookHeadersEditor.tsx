import type { Diagnostic, WebhookOptions } from '../api.ts'
import type { PropertyDeletion } from './propertyDeletion.ts'
import type { WorkflowResponseOutputs } from './webhookStatusSource.tsx'

import { useTranslate } from 'val-i18n-react'
import { webhookHeaderNameIssue, webhookHeaderValuePort, webhookHeadersPort } from '../../../../flow/common/webhookResponse.ts'
import { FieldTable } from '../../../../form/browser/fieldTable.tsx'
import { FieldValueEditor } from '../../../../form/browser/fieldValueEditor.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { diagnosticMessage } from './diagnostics.ts'
import { SourceValueControl } from './sourceValueEditor.tsx'
import { WebhookResponseSource } from './webhookStatusSource.tsx'

const headersSchema = { type: 'object', additionalProperties: { type: 'string' } } as const
const ignoreDraft = () => {}
const expanded = () => true

export function WebhookHeadersEditor({
  options,
  outputs,
  disabled,
  readOnly,
  sourceDisabled,
  diagnostics,
  onChange,
}: {
  readonly options: WebhookOptions
  readonly outputs?: WorkflowResponseOutputs
  readonly disabled: boolean
  readonly readOnly?: boolean
  readonly sourceDisabled: boolean
  readonly diagnostics: readonly Diagnostic[]
  readonly onChange: (options: WebhookOptions, deletion?: PropertyDeletion) => void
}) {
  const t = useTranslate()
  const whole = options.responseHeadersSource
  const bindings = options.responseHeaderOutputs ?? {}
  const fixed = options.responseHeaders ?? {}
  const headers = {
    ...fixed,
    ...Object.fromEntries(
      Object.keys(bindings)
        .filter((name) => !Object.keys(fixed).some((key) => key.toLowerCase() === name.toLowerCase()))
        .map((name) => [name, '']),
    ),
  }
  const label = t('webhookEditor.webhookHeaders')
  const issue = (suffix: string) =>
    diagnostics
      .filter((item) => item.path.endsWith(suffix))
      .map((item) => diagnosticMessage(item, t))
      .join(' ') || undefined
  const binding = (name: string) => {
    const key = Object.keys(bindings).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
    return key == null ? undefined : { output: bindings[key]!, error: issue(`/responseHeaderOutputs/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`) }
  }
  const sourceLabel = (output?: string) => `${outputs?.name ?? t('addNode.outputs')} · ${output ?? t('inspector.sources.wholeObject')}`
  const selected = (output: string | undefined, error?: string, fieldLabel = label) => (
    <SourceValueControl name={fieldLabel} label={sourceLabel(output)} description={sourceLabel(output)} node icon={outputs?.icon} error={error} />
  )
  const source = (name?: string) =>
    options.responseBody == null || readOnly ? undefined : (
      <WebhookResponseSource
        label={name == null ? t('webhookEditor.webhookHeadersSource') : `${name} ${t('inspector.sources.select')}`}
        outputs={outputs}
        disabled={disabled || sourceDisabled}
        wholeObject={name == null}
        port={name == null ? webhookHeadersPort : webhookHeaderValuePort}
        value={name == null ? whole : binding(name)}
        onChange={(next) => {
          const updated = { ...options }
          if (name == null) {
            if (next == null) delete updated.responseHeadersSource
            else updated.responseHeadersSource = { kind: 'workflow-outputs', ...next }
          } else {
            const values = Object.fromEntries([
              ...Object.entries(bindings).filter(([key]) => key.toLowerCase() !== name.toLowerCase()),
              ...(next == null ? [] : [[name, next.output!]]),
            ])
            if (Object.keys(values).length === 0) delete updated.responseHeaderOutputs
            else updated.responseHeaderOutputs = values
          }
          onChange(updated)
        }}
      />
    )
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <FieldTable layout="values" typeColumn={false} columnHeadings={false} actionSlots={2} standalone>
        <FieldValueEditor
          label={label}
          valueOnly
          schema={headersSchema}
          value={headers}
          path="/responseHeaders"
          disabled={disabled}
          readOnly={readOnly}
          hideOptions
          hideValueTools
          hideChildTypes
          validationErrors={diagnostics
            .filter((item) => item.path.includes('/responseHeaderOutputs') || item.path.endsWith('/responseHeaders'))
            .map((item) => ({
              instancePath: item.path.includes('/responseHeaderOutputs/')
                ? item.path.slice(item.path.indexOf('/responseHeaderOutputs/') + '/responseHeaderOutputs'.length)
                : '',
              message: diagnosticMessage(item, t),
            }))}
          expansionPolicy={expanded}
          onDraftIssue={ignoreDraft}
          valueAddon={source()}
          editor={whole == null ? undefined : selected(whole.output, issue('/responseHeadersSource'))}
          validateObjectFieldName={(name, current) =>
            webhookHeaderNameIssue(
              name,
              Object.keys(headers).filter((candidate) => candidate !== current),
            ) == null
          }
          renderObjectField={(name, props) => {
            const reference = binding(name)
            return (
              <FieldValueEditor
                {...props}
                hideValueTools
                valueAddon={source(name)}
                editor={reference == null ? undefined : selected(reference.output, reference.error, name)}
              />
            )
          }}
          onChange={(value, deletion) => {
            const next = (value as Record<string, string> | undefined) ?? {}
            const removed = Object.keys(headers).filter((name) => !Object.hasOwn(next, name))
            const added = Object.keys(next).filter((name) => !Object.hasOwn(headers, name))
            const nextBindings = Object.fromEntries(
              Object.entries(bindings).flatMap(([key, output]) => {
                if (!removed.some((name) => name.toLowerCase() === key.toLowerCase())) return [[key, output]]
                return removed.length === 1 && added.length === 1 ? [[added[0]!, output]] : []
              }),
            )
            const updated = { ...options }
            if (Object.keys(next).length === 0) delete updated.responseHeaders
            else updated.responseHeaders = next
            if (Object.keys(nextBindings).length === 0) delete updated.responseHeaderOutputs
            else updated.responseHeaderOutputs = nextBindings
            onChange(updated, deletion)
          }}
        />
      </FieldTable>
    </Field>
  )
}
