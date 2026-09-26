import type { AgentInput, InputPort, JsonValue } from '../../../../flow/common/change.ts'

import { useEffect, useRef } from 'react'
import { useTranslate } from 'val-i18n-react'
import { FieldSelect } from '../../../../form/browser/fieldSelect.tsx'
import { FieldValueEditor } from '../../../../form/browser/fieldValueEditor.tsx'
import { getDefaultValue, typeOfSchema } from '../../../../form/common/schemaWidget.ts'
import { Field, FieldLabel, FieldDescription } from '../../../../ui/browser/field.tsx'

export function AgentInputSource({
  disabled,
  source,
  port,
  inputs,
  onChange,
  onValidChange,
}: {
  readonly disabled: boolean
  readonly source: AgentInput
  readonly port: InputPort
  readonly inputs: readonly InputPort[]
  readonly onChange: (source: AgentInput) => void
  readonly onValidChange: (key: string, valid: boolean) => void
}) {
  const t = useTranslate()
  const reports = useRef(new Set<string>())
  const callback = useRef(onValidChange)
  callback.current = onValidChange
  const report = (key: string, valid: boolean) => {
    reports.current.add(key)
    callback.current(key, valid)
  }
  useEffect(() => {
    const keys = reports.current
    return () => {
      for (const key of keys) callback.current(key, true)
      keys.clear()
    }
  }, [source.kind])
  const missingInput = source.kind === 'input' && !inputs.some((input) => input.handle === source.input)
  useEffect(() => {
    callback.current('reference', !missingInput)
    return () => callback.current('reference', true)
  }, [missingInput])
  const sourceControl = (
    <FieldSelect
      variant="addon"
      icons={{ model: 'i-lucide-light:bot', value: 'i-lucide-light:pencil scale-85', input: 'i-lucide-light:arrow-right-to-line' }}
      aria-label={`${port.handle} ${t('agent.source')}`}
      value={source.kind}
      disabled={disabled}
      onChange={(kind) => {
        if (kind === source.kind) return
        if (kind === 'model') onChange({ kind: 'model' })
        else if (kind === 'input') onChange({ kind: 'input', input: inputs[0]!.handle })
        else onChange({ kind: 'value', value: (getDefaultValue(typeOfSchema(port.jsonSchema), port.jsonSchema) ?? null) as JsonValue })
      }}
    >
      <option value="model">{t('agent.modelValue')}</option>
      <option value="value">{t('agent.fixed')}</option>
      <option value="input" disabled={inputs.length === 0}>
        {t('agent.nodeInput')}
      </option>
    </FieldSelect>
  )
  return (
    <Field className="min-w-0 gap-1.5">
      <FieldLabel className="text-xs font-medium">{port.handle}</FieldLabel>
      {port.description && <FieldDescription className="text-xs">{port.description}</FieldDescription>}

      <FieldValueEditor
        layout="ports"
        valueAddon={sourceControl}
        schema={port.jsonSchema}
        nullable={port.nullable}
        value={source.kind === 'value' ? source.value : undefined}
        valueEditable={source.kind !== 'input'}
        label={port.handle}
        path={port.handle}
        disabled={disabled}
        compact
        hideOptions
        unset={{ label: t('agent.modelValue'), required: false }}
        onChange={(value) => onChange(value === undefined ? { kind: 'model' } : { kind: 'value', value: value as JsonValue })}
        onDraftIssue={(path, invalid) => report(`draft:${path}`, !invalid)}
        onInvalidChange={(invalid) => report('value', !invalid)}
        editor={
          source.kind === 'input' ? (
            <FieldSelect
              aria-label={`${port.handle} ${t('agent.inputName')}`}
              value={source.input}
              disabled={disabled}
              danger={missingInput}
              onChange={(input) => onChange({ kind: 'input', input })}
            >
              {missingInput && <option value={source.input}>{source.input || t('agent.chooseInput')}</option>}
              {inputs.map((input) => (
                <option key={input.handle} value={input.handle}>
                  {input.handle}
                </option>
              ))}
            </FieldSelect>
          ) : undefined
        }
      />
    </Field>
  )
}
