import type { ReactElement } from 'react'
import type { AgentInput, InputPort, JsonValue } from '../../../../flow/common/change.ts'
import type { WorkbenchTheme } from '../contract.ts'

import { lazy, Suspense, useCallback, useEffect, useRef } from 'react'
import { useLang, useTranslate } from 'val-i18n-react'
import { getDefaultValue, typeOfSchema } from '../../../../form/common/schemaWidget.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { FieldDescription } from '../../../../ui/browser/field.tsx'
import { WorkbenchSelect } from '../shell/workbenchSelect.tsx'

const InputValues = lazy(async () => {
  const module = await import('./inputValues.tsx')
  return { default: module.InputValues }
})

export function AgentInputSource({
  disabled,
  portalRoot,
  source,
  port,
  inputs,
  model,
  theme,
  onChange,
  onValidChange,
  onCommit,
  labelledBy,
}: {
  readonly disabled: boolean
  readonly portalRoot: HTMLElement | null
  readonly labelledBy?: string
  readonly source: AgentInput
  readonly port: InputPort
  readonly inputs: readonly InputPort[]
  readonly model: boolean
  readonly theme: WorkbenchTheme
  readonly onChange: (source: AgentInput, commit?: boolean) => void
  readonly onValidChange: (valid: boolean) => void
  readonly onCommit: () => void
}): ReactElement {
  const t = useTranslate()
  const language = useLang()
  const callbacks = useRef({ onChange, onValidChange, onCommit })
  callbacks.current = { onChange, onValidChange, onCommit }
  const change = useCallback(
    (values: Readonly<Record<string, JsonValue>>) => {
      const value = values[port.handle]
      if (value !== undefined) callbacks.current.onChange({ kind: 'value', value }, false)
    },
    [port.handle],
  )
  const valid = useCallback((value: boolean) => callbacks.current.onValidChange(value), [])
  const commit = useCallback(
    (values: Readonly<Record<string, JsonValue>>, isValid: boolean) => {
      callbacks.current.onValidChange(isValid)
      if (!isValid) return
      const value = values[port.handle]
      if (value !== undefined) callbacks.current.onChange({ kind: 'value', value }, false)
      callbacks.current.onCommit()
    },
    [port.handle],
  )
  useEffect(() => {
    if (source.kind != 'value') valid(true)
    return () => valid(true)
  }, [source.kind, valid])
  return (
    <>
      <WorkbenchSelect
        size="sm"
        variant="subtle"
        ariaLabel={t('agent.source')}
        value={source.kind}
        onValueChange={(value) => {
          switch (value) {
            case 'value':
              onChange({ kind: 'value', value: (port.value ?? getDefaultValue(typeOfSchema(port.jsonSchema), port.jsonSchema) ?? null) as JsonValue }, false)
              break
            case 'input':
              onChange({ kind: 'input', input: inputs[0]?.handle ?? '' })
              break
            case 'model':
              onChange({ kind: 'model' })
              break
          }
        }}
        disabled={disabled}
        portalRoot={portalRoot}
        className="w-full min-w-0"
        options={[
          { value: 'value', label: t('agent.fixed') },
          { value: 'input', label: t('agent.nodeInput'), disabled: inputs.length == 0 },
          ...(model ? [{ value: 'model', label: t('agent.modelValue') }] : []),
        ]}
      />
      {source.kind == 'input' && (
        <WorkbenchSelect
          size="sm"
          variant="subtle"
          ariaLabel={t('agent.inputName')}
          value={source.input}
          onValueChange={(value) => onChange({ kind: 'input', input: value })}
          disabled={disabled}
          portalRoot={portalRoot}
          className="w-full min-w-0"
          options={[
            ...(!inputs.some((input) => input.handle == source.input) ? [{ value: source.input, label: source.input || t('agent.chooseInput') }] : []),
            ...inputs.map((input) => ({ value: input.handle, label: input.handle })),
          ]}
        />
      )}
      {source.kind == 'value' && source.value === null && getDefaultValue(typeOfSchema(port.jsonSchema), port.jsonSchema) != null ? (
        <div className="agent-empty-value">
          <FieldDescription>{t('agent.emptyValue')}</FieldDescription>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onChange({ kind: 'value', value: getDefaultValue(typeOfSchema(port.jsonSchema), port.jsonSchema) as JsonValue })}
          >
            {t('agent.enterValue')}
          </Button>
        </div>
      ) : (
        source.kind == 'value' && (
          <Suspense fallback={<FieldDescription>{t('inspector.wait.inputsLoading')}</FieldDescription>}>
            <InputValues
              labelledBy={labelledBy}
              definitions={[port]}
              language={language}
              theme={theme}
              values={{ [port.handle]: source.value }}
              onChange={change}
              onCommit={commit}
              onValidChange={valid}
              showErrors
            />
          </Suspense>
        )
      )}
    </>
  )
}
