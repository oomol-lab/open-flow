import type { VariablePickerProps } from '../../../../ui/browser/variable-picker.tsx'
import type { InputPort, JsonValue } from '../api.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { variableInputCompatible } from '../../../../flow/common/schema.ts'
import { ValueEditor } from '../../../../form/browser/valueEditor.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldDescription, FieldLabel } from '../../../../ui/browser/field.tsx'
import { NativeSelect } from '../../../../ui/browser/native-select.tsx'
import { VariablePicker } from '../../../../ui/browser/variable-picker.tsx'
import { LlmInputEditor, supportsLlmInput } from './llmInputEditor.tsx'

export type InputVariables = Pick<VariablePickerProps, 'enabled' | 'loaded' | 'loading' | 'names' | 'onOpen'>
const draftIssue = () => {}

export function NodeInputValue({
  definition,
  handleNames = [],
  value,
  connected,
  variableName,
  variables,
  disabled,
  onValue,
  onVariable,
}: {
  readonly handleNames?: readonly string[]
  readonly definition: InputPort
  readonly value: JsonValue | undefined
  readonly connected: boolean
  readonly variableName?: string
  readonly variables: InputVariables
  readonly disabled: boolean
  readonly onValue: (value: JsonValue | undefined) => void
  readonly onVariable: (name: string | undefined) => void
}) {
  const t = useTranslate()
  const [choosingVariable, setChoosingVariable] = useState(false)
  const [rawLlm, setRawLlm] = useState(false)
  const llm = supportsLlmInput(definition.jsonSchema, value)
  const bound = variableName != null
  const variableMode = bound || choosingVariable
  const canBind = (variables.enabled && variableInputCompatible(definition.jsonSchema)) || bound
  return (
    <Field className="p-3">
      <FieldLabel>{definition.handle}</FieldLabel>
      {definition.description && <FieldDescription>{definition.description}</FieldDescription>}
      {connected ? (
        <FieldDescription>{t('nodeInput.connected')}</FieldDescription>
      ) : (
        <>
          {canBind && (
            <NativeSelect
              aria-label={`${definition.handle} ${t('nodeInput.mode')}`}
              disabled={disabled}
              value={variableMode ? 'variable' : 'literal'}
              onChange={(event) => {
                const variable = event.target.value === 'variable'
                setChoosingVariable(variable)
                if (variable) variables.onOpen()
                else if (bound) onVariable(undefined)
              }}
            >
              <option value="literal">{t('nodeInput.literal')}</option>
              <option value="variable">{t('nodeInput.variable')}</option>
            </NativeSelect>
          )}
          {canBind && variableMode ? (
            <VariablePicker {...variables} name={variableName} disabled={disabled} onChange={onVariable} />
          ) : (
            <>
              {llm && (
                <Button variant="ghost" size="sm" aria-pressed={rawLlm} onClick={() => setRawLlm(!rawLlm)}>
                  JSON
                </Button>
              )}
              {llm && !rawLlm ? (
                <LlmInputEditor schema={definition.jsonSchema} value={value} disabled={disabled} handleNames={handleNames} onChange={onValue} />
              ) : (
                <ValueEditor
                  schema={definition.jsonSchema}
                  nullable={definition.nullable}
                  value={value}
                  label={definition.handle}
                  path={`/${definition.handle.replaceAll('~', '~0').replaceAll('/', '~1')}`}
                  disabled={disabled}
                  onDraftIssue={draftIssue}
                  onChange={(next) => onValue(next as JsonValue | undefined)}
                />
              )}
            </>
          )}
        </>
      )}
    </Field>
  )
}
