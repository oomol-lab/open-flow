import styles from './valueEditor.module.scss'
import type { CSSProperties, ReactNode } from 'react'
import type { FieldExpansionPolicy } from '../common/fieldExpansion.ts'
import type { FieldValueDeletion } from '../common/fieldValue.ts'
import type { ValueType } from '../common/value.ts'
import type { FieldRowPresentation } from './fieldLayout.tsx'
import type { ValueControlProps } from './valueControlProps.ts'

import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useI18n, useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/browser/popover.tsx'
import { SelectChevron } from '../../ui/browser/select.tsx'
import { enumIndex } from '../common/choices.ts'
import { isDateFormat } from '../common/dateValue.ts'
import { valueForEditor } from '../common/editorComponent.ts'
import { fieldValueState, fieldValueShape } from '../common/fieldValue.ts'
import { objectFieldNames } from '../common/objectFields.ts'
import { getDefaultValue, typeOfSchema } from '../common/schemaWidget.ts'
import { initialValue, objectValue } from '../common/value.ts'
import { collectionCreateAction } from './collectionActions.ts'
import { ObjectValueFields, ArrayValueFields } from './collectionValueFields.tsx'
import { EditableChoices } from './editableChoices.tsx'
import { FieldRow, FieldBranch } from './fieldLayout.tsx'
import { FieldSelect } from './fieldSelect.tsx'
import { FieldSorting } from './fieldSorting.ts'
import { FieldTypeAddon } from './fieldTypeAddon.tsx'
import { JsonEditor } from './jsonEditor.tsx'
import { useFieldExpansion } from './useFieldExpansion.ts'
import { useValueIssues } from './useValueIssues.ts'
import { ValueEditor } from './valueEditor.tsx'
import { valueFeedback } from './valueFeedback.ts'
import { ValueTools } from './valueTools.tsx'

export interface FieldValueEditorProps extends ValueControlProps, FieldRowPresentation {
  readonly expansionPolicy?: FieldExpansionPolicy
  readonly compact?: boolean
  readonly onDefinitionChange?: (schema: unknown, value: unknown, deletion?: FieldValueDeletion) => void
  readonly validationError?: string
  readonly nullable?: boolean
  readonly onInvalidChange?: (invalid: boolean) => void
  readonly valueAddon?: ReactNode
  readonly valueSuffix?: ReactNode
  readonly description?: string
  readonly editor?: ReactNode
  readonly valueEditable?: boolean
  readonly hideOptions?: boolean
  /** Hides the inline clear and raw JSON controls while preserving field settings. */
  readonly hideValueTools?: boolean
  readonly arrayChild?: boolean
  readonly objectChild?: boolean
  readonly options?: ReactNode
}

const types: readonly ValueType[] = ['string', 'number', 'boolean', 'object', 'array', 'null']

/** Controlled JSON value editing. It has no graph, port, persistence, or theme context. */
export function FieldValueEditor(props: FieldValueEditorProps) {
  const compactValue = props.compact === true || props.header != null || props.valueAddon != null || props.valueSuffix != null
  const sorting = useContext(FieldSorting)
  const { schema, value, onChange, label, nullable, disabled, onDraftIssue, depth = 0 } = props
  const t = useTranslate()
  const id = useId()
  const source = objectValue(schema) ?? {}
  const valueEditable = props.valueEditable !== false
  const state = fieldValueState(schema, value, nullable)
  const { presence, missing, invalidNull } = state
  const shape = fieldValueShape(schema, value, { compactCollection: compactValue && props.header == null, objectChild: props.objectChild, depth })
  const { type, complex, enumeration, choiceOptions } = shape
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [raw, setRaw] = useState(false)
  const focusCreatedValue = useRef(false)
  const [editorFocusRequest, setEditorFocusRequest] = useState(0)
  const [optionsOpen, setOptionsOpen] = useState(false)
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
  const itemEnumeration = source.uniqueItems === true ? objectValue(source.items)?.enum : undefined
  const showUnset =
    type !== 'boolean' &&
    !enumeration &&
    !itemEnumeration &&
    !choiceOptions &&
    !complex &&
    !shape.collection &&
    source['ui:widget'] !== 'text' &&
    state.display === 'unset' &&
    props.editor === undefined &&
    valueEditable
  const optionLabels = objectValue(source['ui:options'])?.labels
  const array = Array.isArray(value) ? value : []
  const canChooseType = source.type == null || Array.isArray(source.type)
  const availableTypes = Array.isArray(source.type) ? types.filter((candidate) => (source.type as unknown[]).includes(candidate)) : types
  const structured = !raw && shape.collection && props.editor === undefined
  const expandable = !showUnset && (structured || (valueEditable && (raw || complex || (type === 'string' && source['ui:widget'] === 'text'))))
  const uncreatedText = compactValue && expandable && shape.text && !raw && presence !== 'value'
  const hasBranch = expandable && !uncreatedText && !(structured && type === 'object' && presence !== 'value')
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
  if (!errors.length && props.validationError && !draftInvalid && props.editor === undefined) errors.push({ instancePath: '', message: props.validationError })
  if (!errors.length && props.invalid && !draftInvalid && props.editor === undefined) errors.push({ instancePath: '', message: t('valueEditor.schema') })
  const { expanded, bodyMounted, setExpanded } = useFieldExpansion(
    {
      depth,
      expandable: expandable && !uncreatedText,
      editable: valueEditable && !disabled,
      empty: state.empty,
      validation: errors.length > 0 ? 'invalid' : needsValidation && issues == null ? 'pending' : 'valid',
    },
    props.expansionPolicy,
  )
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
  useEffect(() => {
    if (!expanded || !editorFocusRequest || disabled || raw || complex) return
    container?.querySelector<HTMLTextAreaElement>(':scope > [data-value-body] > textarea')?.focus()
  }, [expanded, editorFocusRequest, disabled, raw, complex, container])
  const {
    editorInvalid: invalid,
    summaryInvalid,
    messages,
    anchor,
  } = valueFeedback(errors, {
    expanded: hasBranch && expanded,
    hasSummary: expandable && compactValue,
    hasChildren: structured,
    draftInvalid,
  })
  useEffect(() => {
    props.onInvalidChange?.(invalid)
  }, [invalid, props.onInvalidChange])
  const errorMessage = messages.length > 0 && (
    <div id={`${id}-error`} className={styles.error} role="alert">
      {messages.map((message) => (
        <div key={message}>{message}</div>
      ))}
    </div>
  )
  const inlineTools = !props.hideValueTools && (props.layout === 'values' || props.layout === 'ports') && valueEditable && !disabled && !sorting
  const canClear = inlineTools && state.canClear
  const canToggleJson = inlineTools && expanded && shape.collection && presence === 'value'
  const arrayDefinition = props.header != null && source.type === 'array' && !Array.isArray(source.items) && !choiceOptions
  const typeAddon =
    props.valueSuffix ??
    (arrayDefinition ? (
      <FieldTypeAddon
        schema={source.items ?? {}}
        name={`${label}[]`}
        menuTitle={t('valueEditor.arrayItemTypeTitle')}
        disabled={disabled}
        onChange={
          props.onDefinitionChange
            ? (items) => props.onDefinitionChange!({ ...source, items }, Array.isArray(value) ? value.map((item) => valueForEditor(items, item)) : value)
            : undefined
        }
      />
    ) : undefined)
  const emptyCollection = structured && presence !== 'value'
  const needsCreation = emptyCollection || uncreatedText
  const valueSuffix =
    !expandable && !showUnset && (enumeration || itemEnumeration || source['ui:widget'] === 'color' || isDateFormat(source.format))
      ? 26
      : type === 'boolean' && !expandable && !showUnset
        ? 30
        : expandable && compactValue && props.header == null && !needsCreation
          ? 26
          : 0
  const createValue =
    uncreatedText && valueEditable && !disabled
      ? () => {
          onChange('')
          setEditorFocusRequest((request) => request + 1)
        }
      : emptyCollection
        ? collectionCreateAction(props)
        : undefined
  const toggleExpanded = () => {
    setExpanded(!expanded)
    if (!expanded) setEditorFocusRequest((request) => request + 1)
  }
  const toolbar = (
    <div
      className={styles.toolbar}
      onClick={(event) => {
        if (!inlineTools && (event.target as HTMLElement).closest('button') && !(event.target as HTMLElement).closest('[data-field-options]'))
          setOptionsOpen(false)
      }}
    >
      {valueEditable && !inlineTools && (
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
          <span className={styles.presence}>{state.display === 'null' ? 'null' : presence === 'unset' ? t('valueEditor.unset') : ''}</span>
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
          {state.canClear && (
            <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange(undefined)}>
              <i aria-hidden="true" className="i-lucide-light:eraser" />
              {t('valueEditor.clear')}
            </Button>
          )}
        </>
      )}
      {props.description && <p className={styles.description}>{props.description}</p>}
      {props.options}
    </div>
  )
  const firstName = objectFieldNames(schema, value)[0]
  const firstSchema = firstName == null ? undefined : (objectValue(source.properties)?.[firstName] ?? source.additionalProperties ?? {})
  const firstValue = firstName == null ? undefined : objectValue(value)?.[firstName]
  const childMarker =
    type === 'array'
      ? array.length > 0
      : firstName != null &&
        ((sorting && props.onDefinitionChange != null) || fieldValueShape(firstSchema, firstValue, { objectChild: true, depth: depth + 1 }).expandable)
  const shouldMountBody = !compactValue || !expandable || expanded || bodyMounted
  const body = shouldMountBody && !uncreatedText && (
    <FieldBranch
      depth={depth + 1}
      endpoint={structured && presence === 'value' && childMarker ? 'marker' : 'control'}
      id={`${id}-body`}
      className={styles.body}
      data-value-body
      hidden={(compactValue && expandable && !expanded) || (expandable && !hasBranch)}
    >
      {!showUnset && !compactValue && valueEditable && presence !== 'value' && (
        <span className={styles.presence}>{state.display === 'null' ? 'null' : t('valueEditor.unset')}</span>
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
      ) : valueEditable && (raw || complex) ? (
        <JsonEditor
          {...props}
          onDraftIssue={reportDraftIssue}
          value={state.display === 'null' ? null : value}
          invalid={invalid}
          focusRequest={expanded ? editorFocusRequest : 0}
        />
      ) : props.editor !== undefined ? (
        props.editor
      ) : structured ? (
        type === 'object' ? (
          <ObjectValueFields {...props} empty={presence !== 'value'} />
        ) : (
          <ArrayValueFields {...props} empty={presence !== 'value'} />
        )
      ) : (state.display === 'null' || presence === 'null') && !choiceOptions && !enumeration ? (
        <Button
          type="button"
          variant="field"
          size="field"
          className={styles.nullValue}
          data-field-control
          disabled={disabled}
          aria-invalid={invalid}
          aria-label={`${label} null`}
          onClick={() => {
            const next = initialValue(schema)
            onChange(next == null && type !== 'null' ? getDefaultValue(type) : next)
          }}
        >
          <span className={styles.nullChip}>null</span>
        </Button>
      ) : choiceOptions ? (
        <EditableChoices
          options={choiceOptions}
          labels={optionLabels}
          value={state.display === 'null' ? null : value}
          label={label}
          disabled={disabled}
          invalid={invalid}
          multiple={!Array.isArray(source.enum)}
          onChange={onChange}
          onOptionsChange={
            props.onDefinitionChange
              ? (options, deletion) => {
                  const nextSchema = Array.isArray(source.enum)
                    ? { ...source, enum: options }
                    : { ...source, items: { ...objectValue(source.items), enum: options } }
                  props.onDefinitionChange!(nextSchema, valueForEditor(nextSchema, value), deletion)
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
      ) : (
        <ValueEditor {...props} onDraftIssue={reportDraftIssue} invalid={invalid} />
      )}
      {anchor === 'body' && errorMessage}
    </FieldBranch>
  )
  return (
    <FieldRow
      label={label}
      header={props.header}
      leadingControl={props.leadingControl}
      disclosureContent={props.disclosureContent}
      layout={props.layout}
      depth={depth}
      typeWidth={props.typeWidth}
      columns={props.columns}
      gap={props.gap}
      sorting={sorting}
      disclosure={hasBranch ? { controls: `${id}-body`, expanded, onToggle: toggleExpanded } : undefined}
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
      data-header={props.header != null || undefined}
      data-collection={expandable || undefined}
      data-value-addon={props.valueAddon != null || undefined}
      data-value-suffix={typeAddon != null || undefined}
      data-value-prefix={arrayDefinition || undefined}
      data-expanded={(hasBranch && expanded) || undefined}
      data-structured={(structured && !showUnset) || undefined}
      data-branch={hasBranch || undefined}
    >
      {arrayDefinition && <span className={styles.valuePrefix}>{t('valueEditor.arrayOf')}</span>}
      {props.valueAddon != null && (
        <div className={styles.valueAddon} data-value-addon-control>
          {props.valueAddon}
        </div>
      )}
      {compactValue && expandable && (
        <Button
          type="button"
          variant="disclosure"
          size="field"
          className={styles.summary}
          data-field-prompt={summaryInvalid || undefined}
          data-readonly={disabled || undefined}
          data-field-control
          disabled={sorting || (!hasBranch && !createValue) || (needsCreation && !createValue)}
          aria-label={`${label} ${t('valueEditor.setValue')}`}
          aria-expanded={needsCreation || !hasBranch ? undefined : expanded}
          aria-invalid={summaryInvalid}
          aria-controls={`${id}-body`}
          onClick={
            needsCreation
              ? () => {
                  createValue?.()
                  setExpanded(true)
                }
              : toggleExpanded
          }
        >
          <span className={styles.summaryText}>
            {state.display === 'null'
              ? 'null'
              : presence === 'unset'
                ? t('valueEditor.unset')
                : structured
                  ? JSON.stringify(value)
                  : typeof value === 'string'
                    ? value === ''
                      ? t('valueEditor.emptyStringValue')
                      : value
                    : JSON.stringify(value)}
          </span>
          {props.header == null && hasBranch && !needsCreation && <SelectChevron className={expanded ? 'rotate-180' : undefined} />}
        </Button>
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
                setExpanded(shape.expandable)
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
      {typeAddon != null && (
        <div className={styles.valueAddon} data-value-addon-control data-side="end">
          {typeAddon}
        </div>
      )}
      {props.trailingControl}
      {(!props.hideOptions || props.actions) && (
        <div className={styles.options}>
          {props.actions}
          {!props.hideOptions &&
            (props.options && props.header != null && (props.layout === 'values' || props.layout === 'ports') ? (
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
    </FieldRow>
  )
}
