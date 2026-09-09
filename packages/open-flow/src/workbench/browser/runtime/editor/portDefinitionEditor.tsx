import type { Group, InputPort } from '../api.ts'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ValueEditor } from '../../../../form/browser/valueEditor.tsx'
import { compile } from '../../../../form/common/validation/validator.ts'
import { objectValue } from '../../../../form/common/value.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { NativeSelect } from '../../../../ui/browser/native-select.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'

function PortName({ value, disabled, names, onChange }: { value: string; disabled: boolean; names: readonly string[]; onChange: (value: string) => void }) {
  const t = useTranslate()
  const [draft, setDraft] = useState(value)
  const invalid = draft.trim() === '' || (draft !== value && names.includes(draft))
  useEffect(() => setDraft(value), [value])
  const save = () => {
    if (!invalid && draft !== value) onChange(draft)
  }
  return (
    <Input
      aria-label={t('valueEditor.fieldName')}
      aria-invalid={invalid}
      disabled={disabled}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          save()
        }
        if (event.key === 'Escape') setDraft(value)
      }}
    />
  )
}

function PortSchema({ value, disabled, onChange }: { value: InputPort['jsonSchema']; disabled: boolean; onChange: (value: InputPort['jsonSchema']) => void }) {
  const t = useTranslate()
  const lastValue = useRef(value)
  const [text, setText] = useState(JSON.stringify(value, null, 2))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    if (lastValue.current === value) return
    lastValue.current = value
    setText(JSON.stringify(value, null, 2))
    setInvalid(false)
  }, [value])
  return (
    <>
      <NativeSelect
        aria-label={t('valueEditor.type', { name: 'Schema' })}
        disabled={disabled}
        value={String(objectValue(value)?.type ?? '')}
        onChange={(event) => {
          const { type: _type, ...rest } = objectValue(value) ?? {}
          onChange({ ...rest, ...(event.target.value ? { type: event.target.value } : {}) } as InputPort['jsonSchema'])
        }}
      >
        <option value="">JSON</option>
        {['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'].map((type) => (
          <option key={type}>{type}</option>
        ))}
      </NativeSelect>
      <Textarea
        aria-label="JSON Schema"
        aria-invalid={invalid}
        disabled={disabled}
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          try {
            const next: unknown = JSON.parse(event.target.value)
            if ((typeof next !== 'boolean' && objectValue(next) == null) || compile(next)[1]) throw new Error('Invalid schema')
            setInvalid(false)
            lastValue.current = next as InputPort['jsonSchema']
            onChange(next as InputPort['jsonSchema'])
          } catch {
            setInvalid(true)
          }
        }}
      />
      {invalid && (
        <p role="alert" className="text-sm text-destructive">
          {t('valueEditor.invalidJson')}
        </p>
      )}
    </>
  )
}

type PortEditorProps = {
  defaultNullable?: boolean
  reservedNames?: readonly string[]
  disabled: boolean
  output?: boolean
} & (
  | { groups: true; values: readonly (InputPort | Group)[]; onChange: (values: readonly (InputPort | Group)[]) => void }
  | { groups?: false; values: readonly InputPort[]; onChange: (values: readonly InputPort[]) => void }
)

export function PortDefinitionEditor(props: PortEditorProps) {
  const { defaultNullable = true, reservedNames = [], values, disabled } = props
  const onChange = (next: readonly (InputPort | Group)[]) => {
    if (props.groups) props.onChange(next)
    else props.onChange(next.filter((port): port is InputPort => 'handle' in port))
  }
  const t = useTranslate()
  const onDraftIssue = useCallback(() => {}, [])
  const update = (index: number, port: InputPort | Group) => onChange(values.map((entry, i) => (i === index ? port : entry)))
  return (
    <div className="flex flex-col gap-3 p-3">
      {values.map((port, index) =>
        'group' in port ? (
          <fieldset key={`group:${index}`} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm">{t('valueEditor.group')}</legend>
            <Input
              aria-label={t('valueEditor.group')}
              disabled={disabled}
              value={port.group}
              onChange={(event) => update(index, { ...port, group: event.target.value })}
            />
            <Label className="flex items-center gap-2 text-sm leading-normal font-normal select-text">
              <Checkbox
                disabled={disabled}
                checked={port.collapsed === true}
                onCheckedChange={(collapsed) => update(index, { ...port, collapsed: collapsed === true })}
              />
              {t('valueEditor.collapsed')}
            </Label>
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled || index === 0}
                onClick={() => {
                  const next = [...values]
                  ;[next[index - 1], next[index]] = [next[index]!, next[index - 1]!]
                  onChange(next)
                }}
              >
                {t('valueEditor.moveUp')}
              </Button>
              <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(values.filter((_, i) => i !== index))}>
                {t('valueEditor.remove')}
              </Button>
            </div>
          </fieldset>
        ) : (
          <fieldset key={port.handle} className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm">{port.handle}</legend>
            {!props.output && (
              <ValueEditor
                schema={port.jsonSchema}
                value={port.value}
                label={port.handle}
                nullable={port.nullable}
                disabled={disabled}
                path={`/${index}`}
                onDraftIssue={onDraftIssue}
                onChange={(value) => {
                  const { value: _value, ...rest } = port
                  update(index, { ...rest, ...(value === undefined ? {} : { value: value as InputPort['value'] }) })
                }}
              />
            )}
            <details open={props.output}>
              <summary className="cursor-pointer text-sm">{t('valueEditor.fieldSettings')}</summary>
              <div className="mt-2 flex flex-col gap-2">
                <PortName
                  value={port.handle}
                  names={[...reservedNames, ...values.flatMap((entry) => ('handle' in entry ? [entry.handle] : []))]}
                  disabled={disabled}
                  onChange={(handle) => update(index, { ...port, handle })}
                />
                <Input
                  aria-label={t('inspector.node.description')}
                  value={port.description ?? ''}
                  disabled={disabled}
                  onChange={(event) => update(index, { ...port, description: event.target.value })}
                />
                <Label className="flex items-center gap-2 text-sm leading-normal font-normal select-text">
                  <Checkbox
                    disabled={disabled}
                    checked={port.nullable}
                    onCheckedChange={(nullable) => update(index, { ...port, nullable: nullable === true })}
                  />
                  {t('valueEditor.nullable')}
                </Label>
                <PortSchema value={port.jsonSchema} disabled={disabled} onChange={(jsonSchema) => update(index, { ...port, jsonSchema })} />
              </div>
            </details>
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="ghost"
                disabled={disabled || index === 0}
                onClick={() => {
                  const next = [...values]
                  ;[next[index - 1], next[index]] = [next[index]!, next[index - 1]!]
                  onChange(next)
                }}
              >
                {t('valueEditor.moveUp')}
              </Button>
              <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(values.filter((_, i) => i !== index))}>
                {t('valueEditor.remove')}
              </Button>
            </div>
          </fieldset>
        ),
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          let index = 1
          while (reservedNames.includes(`value${index}`) || values.some((port) => 'handle' in port && port.handle === `value${index}`)) index++
          onChange([...values, { handle: `value${index}`, jsonSchema: {}, nullable: defaultNullable }])
        }}
      >
        {t('valueEditor.addField')}
      </Button>
      {props.groups && (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onChange([...values, { group: t('valueEditor.group') }])}>
          {t('valueEditor.addGroup')}
        </Button>
      )}
    </div>
  )
}
