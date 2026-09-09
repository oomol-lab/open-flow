import styles from './valueEditor.module.scss'
import type { ValueType } from '../common/value.ts'

import { useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Input } from '../../ui/browser/input.tsx'
import { NativeSelect } from '../../ui/browser/native-select.tsx'
import { Textarea } from '../../ui/browser/textarea.tsx'
import { enumIndex, schemaChoices } from '../common/choices.ts'
import { isDateFormat } from '../common/dateValue.ts'
import { initialValue, isJsonValue, objectValue, renameObjectField, setObjectField, valueType } from '../common/value.ts'
import { ChoiceEditor, EnumChoices } from './choiceEditor.tsx'
import { ColorEditor } from './colorEditor.tsx'
import { DateEditor } from './dateEditor.tsx'

export interface ValueEditorProps {
  readonly schema: unknown
  readonly value: unknown
  readonly onChange: (value: unknown) => void
  readonly label: string
  readonly nullable?: boolean
  readonly disabled?: boolean
  readonly path: string
  readonly onDraftIssue: (path: string, invalid: boolean) => void
  readonly depth?: number
}

const types: readonly ValueType[] = ['string', 'number', 'boolean', 'object', 'array', 'null']

function JsonEditor({ value, onChange, label, disabled, path, onDraftIssue }: ValueEditorProps) {
  const t = useTranslate()
  const lastValue = useRef(value)
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    if (lastValue.current === value) return
    lastValue.current = value
    setText(value === undefined ? '' : JSON.stringify(value, null, 2))
    setInvalid(false)
    onDraftIssue(path, false)
  }, [value, path, onDraftIssue])
  useEffect(() => () => onDraftIssue(path, false), [path, onDraftIssue])
  return (
    <>
      <Textarea
        aria-label={`${label} JSON`}
        aria-invalid={invalid}
        disabled={disabled}
        className={styles.json}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value
          setText(nextText)
          try {
            const next: unknown = nextText.trim() === '' ? undefined : JSON.parse(nextText)
            if (next !== undefined && !isJsonValue(next)) throw new Error('Not JSON')
            setInvalid(false)
            onDraftIssue(path, false)
            lastValue.current = next
            onChange(next)
          } catch {
            setInvalid(true)
            onDraftIssue(path, true)
          }
        }}
      />
      {invalid && (
        <p role="alert" className={styles.error}>
          {t('valueEditor.invalidJson')}
        </p>
      )}
    </>
  )
}

function PropertyName({ name, onRename, disabled }: { name: string; onRename: (name: string) => boolean; disabled?: boolean }) {
  const t = useTranslate()
  const [draft, setDraft] = useState(name)
  const [invalid, setInvalid] = useState(false)
  return (
    <Input
      aria-label={t('valueEditor.fieldName')}
      aria-invalid={invalid}
      disabled={disabled}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
        setInvalid(false)
      }}
      onBlur={() => setInvalid(!onRename(draft))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          setInvalid(!onRename(draft))
        }
        if (event.key === 'Escape') {
          setDraft(name)
          setInvalid(false)
        }
      }}
    />
  )
}

/** Controlled JSON value editing. It has no graph, port, persistence, or theme context. */
export function ValueEditor(props: ValueEditorProps) {
  const { schema, value, onChange, label, nullable, disabled, path, onDraftIssue, depth = 0 } = props
  const t = useTranslate()
  const id = useId()
  const [raw, setRaw] = useState(false)
  const source = objectValue(schema) ?? {}
  const type = valueType(schema, value)
  const complex = source.$ref != null || source.allOf != null || depth > 12
  const variants = schemaChoices(schema)
  const itemEnumeration = objectValue(source.items)?.enum
  const enumeration = Array.isArray(source.enum) ? source.enum : Object.hasOwn(source, 'const') ? [source.const] : undefined
  const optionLabels = objectValue(source['ui:options'])?.labels
  const child = (key: string | number, childSchema: unknown, childValue: unknown, change: (value: unknown) => void) => (
    <ValueEditor
      schema={childSchema}
      value={childValue}
      onChange={change}
      disabled={disabled}
      label={`${label}.${key}`}
      path={`${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`}
      onDraftIssue={onDraftIssue}
      depth={depth + 1}
    />
  )
  const object = objectValue(value)
  const properties = objectValue(source.properties) ?? {}
  const names = [...new Set([...Object.keys(properties), ...Object.keys(object ?? {})])]
  const required = Array.isArray(source.required) ? source.required : []
  const array = Array.isArray(value) ? value : []
  const canChooseType = source.type == null || Array.isArray(source.type)
  const availableTypes = Array.isArray(source.type) ? types.filter((candidate) => (source.type as unknown[]).includes(candidate)) : types
  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        {canChooseType && !complex && !enumeration && !variants && (
          <NativeSelect
            size="sm"
            aria-label={t('valueEditor.type', { name: label })}
            value={type}
            disabled={disabled}
            onChange={(event) => onChange(initialValue({}, event.target.value as ValueType))}
          >
            {availableTypes.map((candidate) => (
              <option key={candidate} value={candidate}>
                {t(`valueEditor.${candidate}`)}
              </option>
            ))}
          </NativeSelect>
        )}
        <span className={styles.presence}>{value === undefined ? t('valueEditor.unset') : value === null ? 'null' : ''}</span>
        <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => setRaw(!raw)} aria-pressed={raw || complex}>
          JSON
        </Button>
        {nullable && value !== null && (
          <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
            null
          </Button>
        )}
        {value !== undefined && (
          <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(undefined)}>
            {t('valueEditor.clear')}
          </Button>
        )}
      </div>
      {raw || complex ? (
        <JsonEditor {...props} />
      ) : variants ? (
        <ChoiceEditor {...props} render={(selectedSchema, index) => <ValueEditor {...props} key={index} schema={selectedSchema} depth={depth + 1} />} />
      ) : enumeration ? (
        <NativeSelect
          aria-label={label}
          value={enumIndex(enumeration, value)}
          disabled={disabled}
          onChange={(event) => onChange(structuredClone(enumeration[Number(event.target.value)]))}
        >
          <option value={-1} disabled>
            {t('valueEditor.select')}
          </option>
          {enumeration.map((item, index) => (
            <option key={index} value={index}>
              {Array.isArray(optionLabels) && typeof optionLabels[index] === 'string'
                ? optionLabels[index]
                : typeof item === 'string'
                  ? item
                  : JSON.stringify(item)}
            </option>
          ))}
        </NativeSelect>
      ) : value === null && type !== 'null' ? (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange(initialValue(schema))}>
          {t('valueEditor.setValue')}
        </Button>
      ) : type === 'object' ? (
        <div className={styles.collection}>
          {names.map((name) => (
            <fieldset className={styles.field} key={name}>
              <legend>
                {name}
                {required.includes(name) ? ' *' : ''}
              </legend>
              {!Object.hasOwn(properties, name) && (
                <PropertyName
                  name={name}
                  disabled={disabled}
                  onRename={(nextName) => {
                    const next = renameObjectField(value, name, nextName)
                    if (!next) return false
                    onChange(next)
                    return true
                  }}
                />
              )}
              {child(
                name,
                Object.hasOwn(properties, name) ? properties[name] : (source.additionalProperties ?? {}),
                object && Object.hasOwn(object, name) ? object[name] : undefined,
                (next) => onChange(setObjectField(value, name, next)),
              )}
              {typeof objectValue(properties[name])?.description === 'string' && (
                <p className={styles.description}>{String(objectValue(properties[name])!.description)}</p>
              )}
              {object && Object.hasOwn(object, name) && (
                <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(setObjectField(value, name, undefined))}>
                  {t('valueEditor.remove')}
                </Button>
              )}
            </fieldset>
          ))}
          <div className={styles.actions}>
            {value === undefined && (
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange({})}>
                {t('valueEditor.createObject')}
              </Button>
            )}
            {source.additionalProperties !== false && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  let name = 'field'
                  let index = 1
                  while (names.includes(name)) name = `field${index++}`
                  onChange(setObjectField(value, name, initialValue(source.additionalProperties ?? {})))
                }}
              >
                {t('valueEditor.addField')}
              </Button>
            )}
          </div>
        </div>
      ) : type === 'array' && source.uniqueItems === true && Array.isArray(itemEnumeration) ? (
        <EnumChoices options={itemEnumeration} labels={optionLabels} value={value} label={label} disabled={disabled} onChange={onChange} />
      ) : type === 'array' ? (
        <div className={styles.collection}>
          {array.map((item, index) => (
            <fieldset className={styles.field} key={index}>
              <legend>{index + 1}</legend>
              {child(index, Array.isArray(source.items) ? (source.items[index] ?? source.additionalItems ?? {}) : (source.items ?? {}), item, (next) =>
                onChange(array.map((entry, at) => (at === index ? (next ?? null) : entry))),
              )}
              <div className={styles.actions}>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={disabled || index === 0}
                  onClick={() => {
                    const next = [...array]
                    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                    onChange(next)
                  }}
                >
                  {t('valueEditor.moveUp')}
                </Button>
                <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={() => onChange(array.toSpliced(index, 0, structuredClone(item)))}>
                  {t('valueEditor.duplicate')}
                </Button>
                <Button type="button" variant="ghost" size="xs" disabled={disabled} onClick={() => onChange(array.toSpliced(index, 1))}>
                  {t('valueEditor.remove')}
                </Button>
              </div>
            </fieldset>
          ))}
          <div className={styles.actions}>
            {value === undefined && (
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([])}>
                {t('valueEditor.createArray')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || (typeof source.maxItems === 'number' && array.length >= source.maxItems)}
              onClick={() => onChange([...array, initialValue(Array.isArray(source.items) ? (source.items[array.length] ?? {}) : (source.items ?? {}))])}
            >
              {t('valueEditor.addItem')}
            </Button>
          </div>
        </div>
      ) : type === 'boolean' ? (
        <NativeSelect
          aria-label={label}
          disabled={disabled}
          value={value === undefined ? '' : String(value)}
          onChange={(event) => onChange(event.target.value === 'true')}
        >
          <option value="" disabled>
            {t('valueEditor.select')}
          </option>
          <option value="true">true</option>
          <option value="false">false</option>
        </NativeSelect>
      ) : type === 'null' ? (
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange(null)}>
          {t('valueEditor.setValue')}: null
        </Button>
      ) : type === 'string' && source['ui:widget'] === 'color' ? (
        <ColorEditor {...props} />
      ) : type === 'string' && isDateFormat(source.format) ? (
        <DateEditor {...props} format={source.format} />
      ) : type === 'number' || type === 'integer' ? (
        <NumberEditor {...props} integer={type === 'integer'} />
      ) : (
        <>
          <label className={styles.srOnly} htmlFor={id}>
            {label}
          </label>
          {source['ui:widget'] === 'text' ? (
            <Textarea id={id} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />
          ) : (
            <Input id={id} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} />
          )}
          {value === undefined && (
            <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange('')}>
              {t('valueEditor.emptyString')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}

function NumberEditor(props: ValueEditorProps & { integer: boolean }) {
  const { value, onChange, label, disabled, path, onDraftIssue, integer } = props
  const t = useTranslate()
  const lastValue = useRef(value)
  const [text, setText] = useState(value === undefined ? '' : String(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    if (lastValue.current === value) return
    lastValue.current = value
    setText(value === undefined ? '' : String(value))
    setInvalid(false)
    onDraftIssue(path, false)
  }, [value, path, onDraftIssue])
  useEffect(() => () => onDraftIssue(path, false), [path, onDraftIssue])
  return (
    <>
      <Input
        type="text"
        inputMode={integer ? 'numeric' : 'decimal'}
        aria-label={label}
        aria-invalid={invalid}
        disabled={disabled}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value
          setText(nextText)
          const next = nextText.trim() === '' ? undefined : Number(nextText)
          const draftInvalid = next !== undefined && (!Number.isFinite(next) || (integer && !Number.isInteger(next)))
          setInvalid(draftInvalid)
          onDraftIssue(path, draftInvalid)
          if (!draftInvalid) {
            lastValue.current = next
            onChange(next)
          }
        }}
      />
      {invalid && (
        <p className={styles.error} role="alert">
          {t('valueEditor.invalidNumber')}
        </p>
      )}
    </>
  )
}
