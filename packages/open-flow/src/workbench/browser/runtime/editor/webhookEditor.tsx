import type { InputPort, WebhookOptions } from '../api.ts'
import type { WebhookSettings } from './flowChanges.ts'

import { useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Field, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { PortDefinitionEditor } from './portDefinitionEditor.tsx'

function TextField({
  label,
  value,
  disabled,
  multiline,
  onSave,
}: {
  label: string
  value: string
  disabled: boolean
  multiline?: boolean
  onSave: (value: string) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(value)
  const [previous, setPrevious] = useState(value)
  if (previous !== value) {
    setPrevious(value)
    setDraft(value)
  }
  const props = {
    id,
    disabled,
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
    onBlur: () => {
      if (!disabled && draft !== value) onSave(draft)
      setDraft(value)
    },
  }
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? <Textarea {...props} /> : <Input {...props} />}
    </Field>
  )
}

const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export function WebhookEditor({
  inputs,
  options,
  disabled,
  onChange,
}: {
  readonly inputs: readonly InputPort[]
  readonly options: WebhookOptions
  readonly disabled: boolean
  readonly onChange: (settings: WebhookSettings) => void
}) {
  const t = useTranslate()
  const headers = options.responseHeaders ?? {}
  const changeOption = <K extends keyof WebhookOptions>(key: K, value: WebhookOptions[K] | undefined) => {
    const next = { ...options }
    if (value === undefined) delete next[key]
    else next[key] = value
    onChange({ inputs, options: next })
  }
  const changeHeaders = (next: Readonly<Record<string, string>>) => changeOption('responseHeaders', Object.keys(next).length === 0 ? undefined : next)
  return (
    <section className="inspector-section" data-inspector-section="trigger">
      <h3>{t('webhookEditor.webhookRequest')}</h3>
      <FieldGroup>
        <Field>
          <FieldLabel>{t('webhookEditor.webhookMethods')}</FieldLabel>
          <div className="flex flex-wrap gap-3">
            {[...new Set([...methods, ...(options.allowedMethods ?? [])])].map((method) => (
              <Label key={method} className="flex items-center gap-2 text-sm leading-normal font-normal select-text">
                <Checkbox
                  disabled={disabled}
                  checked={(options.allowedMethods ?? ['POST']).includes(method)}
                  onCheckedChange={(checked) => {
                    const current = options.allowedMethods ?? ['POST']
                    const next = checked ? [...current, method] : current.filter((entry) => entry !== method)
                    changeOption('allowedMethods', next.length === 0 ? undefined : next)
                  }}
                />
                {method}
              </Label>
            ))}
          </div>
        </Field>
        <Field>
          <FieldLabel>{t('webhookEditor.webhookPayloadFields')}</FieldLabel>
          {inputs.length === 0 && <p className="text-sm text-muted-foreground">{t('webhookEditor.webhookNoPayloadFields')}</p>}
          <PortDefinitionEditor values={inputs} defaultNullable={false} disabled={disabled} onChange={(next) => onChange({ inputs: next, options })} />
        </Field>
        <p className="text-sm text-muted-foreground">{t('webhookEditor.webhookTestHint')}</p>
        <details>
          <summary className="cursor-pointer text-sm">{t('webhookEditor.webhookAdvanced')}</summary>
          <FieldGroup className="mt-4">
            <TextField
              label={t('webhookEditor.webhookOrigins')}
              value={options.allowedOrigins?.join(', ') ?? ''}
              disabled={disabled}
              onSave={(text) => {
                const origins = text
                  .split(',')
                  .map((origin) => origin.trim())
                  .filter(Boolean)
                changeOption('allowedOrigins', origins.length === 0 ? undefined : origins)
              }}
            />
            <TextField
              label={t('webhookEditor.webhookStatus')}
              value={options.responseStatusCode?.toString() ?? ''}
              disabled={disabled}
              onSave={(text) => {
                const value = text.trim()
                if (value === '') changeOption('responseStatusCode', undefined)
                else {
                  const status = Number(value)
                  if (Number.isInteger(status) && status >= 200 && status <= 599) changeOption('responseStatusCode', status)
                }
              }}
            />
            <Label className="flex items-center gap-2 text-sm leading-normal font-normal select-text">
              <Checkbox
                disabled={disabled}
                checked={options.noResponseBody ?? false}
                onCheckedChange={(checked) => changeOption('noResponseBody', checked ? true : undefined)}
              />
              {t('webhookEditor.webhookNoResponseBody')}
            </Label>
            <TextField
              label={t('webhookEditor.webhookResponseData')}
              multiline
              value={options.responseData ?? ''}
              disabled={disabled || options.noResponseBody === true}
              onSave={(text) => changeOption('responseData', text === '' ? undefined : text)}
            />
            <FieldLabel>{t('webhookEditor.webhookHeaders')}</FieldLabel>
            {Object.entries(headers).map(([name, value]) => (
              <FieldGroup key={name}>
                <TextField
                  label={t('webhookEditor.webhookHeaderName')}
                  value={name}
                  disabled={disabled}
                  onSave={(text) => {
                    const nextName = text.trim()
                    if (nextName === '' || nextName === name || Object.hasOwn(headers, nextName)) return
                    changeHeaders(Object.fromEntries(Object.entries(headers).map(([key, content]) => [key === name ? nextName : key, content])))
                  }}
                />
                <TextField
                  label={t('webhookEditor.webhookHeaderValue')}
                  value={value}
                  disabled={disabled}
                  onSave={(text) => changeHeaders({ ...headers, [name]: text })}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => changeHeaders(Object.fromEntries(Object.entries(headers).filter(([key]) => key !== name)))}
                >
                  {t('webhookEditor.webhookDeleteHeader')}
                </Button>
              </FieldGroup>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                let name = 'X-Header'
                let index = 2
                while (Object.hasOwn(headers, name)) name = `X-Header-${index++}`
                changeHeaders({ ...headers, [name]: '' })
              }}
            >
              {t('webhookEditor.webhookAddHeader')}
            </Button>
          </FieldGroup>
        </details>
      </FieldGroup>
    </section>
  )
}
