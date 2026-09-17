import styles from './valueEditor.module.scss'
import type { CSSProperties, ReactNode } from 'react'
import type { ValueType } from '../common/value.ts'

import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useI18n, useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Input } from '../../ui/browser/input.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/browser/popover.tsx'
import { Switch } from '../../ui/browser/switch.tsx'
import { Textarea } from '../../ui/browser/textarea.tsx'
import { enumIndex } from '../common/choices.ts'
import { isDateFormat } from '../common/dateValue.ts'
import { editorComponent, valueForEditor } from '../common/editorComponent.ts'
import { getDefaultValue, typeOfSchema } from '../common/schemaWidget.ts'
import { initialValue, objectValue, renameObjectField, setObjectField, valueType } from '../common/value.ts'
import { ArrayFieldList } from './arrayFieldList.tsx'
import { ColorEditor } from './colorEditor.tsx'
import { DateEditor } from './dateEditor.tsx'
import { EditableChoices } from './editableChoices.tsx'
import { editorComponentIcons } from './editorComponentIcon.tsx'
import { EditorComponentSelect } from './editorComponentSelect.tsx'
import { FieldName } from './fieldName.tsx'
import { FieldSelect } from './fieldSelect.tsx'
import { FieldSorting } from './fieldSorting.ts'
import { JsonEditor } from './jsonEditor.tsx'
import { SortableFieldList } from './sortableFieldList.tsx'
import { useValueIssues } from './useValueIssues.ts'
import { valueFeedback } from './valueFeedback.ts'
import { ValueTools } from './valueTools.tsx'

export interface ValueEditorProps {
  readonly compact?: boolean
  readonly layout?: 'values' | 'ports' | 'definition'
  readonly schema: unknown
  readonly value: unknown
  readonly onChange: (value: unknown) => void
  readonly onDefinitionChange?: (schema: unknown, value: unknown) => void
  readonly label: string
  readonly invalid?: boolean
  readonly nullable?: boolean
  readonly disabled?: boolean
  readonly path: string
  readonly onDraftIssue: (path: string, invalid: boolean) => void
  readonly header?: ReactNode
  readonly leadingControl?: ReactNode
  readonly valueAddon?: ReactNode
  readonly trailingControl?: ReactNode
  readonly description?: string
  readonly editor?: ReactNode
  readonly valueEditable?: boolean
  readonly hideOptions?: boolean
  readonly arrayChild?: boolean
  readonly objectChild?: boolean
  readonly actions?: ReactNode
  readonly options?: ReactNode
  readonly depth?: number
}

/** Gives custom value controls the same attached validation feedback as built-in editors. */
export function ValueEditorFeedback({ children, error }: { readonly children: (errorId: string | undefined) => ReactNode; readonly error?: ReactNode }) {
  const id = useId()
  const errorId = error == null ? undefined : `${id}-error`
  return (
    <div className={styles.errorAnchor}>
      {children(errorId)}
      {error != null && (
        <div id={errorId} className={styles.error} role="alert">
          {error}
        </div>
      )}
    </div>
  )
}

const types: readonly ValueType[] = ['string', 'number', 'boolean', 'object', 'array', 'null']

function PropertyName({ name, onRename, disabled }: { name: string; onRename: (name: string) => boolean; disabled?: boolean }) {
  const t = useTranslate()
  const [draft, setDraft] = useState(name)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setDraft(name)
    setInvalid(false)
  }, [name])
  const save = () => {
    if (!disabled && draft !== name) setInvalid(!onRename(draft))
  }
  return (
    <Input
      aria-label={t('valueEditor.fieldName')}
      aria-invalid={invalid}
      readOnly={disabled}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
        setInvalid(false)
      }}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          save()
        }
        if (event.key === 'Escape') {
          setDraft(name)
          setInvalid(false)
        }
      }}
    />
  )
}

/** A custom value control uses the same attached source layout as schema editors. */
export function ValueControl({ addon, children }: { addon?: ReactNode; children: ReactNode }) {
  if (addon == null) return children
  return (
    <div className={styles.root} data-inline data-value-addon={addon != null || undefined}>
      {addon != null && (
        <div className={styles.valueAddon} data-value-addon-control>
          {addon}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  )
}

/** Controlled JSON value editing. It has no graph, port, persistence, or theme context. */
export function ValueEditor(props: ValueEditorProps) {
  const compactValue = props.compact === true || props.header != null || props.valueAddon != null
  const sorting = useContext(FieldSorting)
  const { schema, value, onChange, label, nullable, disabled, path, onDraftIssue, depth = 0 } = props
  const t = useTranslate()
  const id = useId()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [raw, setRaw] = useState(false)
  const focusCreatedValue = useRef(false)
  const [expanded, setExpandedState] = useState(false)
  const [bodyMounted, setBodyMounted] = useState(false)
  const setExpanded = (next: boolean) => {
    setExpandedState(next)
    // Keep drafts and editor history alive after the first expansion.
    if (next) setBodyMounted(true)
  }
  const [editorFocusRequest, setEditorFocusRequest] = useState(0)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const source = objectValue(schema) ?? {}
  const allowsNull =
    nullable === true ||
    source.type === 'null' ||
    (Array.isArray(source.type) && source.type.includes('null')) ||
    (Array.isArray(source.enum) && source.enum.includes(null))
  const presence = value === undefined ? 'unset' : value === null ? 'null' : 'value'
  const missing = presence === 'unset' && !allowsNull
  const invalidNull = presence === 'null' && !allowsNull
  const type = valueType(schema, value)
  const language = useVal(useI18n(true)?.lang$ ?? 'en')
  const [draftInvalid, setDraftInvalid] = useState(false)
  const draftCallback = useRef(onDraftIssue)
  draftCallback.current = onDraftIssue
  const reportDraftIssue = useCallback((draftPath: string, next: boolean) => {
    setDraftInvalid(next)
    draftCallback.current(draftPath, next)
  }, [])
  const needsValidation = !draftInvalid && presence === 'value' && props.editor === undefined
  const issues = useValueIssues(schema, value, language, needsValidation)
  const enumeration = Array.isArray(source.enum) ? source.enum : Object.hasOwn(source, 'const') ? [source.const] : undefined
  const complex = source['ui:widget'] === 'any' || editorComponent(schema) === 'json' || depth > 12
  const choiceOptions = Array.isArray(source.enum)
    ? source.enum
    : source.uniqueItems === true && Array.isArray(objectValue(source.items)?.enum)
      ? (objectValue(source.items)!.enum as unknown[])
      : undefined
  const itemEnumeration = source.uniqueItems === true ? objectValue(source.items)?.enum : undefined
  const showUnset =
    type !== 'boolean' &&
    !enumeration &&
    !itemEnumeration &&
    !choiceOptions &&
    !complex &&
    (presence === 'unset' || invalidNull) &&
    props.editor === undefined &&
    props.valueEditable !== false
  useEffect(() => {
    if (!focusCreatedValue.current || presence === 'unset' || !container) return
    focusCreatedValue.current = false
    const body = container.querySelector<HTMLElement>('[data-value-body]')
    const input = body?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]), textarea')
    const popup = body?.querySelector<HTMLButtonElement>('button[aria-haspopup]')
    if (popup) {
      popup.focus()
      popup.click()
    } else if (input) input.focus()
    else body?.querySelector<HTMLButtonElement>('button')?.focus()
  }, [presence, value, expanded, container])
  const optionLabels = objectValue(source['ui:options'])?.labels
  const child = (
    key: string | number,
    childSchema: unknown,
    childValue: unknown,
    change: (value: unknown) => void,
    options?: ReactNode,
    presentation?: Pick<
      ValueEditorProps,
      'header' | 'actions' | 'hideOptions' | 'arrayChild' | 'objectChild' | 'layout' | 'onDefinitionChange' | 'leadingControl'
    >,
  ) => (
    <ValueEditor
      layout={props.layout}
      schema={childSchema}
      value={childValue}
      onChange={change}
      disabled={disabled}
      label={`${label}.${key}`}
      path={`${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`}
      onDraftIssue={onDraftIssue}
      depth={depth + 1}
      options={options}
      header={
        <>
          <FieldName
            name={String(key)}
            description={typeof objectValue(childSchema)?.description === 'string' ? String(objectValue(childSchema)!.description) : undefined}
            className={styles.fieldName}
          >
            {typeof key === 'number' ? key + 1 : key}
            {Array.isArray(source.required) && source.required.includes(key) ? ' *' : ''}
          </FieldName>
          <span className={styles.fieldType}>{valueType(childSchema, childValue)}</span>
        </>
      }
      {...presentation}
      description={typeof objectValue(childSchema)?.description === 'string' ? String(objectValue(childSchema)!.description) : undefined}
    />
  )
  const object = objectValue(value)
  const properties = objectValue(source.properties) ?? {}
  const availableNames = [...new Set([...Object.keys(properties), ...Object.keys(object ?? {})])]
  const savedOrder = Array.isArray(source['ui:order'])
    ? source['ui:order'].filter((name): name is string => typeof name === 'string' && availableNames.includes(name))
    : []
  const names = [...new Set([...savedOrder, ...availableNames])]
  const canAddObjectField = props.onDefinitionChange != null || source.additionalProperties !== false
  const addObjectField = (after?: string) => {
    let name = 'field'
    let index = 1
    while (names.includes(name)) name = `field${index++}`
    const order = [...names]
    order.splice(after == null ? order.length : order.indexOf(after) + 1, 0, name)
    const fieldSchema = props.onDefinitionChange ? { type: 'string' } : (source.additionalProperties ?? {})
    const next = setObjectField(value, name, initialValue(fieldSchema))
    if (props.onDefinitionChange) {
      props.onDefinitionChange({ ...source, 'properties': { ...properties, [name]: fieldSchema }, 'ui:order': order }, next)
    } else {
      onChange(Object.fromEntries(order.filter((key) => Object.hasOwn(next, key)).map((key) => [key, next[key]])))
    }
  }
  const array = Array.isArray(value) ? value : []
  const canChooseType = source.type == null || Array.isArray(source.type)
  const availableTypes = Array.isArray(source.type) ? types.filter((candidate) => (source.type as unknown[]).includes(candidate)) : types
  const structured = !raw && !complex && !enumeration && (type === 'object' || (type === 'array' && !itemEnumeration)) && props.editor === undefined
  const expandable = !showUnset && (structured || (props.valueEditable !== false && (raw || complex || (type === 'string' && source['ui:widget'] === 'text'))))
  useEffect(() => {
    if (!expanded || !editorFocusRequest || disabled || raw || complex) return
    container?.querySelector<HTMLTextAreaElement>(':scope > [data-value-body] > textarea')?.focus()
  }, [expanded, editorFocusRequest, disabled, raw, complex, container])
  // Keep the complete error set authoritative for both control state and feedback.
  const errors =
    draftInvalid || props.editor !== undefined
      ? []
      : choiceOptions?.length === 0
        ? [{ instancePath: '', message: t('valueEditor.noOptions') }]
        : issues?.schemaError
          ? [{ instancePath: '', message: t('valueEditor.invalidSchema') }]
          : invalidNull
            ? [{ instancePath: '', message: t('valueEditor.notNullableDescription') }]
            : missing
              ? [{ instancePath: '', message: t('valueEditor.required') }]
              : (issues?.errors ?? []).map((error) => ({ instancePath: error.instancePath, message: error.message ?? t('valueEditor.schema') }))
  if (!errors.length && props.invalid && !draftInvalid && props.editor === undefined) errors.push({ instancePath: '', message: t('valueEditor.schema') })
  const {
    editorInvalid: invalid,
    summaryInvalid,
    messages,
    anchor,
  } = valueFeedback(errors, {
    expanded,
    hasSummary: expandable && compactValue,
    hasChildren: structured,
    draftInvalid,
  })
  const errorMessage = messages.length > 0 && (
    <div id={`${id}-error`} className={styles.error} role="alert">
      {messages.map((message) => (
        <div key={message}>{message}</div>
      ))}
    </div>
  )
  const inlineTools = (props.layout === 'values' || props.layout === 'ports') && props.header != null && props.valueEditable !== false && !disabled && !sorting
  const canClear = inlineTools && presence !== 'unset'
  const canToggleJson = inlineTools && expanded && !complex && !enumeration && !itemEnumeration && !showUnset && (type === 'object' || type === 'array')
  const valueSuffix =
    !expandable && !showUnset && (enumeration || itemEnumeration || source['ui:widget'] === 'color' || isDateFormat(source.format))
      ? 26
      : type === 'boolean' && !expandable && !showUnset
        ? 30
        : structured && type === 'array'
          ? 26
          : 0
  const toggleExpanded = () => {
    setExpanded(!expanded)
    if (!expanded) setEditorFocusRequest((request) => request + 1)
  }
  const toolbar = (
    <div
      className={styles.toolbar}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button') && !(event.target as HTMLElement).closest('[data-field-options]')) setOptionsOpen(false)
      }}
    >
      {props.valueEditable !== false && (
        <>
          {canChooseType && !complex && !enumeration && (
            <FieldSelect
              size="sm"
              aria-label={t('valueEditor.type', { name: label })}
              value={type}
              disabled={disabled}
              onChange={(nextValue) => onChange(initialValue({}, nextValue as ValueType))}
            >
              {availableTypes.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {t(`valueEditor.${candidate}`)}
                </option>
              ))}
            </FieldSelect>
          )}
          <span className={styles.presence}>{presence === 'unset' ? t('valueEditor.unset') : presence === 'null' ? 'null' : ''}</span>
          {!complex && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                setRaw(!raw)
                setExpanded(true)
              }}
              aria-pressed={raw || complex}
            >
              <i aria-hidden="true" className="i-lucide-light:braces" />
              JSON
            </Button>
          )}
          {props.header != null && !complex && type === 'string' && presence === 'unset' && (
            <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange('')}>
              <i aria-hidden="true" className="i-lucide-light:text-cursor-input" />
              {t('valueEditor.emptyString')}
            </Button>
          )}
          {nullable && presence !== 'null' && (
            <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(null)}>
              <i aria-hidden="true" className="i-lucide-light:circle-slash" />
              null
            </Button>
          )}
          {presence !== 'unset' && (
            <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(undefined)}>
              <i aria-hidden="true" className="i-lucide-light:eraser" />
              {t('valueEditor.clear')}
            </Button>
          )}
          {presence === 'unset' && (type === 'object' || type === 'array') && (
            <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(type === 'array' ? [] : {})}>
              <i aria-hidden="true" className="i-lucide-light:plus" />
              {t(type === 'array' ? 'valueEditor.createArray' : 'valueEditor.createObject')}
            </Button>
          )}
        </>
      )}
      {props.description && <p className={styles.description}>{props.description}</p>}
      {props.options}
    </div>
  )
  const shouldMountBody = !compactValue || !expandable || expanded || bodyMounted
  const body = shouldMountBody && (
    <div id={`${id}-body`} className={styles.body} data-value-body hidden={compactValue && expandable && !expanded}>
      {!showUnset && !compactValue && props.valueEditable !== false && presence !== 'value' && (
        <span className={styles.presence}>{presence === 'null' ? 'null' : t('valueEditor.unset')}</span>
      )}
      {showUnset ? (
        <Button
          type="button"
          variant="outline"
          size="field"
          className={styles.unsetValue}
          data-field-prompt={invalid || undefined}
          data-field-control
          aria-invalid={invalid || undefined}
          aria-label={`${label} ${t('valueEditor.setValue')}`}
          disabled={disabled}
          onClick={() => {
            const next = getDefaultValue(typeOfSchema(schema), schema)
            focusCreatedValue.current = true
            onChange(next === undefined ? getDefaultValue(type) : next)
            if (type === 'object' || type === 'array' || source['ui:widget'] === 'text') setExpanded(true)
          }}
        >
          <span>{t('valueEditor.setValue')}</span>
          <i aria-hidden="true" className="i-lucide-light:pencil" />
        </Button>
      ) : props.valueEditable !== false && (raw || complex) ? (
        <JsonEditor {...props} onDraftIssue={reportDraftIssue} value={value} invalid={invalid} focusRequest={expanded ? editorFocusRequest : 0} />
      ) : props.editor !== undefined ? (
        props.editor
      ) : presence === 'null' && allowsNull && type !== 'null' && type !== 'boolean' ? (
        <div className={styles.nullValue} data-field-control data-readonly={disabled || undefined} aria-label={`${label} null`}>
          <span className={styles.nullChip}>null</span>
        </div>
      ) : choiceOptions ? (
        <EditableChoices
          options={choiceOptions}
          labels={optionLabels}
          value={value}
          label={label}
          disabled={disabled}
          invalid={invalid}
          multiple={!Array.isArray(source.enum)}
          onChange={onChange}
          onOptionsChange={
            props.onDefinitionChange
              ? (options) => {
                  const nextSchema = Array.isArray(source.enum)
                    ? { ...source, enum: options }
                    : { ...source, items: { ...objectValue(source.items), enum: options } }
                  props.onDefinitionChange!(nextSchema, valueForEditor(nextSchema, value))
                }
              : undefined
          }
        />
      ) : enumeration ? (
        <FieldSelect
          aria-label={label}
          aria-invalid={invalid}
          value={enumIndex(enumeration, value)}
          danger={invalid}
          disabled={disabled}
          onChange={(nextValue) => onChange(structuredClone(enumeration[Number(nextValue)]))}
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
        </FieldSelect>
      ) : type === 'object' ? (
        <div className={styles.collection}>
          <SortableFieldList
            names={names}
            onReorder={!disabled && props.onDefinitionChange ? (order) => props.onDefinitionChange!({ ...source, 'ui:order': order }, value) : undefined}
          >
            {(name, handle) => {
              const fieldSchema = Object.hasOwn(properties, name) ? properties[name] : (source.additionalProperties ?? {})
              const fieldSource = objectValue(fieldSchema) ?? {}
              const fieldValue = object && Object.hasOwn(object, name) ? object[name] : undefined
              return (
                <div data-object-field-content>
                  {child(name, fieldSchema, fieldValue, (next) => onChange(setObjectField(value, name, next)), undefined, {
                    onDefinitionChange: props.onDefinitionChange
                      ? (nextSchema, nextValue) =>
                          props.onDefinitionChange!({ ...source, properties: { ...properties, [name]: nextSchema } }, setObjectField(value, name, nextValue))
                      : undefined,
                    leadingControl: handle,
                    objectChild: true,
                    layout: 'values',
                    hideOptions: true,
                    header: (
                      <>
                        <FieldName name={name} description={typeof fieldSource.description === 'string' ? fieldSource.description : undefined}>
                          {Object.hasOwn(properties, name) && !props.onDefinitionChange ? (
                            <Input aria-label={t('valueEditor.fieldName')} value={name} readOnly />
                          ) : (
                            <PropertyName
                              name={name}
                              disabled={disabled}
                              onRename={(nextName) => {
                                const next = renameObjectField(value, name, nextName)
                                if (!next) return false
                                if (props.onDefinitionChange) {
                                  if (nextName !== name && Object.hasOwn(properties, nextName)) return false
                                  props.onDefinitionChange(
                                    {
                                      ...source,
                                      ...(Array.isArray(source['ui:order'])
                                        ? { 'ui:order': source['ui:order'].map((key) => (key === name ? nextName : key)) }
                                        : {}),
                                      properties: Object.fromEntries(
                                        Object.entries(properties).map(([key, definition]) => [key === name ? nextName : key, definition]),
                                      ),
                                      ...(Array.isArray(source.required) ? { required: source.required.map((key) => (key === name ? nextName : key)) } : {}),
                                    },
                                    next,
                                  )
                                } else onChange(next)
                                return true
                              }}
                            />
                          )}
                        </FieldName>
                        <div data-field-type>
                          {props.onDefinitionChange ? (
                            <EditorComponentSelect
                              schema={fieldSchema}
                              name={`${label}.${name}`}
                              readOnly={disabled}
                              onChange={(nextSchema) =>
                                props.onDefinitionChange!(
                                  { ...source, properties: { ...properties, [name]: nextSchema } },
                                  setObjectField(value, name, valueForEditor(nextSchema, fieldValue)),
                                )
                              }
                            />
                          ) : typeof fieldSource.type === 'string' || fieldSource.enum != null || fieldSource.const !== undefined ? (
                            <EditorComponentSelect schema={fieldSchema} name={`${label}.${name}`} readOnly onChange={() => {}} />
                          ) : (
                            <FieldSelect
                              icons={editorComponentIcons}
                              aria-label={t('valueEditor.type', { name: `${label}.${name}` })}
                              value={valueType(fieldSchema, fieldValue)}
                              readOnly={disabled}
                              onChange={(next) => {
                                onChange(setObjectField(value, name, initialValue(fieldSchema, next as ValueType)))
                              }}
                            >
                              {[...types, 'integer' as const]
                                .filter((candidate) => !Array.isArray(fieldSource.type) || (fieldSource.type as unknown[]).includes(candidate))
                                .map((candidate) => (
                                  <option key={candidate} value={candidate}>
                                    {candidate}
                                  </option>
                                ))}
                            </FieldSelect>
                          )}
                        </div>
                      </>
                    ),
                    actions: (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${t('valueEditor.addField')} ${label}.${name}`}
                          disabled={disabled || !canAddObjectField}
                          onClick={() => addObjectField(name)}
                        >
                          <i aria-hidden="true" className="i-tabler-light:square-rounded-plus text-lg" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${t(Object.hasOwn(properties, name) && !props.onDefinitionChange ? 'valueEditor.clear' : 'valueEditor.remove')} ${name}`}
                          disabled={
                            disabled ||
                            (!props.onDefinitionChange && (fieldValue === undefined || (Array.isArray(source.required) && source.required.includes(name))))
                          }
                          onClick={() => {
                            const next = setObjectField(value, name, undefined)
                            if (props.onDefinitionChange)
                              props.onDefinitionChange(
                                {
                                  ...source,
                                  properties: Object.fromEntries(Object.entries(properties).filter(([key]) => key !== name)),
                                  ...(Array.isArray(source['ui:order']) ? { 'ui:order': source['ui:order'].filter((key) => key !== name) } : {}),
                                  ...(Array.isArray(source.required) ? { required: source.required.filter((key) => key !== name) } : {}),
                                },
                                next,
                              )
                            else onChange(next)
                          }}
                        >
                          <i aria-hidden="true" className="i-tabler-light:square-rounded-minus text-lg" />
                        </Button>
                      </>
                    ),
                  })}
                </div>
              )
            }}
          </SortableFieldList>
          <div className={styles.collectionActions} data-layout="values">
            {names.length === 0 && (
              <Button
                type="button"
                variant="ghost"
                size="field"
                className={`bg-foreground/5 hover:bg-foreground/10 dark:hover:bg-foreground/10 ${styles.emptyObjectContent} ${canAddObjectField ? '' : styles.emptyObjectConstraint}`}
                disabled={disabled || !canAddObjectField}
                aria-label={`${t(canAddObjectField ? 'valueEditor.addField' : 'valueEditor.emptyObject')} ${label}`}
                onClick={canAddObjectField ? () => addObjectField() : undefined}
              >
                {canAddObjectField && <i aria-hidden="true" className="i-lucide-light:plus" />}
                {t(canAddObjectField ? 'valueEditor.addField' : 'valueEditor.emptyObject')}
              </Button>
            )}
          </div>
        </div>
      ) : type === 'array' ? (
        <div className={styles.collection}>
          <ArrayFieldList values={array} onReorder={!disabled && props.valueEditable !== false ? onChange : undefined} label={label}>
            {(item, index, handle) => {
              const itemSchema = Array.isArray(source.items) ? (source.items[index] ?? source.additionalItems ?? {}) : (source.items ?? {})
              return (
                <div data-array-field-content>
                  {child(index, itemSchema, item, (next) => onChange(array.map((entry, at) => (at === index ? (next ?? null) : entry))), undefined, {
                    objectChild: true,
                    arrayChild: true,
                    header: handle ? <></> : <span className={styles.arrayIndex}>{index}.</span>,
                    leadingControl: handle || undefined,
                    onDefinitionChange:
                      props.onDefinitionChange && !Array.isArray(source.items)
                        ? (items, nextValue) =>
                            props.onDefinitionChange!(
                              { ...source, items },
                              array.map((entry, at) => (at === index ? nextValue : entry)),
                            )
                        : undefined,
                    hideOptions: true,
                    actions: (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${t('valueEditor.addItem')} ${label}.${index}`}
                          disabled={disabled || (typeof source.maxItems === 'number' && array.length >= source.maxItems)}
                          onClick={() =>
                            onChange(
                              array.toSpliced(
                                index + 1,
                                0,
                                initialValue(Array.isArray(source.items) ? (source.items[index + 1] ?? source.additionalItems ?? {}) : (source.items ?? {})),
                              ),
                            )
                          }
                        >
                          <i aria-hidden="true" className="i-tabler-light:square-rounded-plus text-lg" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`${t('valueEditor.remove')} ${label}.${index}`}
                          disabled={disabled || (typeof source.minItems === 'number' && array.length <= source.minItems)}
                          onClick={() => onChange(array.toSpliced(index, 1))}
                        >
                          <i aria-hidden="true" className="i-tabler-light:square-rounded-minus text-lg" />
                        </Button>
                      </>
                    ),
                  })}
                </div>
              )
            }}
          </ArrayFieldList>
          {array.length === 0 && (
            <div className={styles.collectionActions} data-layout="values">
              <Button
                type="button"
                variant="ghost"
                size="field"
                className={`bg-foreground/5 hover:bg-foreground/10 dark:hover:bg-foreground/10 ${styles.emptyObjectContent}`}
                aria-label={`${t('valueEditor.addItem')} ${label}`}
                disabled={disabled || (typeof source.maxItems === 'number' && array.length >= source.maxItems)}
                onClick={() => onChange([initialValue(Array.isArray(source.items) ? (source.items[0] ?? source.additionalItems ?? {}) : (source.items ?? {}))])}
              >
                <i aria-hidden="true" className="i-lucide-light:plus" />
                {t('valueEditor.addItem')}
              </Button>
            </div>
          )}
        </div>
      ) : type === 'boolean' ? (
        <div className={styles.booleanControl}>
          <Button
            type="button"
            variant="field"
            size="field"
            data-field-control
            role="switch"
            aria-label={label}
            aria-checked={value === true}
            data-field-prompt={invalid || undefined}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            onClick={() => onChange(value !== true)}
          >
            {presence === 'unset' ? t('valueEditor.select') : value === true ? 'True' : value === false ? 'False' : String(value)}
          </Button>
          <Switch
            render={<span />}
            size="sm"
            checked={value === true}
            readOnly
            disabled={disabled}
            tabIndex={-1}
            aria-hidden="true"
            className={styles.booleanIndicator}
          />
        </div>
      ) : type === 'null' ? (
        value === null ? (
          <div className={styles.nullValue} data-field-control data-readonly={disabled || undefined} aria-label={`${label} null`}>
            <span className={styles.nullChip}>null</span>
          </div>
        ) : (
          <Button
            type="button"
            size="field"
            variant="outline"
            className={styles.nullValue}
            data-field-prompt={invalid || undefined}
            disabled={disabled}
            aria-label={`${label} ${t('valueEditor.setValue')}: null`}
            aria-invalid={invalid || undefined}
            onClick={() => onChange(null)}
          >
            {presence === 'unset' ? t('valueEditor.unset') : JSON.stringify(value)}
          </Button>
        )
      ) : type === 'string' && source['ui:widget'] === 'color' ? (
        <ColorEditor {...props} onDraftIssue={reportDraftIssue} value={value} invalid={invalid} />
      ) : type === 'string' && isDateFormat(source.format) ? (
        <DateEditor {...props} value={value} invalid={invalid} format={source.format} />
      ) : type === 'number' || type === 'integer' ? (
        <NumberEditor {...props} onDraftIssue={reportDraftIssue} value={value} invalid={invalid} integer={type === 'integer'} />
      ) : (
        <>
          <label className={styles.srOnly} htmlFor={id}>
            {label}
          </label>
          {source['ui:widget'] === 'text' ? (
            <Textarea
              id={id}
              aria-invalid={invalid}
              className={value === '' ? styles.emptyString : undefined}
              placeholder={t(value === '' ? 'valueEditor.emptyStringValue' : 'valueEditor.unset')}
              readOnly={disabled}
              value={typeof value === 'string' ? value : ''}
              onChange={(event) => onChange(event.target.value)}
            />
          ) : (
            <Input
              id={id}
              controlSize="field"
              aria-invalid={invalid}
              className={value === '' ? styles.emptyString : undefined}
              placeholder={t(value === '' ? 'valueEditor.emptyStringValue' : 'valueEditor.unset')}
              readOnly={disabled}
              value={typeof value === 'string' ? value : ''}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
          {presence === 'unset' && !compactValue && (
            <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange('')}>
              <i aria-hidden="true" className="i-lucide-light:text-cursor-input" />
              {t('valueEditor.emptyString')}
            </Button>
          )}
        </>
      )}
      {anchor === 'body' && errorMessage}
    </div>
  )
  return (
    <div
      className={styles.root}
      role="group"
      aria-label={label}
      aria-describedby={messages.length ? `${id}-error` : undefined}
      ref={setContainer}
      data-inline={(props.hideOptions && !props.header) || undefined}
      data-compact={props.compact || undefined}
      data-value-tools={canClear || canToggleJson || undefined}
      data-array-child={props.arrayChild || undefined}
      data-object-child={props.objectChild || undefined}
      data-nested-field={depth > 0 || undefined}
      style={
        {
          '--field-indent': `${depth * 16}px`,
          '--value-tools-width': `${(Number(canClear) + Number(canToggleJson)) * 24}px`,
          '--value-suffix-width': `${valueSuffix}px`,
        } as CSSProperties
      }
      data-layout={props.layout}
      data-header={props.header != null || undefined}
      data-collection={expandable || undefined}
      data-output={props.editor === null || undefined}
      data-value-addon={props.valueAddon != null || undefined}
      data-expanded={(expandable && expanded) || undefined}
      data-structured={(structured && !showUnset) || undefined}
      data-branch={(expandable && !(structured && type === 'object' && names.length === 0 && !canAddObjectField)) || undefined}
    >
      {props.header != null && (
        <div className={styles.header}>
          {props.leadingControl != null && <div className={styles.leadingControl}>{props.leadingControl}</div>}
          <div className={styles.toggleControl}>
            {expandable && !sorting && (
              <Button
                type="button"
                size="icon-xs"
                className="w-[var(--field-toggle-width,24px)]"
                variant="disclosure"
                aria-label={label}
                aria-expanded={expanded}
                aria-controls={`${id}-body`}
                onClick={toggleExpanded}
              >
                <i aria-hidden="true" className={expanded ? 'i-lucide-light:chevron-down' : 'i-lucide-light:chevron-right'} />
              </Button>
            )}
          </div>
          {props.header}
        </div>
      )}
      {props.valueAddon != null && (
        <div className={styles.valueAddon} data-value-addon-control>
          {props.valueAddon}
        </div>
      )}
      {props.header != null && expandable && structured && type === 'array' && !Array.isArray(source.items) ? (
        <div className={styles.arrayItemType}>
          <EditorComponentSelect
            schema={source.items ?? {}}
            name={`${label}[]`}
            compact={false}
            showIcon={false}
            invalid={summaryInvalid}
            disabled={disabled || !props.onDefinitionChange}
            onChange={(items) =>
              props.onDefinitionChange?.(
                { ...source, items },
                array.map((item) => valueForEditor(items, item)),
              )
            }
          />
        </div>
      ) : (
        compactValue &&
        expandable && (
          <Button
            type="button"
            variant="disclosure"
            size="field"
            className={styles.summary}
            data-field-prompt={summaryInvalid || undefined}
            data-readonly={disabled || undefined}
            data-field-control
            disabled={sorting}
            aria-label={`${label} ${t('valueEditor.setValue')}`}
            aria-expanded={expanded}
            aria-invalid={summaryInvalid}
            aria-controls={`${id}-body`}
            onClick={toggleExpanded}
          >
            <span className={styles.summaryText}>
              {presence === 'unset'
                ? t('valueEditor.unset')
                : structured
                  ? JSON.stringify(value)
                  : typeof value === 'string'
                    ? value === ''
                      ? t('valueEditor.emptyStringValue')
                      : value
                    : JSON.stringify(value)}
            </span>
            {props.header == null && <i aria-hidden="true" className={expanded ? 'i-lucide-light:chevron-up' : 'i-lucide-light:chevron-down'} />}
          </Button>
        )
      )}
      {!expandable && body}
      <ValueTools
        label={label}
        container={container}
        raw={raw}
        onClear={
          canClear
            ? () => {
                onChange(undefined)
                setExpanded(false)
                setRaw(false)
                setEditorFocusRequest(0)
              }
            : undefined
        }
        onToggleJson={
          canToggleJson
            ? () => {
                setRaw(!raw)
                if (!raw) setEditorFocusRequest((request) => request + 1)
              }
            : undefined
        }
      />
      {props.trailingControl}
      {(!props.hideOptions || props.actions) && (
        <div className={styles.options}>
          {props.actions}
          {!props.hideOptions &&
            (props.options && (props.layout === 'values' || props.layout === 'ports') ? (
              props.options
            ) : (
              <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
                <PopoverTrigger
                  render={<Button type="button" variant="ghost" size="icon-sm" data-value-options aria-label={t('valueEditor.options', { name: label })} />}
                >
                  <i aria-hidden="true" className="i-lucide-light:settings text-base" />
                </PopoverTrigger>
                <PopoverContent
                  container={container}
                  align="end"
                  className="w-auto max-w-[min(320px,calc(100vw-32px))] max-h-[70vh] overflow-y-auto rounded-lg p-1"
                >
                  {toolbar}
                </PopoverContent>
              </Popover>
            ))}
        </div>
      )}
      {expandable && body}
      {anchor === 'summary' && errorMessage && <div className={styles.summaryError}>{errorMessage}</div>}
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
        controlSize="field"
        placeholder={t('valueEditor.unset')}
        inputMode={integer ? 'numeric' : 'decimal'}
        aria-label={label}
        aria-invalid={invalid || props.invalid}
        readOnly={disabled}
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
