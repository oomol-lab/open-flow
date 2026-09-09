import type { ConditionOperator, JsonValue } from '../api.ts'
import type { ConditionSettings } from './flowChanges.ts'

import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ValueEditor } from '../../../../form/browser/valueEditor.tsx'
import { objectValue } from '../../../../form/common/value.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { NativeSelect } from '../../../../ui/browser/native-select.tsx'

const operators: readonly ConditionOperator[] = [
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'hasKey',
  'notHasKey',
  'hasValue',
  'notHasValue',
  'isEmpty',
  'isNotEmpty',
  'isNull',
  'isNotNull',
  'isTrue',
  'isFalse',
]
const byType: Record<string, readonly ConditionOperator[]> = {
  string: ['==', '!=', 'contains', 'notContains', 'startsWith', 'endsWith', 'isEmpty', 'isNotEmpty'],
  number: ['==', '!=', '<', '<=', '>', '>='],
  integer: ['==', '!=', '<', '<=', '>', '>='],
  boolean: ['==', '!=', 'isTrue', 'isFalse'],
  object: ['hasKey', 'notHasKey', 'hasValue', 'notHasValue', 'isEmpty', 'isNotEmpty'],
  array: ['contains', 'notContains', 'isEmpty', 'isNotEmpty'],
  null: ['isNull', 'isNotNull'],
}
function parameterSchema(type: string | undefined, operator: ConditionOperator) {
  if (type === 'number' || type === 'integer' || ['<', '<=', '>', '>='].includes(operator)) return { type: 'number' }
  if (type === 'boolean' && ['==', '!='].includes(operator)) return { type: 'boolean' }
  if (
    type === 'string' ||
    ['hasKey', 'notHasKey'].includes(operator) ||
    (type !== 'array' && ['startsWith', 'endsWith', 'contains', 'notContains'].includes(operator))
  )
    return { type: 'string' }
  return {}
}
const draftIssue = () => {}

function OutputName({ value, names, disabled, onChange }: { value: string; names: readonly string[]; disabled: boolean; onChange: (value: string) => void }) {
  const t = useTranslate()
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const invalid = draft.trim() === '' || draft === '__proto__' || (draft !== value && names.includes(draft))
  return (
    <Input
      aria-label={t('conditionEditor.handleKeyTitle')}
      aria-invalid={invalid}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (!invalid && draft !== value) onChange(draft)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else if (event.key === 'Escape') setDraft(value)
      }}
    />
  )
}

export function ConditionBranchesEditor({
  value,
  disabled,
  onChange,
}: {
  readonly value: ConditionSettings
  readonly disabled: boolean
  readonly onChange: (value: ConditionSettings) => void
}) {
  const t = useTranslate()
  const rawType = objectValue(value.input.jsonSchema)?.type
  const inputType = typeof rawType === 'string' ? rawType : undefined
  const available = inputType == null ? operators : [...(byType[inputType] ?? operators), ...(value.input.nullable ? (['isNull', 'isNotNull'] as const) : [])]
  const names = [...value.cases.map((item) => item.output), ...(value.defaultOutput == null ? [] : [value.defaultOutput])]
  const nextName = (prefix: string) => {
    let name = prefix
    let index = 2
    while (names.includes(name)) name = `${prefix}${index++}`
    return name
  }
  return (
    <section className="inspector-section" data-inspector-section="condition">
      <h3>{t('conditionEditor.title')}</h3>
      <div className="flex flex-col gap-4">
        {value.cases.map((item, index) => {
          const save = (next: typeof item) => onChange({ ...value, cases: value.cases.with(index, next) })
          return (
            <fieldset className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3" key={item.output}>
              <legend>{item.output}</legend>
              <OutputName value={item.output} names={names} disabled={disabled} onChange={(output) => save({ ...item, output })} />
              <NativeSelect
                aria-label={t('conditionEditor.handleLogicalTitle')}
                disabled={disabled}
                value={item.relation}
                onChange={(event) => save({ ...item, relation: event.target.value as 'all' | 'any' })}
              >
                <option value="all">{t('conditionEditor.logical.AND')}</option>
                <option value="any">{t('conditionEditor.logical.OR')}</option>
              </NativeSelect>
              {item.expressions.map((expression, expressionIndex) => {
                const change = (next: typeof expression) => save({ ...item, expressions: item.expressions.with(expressionIndex, next) })
                return (
                  <div className="flex min-w-0 flex-col gap-2" key={expressionIndex}>
                    <NativeSelect
                      aria-label={t('conditionEditor.handleKeyTitle')}
                      disabled={disabled}
                      value={expression.input}
                      onChange={(event) => change({ ...expression, input: event.target.value })}
                    >
                      {expression.input !== value.input.handle && <option value={expression.input}>{expression.input}</option>}
                      <option value={value.input.handle}>{value.input.handle}</option>
                    </NativeSelect>
                    <NativeSelect
                      aria-label={t('conditionEditor.label')}
                      disabled={disabled}
                      value={expression.operator}
                      onChange={(event) => {
                        const operator = event.target.value as ConditionOperator
                        const { value: previous, ...base } = expression
                        change({ ...base, operator, ...(!operator.startsWith('is') && previous !== undefined ? { value: previous } : {}) })
                      }}
                    >
                      {[...new Set([expression.operator, ...available])].map((operator) => (
                        <option key={operator} value={operator}>
                          {t(`conditionEditor.operator.${operator}`)}
                        </option>
                      ))}
                    </NativeSelect>
                    {!expression.operator.startsWith('is') && (
                      <ValueEditor
                        schema={parameterSchema(inputType, expression.operator)}
                        value={expression.value}
                        label={item.output}
                        path={`/${index}/${expressionIndex}`}
                        disabled={disabled}
                        onDraftIssue={draftIssue}
                        onChange={(next) => {
                          const { value: _value, ...base } = expression
                          change({ ...base, ...(next === undefined ? {} : { value: next as JsonValue }) })
                        }}
                      />
                    )}
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => save({ ...item, expressions: item.expressions.toSpliced(expressionIndex, 1) })}
                    >
                      {t('valueEditor.remove')}
                    </Button>
                  </div>
                )
              })}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => save({ ...item, expressions: [...item.expressions, { input: value.input.handle, operator: '==' }] })}
              >
                {t('conditionEditor.addCondition')}
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={disabled || index === 0}
                  onClick={() => {
                    const cases = [...value.cases]
                    ;[cases[index - 1], cases[index]] = [cases[index]!, cases[index - 1]!]
                    onChange({ ...value, cases })
                  }}
                >
                  {t('valueEditor.moveUp')}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => onChange({ ...value, cases: value.cases.toSpliced(index, 1) })}
                >
                  {t('conditionEditor.deleteCondition')}
                </Button>
              </div>
            </fieldset>
          )
        })}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onChange({
              ...value,
              cases: [...value.cases, { output: nextName('case'), relation: 'all', expressions: [{ input: value.input.handle, operator: '==' }] }],
            })
          }
        >
          {t('conditionEditor.addCondition')}
        </Button>
        <Label className="flex items-center gap-2 text-sm leading-normal font-normal select-text">
          <Checkbox
            disabled={disabled}
            checked={value.defaultOutput != null}
            onCheckedChange={(checked) => {
              const { defaultOutput: _default, ...base } = value
              onChange({ ...base, ...(checked ? { defaultOutput: nextName('default') } : {}) })
            }}
          />
          {t('conditionEditor.toggleDefault')}
        </Label>
        {value.defaultOutput != null && (
          <OutputName value={value.defaultOutput} names={names} disabled={disabled} onChange={(defaultOutput) => onChange({ ...value, defaultOutput })} />
        )}
      </div>
    </section>
  )
}
