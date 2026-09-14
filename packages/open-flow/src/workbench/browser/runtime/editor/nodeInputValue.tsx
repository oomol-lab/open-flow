import type { ReactNode } from 'react'
import type { ValueEditorProps } from '../../../../form/browser/valueEditor.tsx'
import type { VariablePickerProps } from '../../../../ui/browser/variable-picker.tsx'
import type { InputPort, JsonValue } from '../api.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { variableInputCompatible } from '../../../../flow/common/schema.ts'
import { ValueEditor } from '../../../../form/browser/valueEditor.tsx'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldDescription, FieldLabel } from '../../../../ui/browser/field.tsx'
import { NativeSelect } from '../../../../ui/browser/native-select.tsx'
import { Popover, PopoverPanelContent, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { VariablePicker } from '../../../../ui/browser/variable-picker.tsx'
import { fieldPanelAnchor } from './fieldPanelAnchor.ts'
import { LlmInputEditor, supportsLlmInput } from './llmInputEditor.tsx'

export type InputVariables = Pick<VariablePickerProps, 'enabled' | 'loaded' | 'loading' | 'names' | 'onOpen'>
const draftIssue = () => {}

export function NodeInputValue({
  definition,
  presentation,
  sourceOptions,
  embedded = false,
  handleNames = [],
  value,
  connected,
  variableName,
  variables,
  disabled,
  onValue,
  onVariable,
}: {
  readonly presentation?: Pick<ValueEditorProps, 'header' | 'leadingControl' | 'description' | 'options'>
  readonly sourceOptions?: ReactNode
  readonly embedded?: boolean
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
  const [sourceContainer, setSourceContainer] = useState<HTMLDivElement | null>(null)
  const [choosingVariable, setChoosingVariable] = useState(false)
  const llm = supportsLlmInput(definition.jsonSchema, value)
  const bound = variableName != null
  const variableMode = bound || choosingVariable
  const canBind = (variables.enabled && variableInputCompatible(definition.jsonSchema)) || bound
  const options = (
    <div className="flex flex-col gap-2">
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
      {presentation?.options}
    </div>
  )
  const editor = connected ? (
    (sourceOptions ?? <FieldDescription>{t(embedded ? 'inspector.ports.connected' : 'nodeInput.connected')}</FieldDescription>)
  ) : canBind && variableMode ? (
    <VariablePicker {...variables} name={variableName} disabled={disabled} onChange={onVariable} />
  ) : llm ? (
    <LlmInputEditor schema={definition.jsonSchema} value={value} disabled={disabled} handleNames={handleNames} onChange={onValue} />
  ) : undefined
  return (
    <Field className={embedded ? 'gap-0' : 'p-3'}>
      {!embedded && <FieldLabel>{definition.handle}</FieldLabel>}
      <ValueEditor
        {...presentation}
        options={options}
        actions={
          sourceOptions != null && !connected ? (
            <div ref={setSourceContainer}>
              <Popover>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      disabled={disabled}
                      aria-label={`${definition.handle} ${t('inspector.sources.title')}`}
                    />
                  }
                >
                  <i aria-hidden="true" className="i-lucide-light:link" />
                </PopoverTrigger>
                <PopoverPanelContent
                  container={sourceContainer?.closest<HTMLElement>('.editor-context-panel') ?? sourceContainer}
                  anchor={() => fieldPanelAnchor(sourceContainer?.closest('[data-port]') ?? sourceContainer)}
                  title={`${definition.handle} · ${t('inspector.sources.title')}`}
                  closeLabel={t('common.close')}
                >
                  {sourceOptions}
                </PopoverPanelContent>
              </Popover>
            </div>
          ) : undefined
        }
        description={presentation?.description ?? definition.description}
        schema={definition.jsonSchema}
        nullable={definition.nullable}
        value={value}
        label={definition.handle}
        path={`/${definition.handle.replaceAll('~', '~0').replaceAll('/', '~1')}`}
        disabled={disabled}
        valueEditable={!connected && !variableMode}
        editor={editor}
        onDraftIssue={draftIssue}
        onChange={(next) => onValue(next as JsonValue | undefined)}
      />
    </Field>
  )
}
