import type { ReactElement } from 'react'
import type { TFunction } from 'val-i18n'
import type { RevisionView } from '../revisionView.ts'
import type { WorkspaceStore } from '../stores/workspaceStore.ts'
import type { SubflowSettings } from './flowChanges.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldError, FieldGroup, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function arrayValue<Value extends readonly unknown[]>(value: string, label: string, t: TFunction): Value {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) throw new TypeError(t('inspector.errors.portDefinitions', { label }))
  return parsed as unknown as Value
}

export function SubflowDefinition({
  definition,
  disabled,
  store,
  subflowId,
}: {
  readonly definition: NonNullable<ReturnType<RevisionView['subflow']>>
  readonly disabled: boolean
  readonly store: WorkspaceStore
  readonly subflowId: string
}): ReactElement {
  const t = useTranslate()
  const [name, setName] = useState(definition.name)
  const [inputs, setInputs] = useState(json(definition.inputs))
  const [outputs, setOutputs] = useState(json(definition.outputs))
  const [error, setError] = useState<string>()

  useEffect(() => {
    setName(definition.name)
    setInputs(json(definition.inputs))
    setOutputs(json(definition.outputs))
    setError(undefined)
  }, [definition])

  return (
    <form
      className="inspector-section inspector-form"
      onSubmit={(event) => {
        event.preventDefault()
        try {
          const nextInputs = arrayValue<SubflowSettings['inputs']>(inputs, t('inspector.subflow.inputPorts'), t)
          const nextOutputs = arrayValue<SubflowSettings['outputs']>(outputs, t('inspector.subflow.outputPorts'), t)
          setError(undefined)
          void store.saveSubflowSettings(subflowId, { inputs: nextInputs, name: name.trim(), outputs: nextOutputs })
        } catch (parseError) {
          setError(parseError instanceof TypeError ? parseError.message : t('inspector.errors.portDefinitions'))
        }
      }}
    >
      <h3>{t('inspector.subflow.definition')}</h3>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${subflowId}-name`}>{t('common.name')}</FieldLabel>
          <Input readOnly={disabled} id={`${subflowId}-name`} onChange={(event) => setName(event.target.value)} value={name} />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${subflowId}-inputs`}>{t('inspector.subflow.inputPorts')}</FieldLabel>
          <Textarea
            readOnly={disabled}
            id={`${subflowId}-inputs`}
            onChange={(event) => setInputs(event.target.value)}
            rows={8}
            spellCheck={false}
            value={inputs}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${subflowId}-outputs`}>{t('inspector.subflow.outputPorts')}</FieldLabel>
          <Textarea
            readOnly={disabled}
            id={`${subflowId}-outputs`}
            onChange={(event) => setOutputs(event.target.value)}
            rows={10}
            spellCheck={false}
            value={outputs}
          />
        </Field>
        {error != null && <FieldError>{error}</FieldError>}
      </FieldGroup>
      <div className="form-actions">
        <Button disabled={disabled || name.trim() == ''} size="sm" type="submit" variant="secondary">
          {t('inspector.subflow.save')}
        </Button>
      </div>
    </form>
  )
}
