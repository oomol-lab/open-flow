import styles from './handleEditor.module.scss'
import type { useStoreApi } from '@xyflow/react'
import type { JSX } from 'react/jsx-runtime'
import type { Val } from 'value-enhancer'
import type { BaseCascadeOption } from '../components/cascade.tsx'
import type { ColorType } from '../components/constants.ts'
import type { IHandleAction } from '../components/handleRow.tsx'
import type { DesignerOption as IBasicOption } from '../components/select.tsx'
import type { HandleIndex } from '../stores/node/constants.ts'
import type { AnyOfWidgetStore } from '../stores/nodeHandle/anyOfWidget.store.ts'
import type { ArrayItemStore, ArrayWidgetStore } from '../stores/nodeHandle/arrayWidget.store.ts'
import type { HandleError, HandleRowStore } from '../stores/nodeHandle/handleRow.store.ts'
import type { ObjectFieldStore, ObjectWidgetStore } from '../stores/nodeHandle/objectWidget.store.ts'
import type { WidgetStore } from '../stores/nodeHandle/reconcileWidget.ts'
import type { WidgetContext } from '../stores/nodeHandle/widgetContext.ts'
import type { WidgetSelectOption, WidgetType } from './preset.ts'
import type { JsonSchema } from './types.ts'

import { isDefined, isString } from '@wopjs/cast'
import { clsx } from 'clsx'
import { memo, useCallback, useMemo, useState } from 'react'
import { useDerived, useVal, useValues } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { setValue, val } from 'value-enhancer'
import { formatSecretReference, parseSecretReference } from '../../../secret/common/reference.ts'
import { HANDLE_ROW_CLASSNAME, HANDLE_ROW_EXPANDED_CLASSNAME } from '../base/designer.ts'
import { stopEvent } from '../base/dom.ts'
import { toRFHandleName } from '../base/rfHelpers.ts'
import {
  asArray,
  asNumber,
  asString,
  asTrue,
  deepGet,
  equalConfig,
  filterString,
  inspect,
  isBannedName,
  toArray,
  toggle,
  toNumber,
  toPlainObject,
  toTrue,
  trueFalse,
} from '../base/trivial.ts'
import { Button } from '../components/button.tsx'
import { Cascade } from '../components/cascade.tsx'
import { DesignerCheckbox } from '../components/checkbox.tsx'
import { ColorPicker } from '../components/colorPicker.tsx'
import { asColorType, asDate, asDateTimeFormat, formatDate } from '../components/constants.ts'
import { DateTimePicker } from '../components/dateTimePicker.tsx'
import { Handle } from '../components/handle.tsx'
import { HandleRow } from '../components/handleRow.tsx'
import { Input } from '../components/input.tsx'
import { Label } from '../components/label.tsx'
import { Null } from '../components/null.tsx'
import { DesignerCombobox as Select } from '../components/select.tsx'
import { LabeledSwitch } from '../components/toggleSwitch.tsx'
import { DesignerTooltip } from '../components/tooltip.tsx'
import { useDesignerType } from '../graph/DesignerStoreContext.tsx'
import { useNodeType } from '../graph/Nodes/NodeStoreContext.tsx'
import { useSubflowViewMode } from '../graph/SubflowDesigner/SubflowViewModeContext.ts'
import { SUBFLOW_VIEW_MODE } from '../stores/designer/subflowDesigner.store.ts'
import { DESIGNER_TYPE } from '../stores/designer/typings.ts'
import { NODE_TYPE } from '../stores/node/constants.ts'
import { useHandleEditorContext } from './handleEditorContext.ts'
import {
  asPrimitiveType,
  getBaseSchema,
  getDefaultValue,
  iconOf,
  inferPrimitiveType,
  inferSchemaTypeFromPrimitive,
  isUndecidable,
  isWidgetType,
  optionOf,
  typeOfSchema,
  ui_options,
  widgetSelectOptions,
} from './preset.ts'
import { SchemaEditor } from './schemaEditor.tsx'

export interface HandleEditorProps {
  readonly store: HandleRowStore
  readonly panelWidth$: Val<number | undefined>
  readonly reactFlowStore?: ReturnType<typeof useStoreApi>
  readonly presentation?: 'form' | 'handle'
  readonly showSchemaSettings?: boolean
  /** Return an error message when a proposed name is invalid. */
  validate?: (name: string, oldName: string) => string | undefined
  onRename?: (name: string) => void
  onDelete?: () => void
  readonly dragTarget?: HandleIndex
  readonly dragPosition?: number
  onDragStart?: (ev: React.DragEvent<HTMLElement>) => void
  onDragOver?: (ev: React.DragEvent<HTMLElement>) => void
}

export function HandleEditor({
  store,
  panelWidth$,
  reactFlowStore,
  presentation = 'handle',
  showSchemaSettings = true,
  validate,
  onRename,
  onDelete,
  dragTarget,
  dragPosition = 0,
  onDragStart,
  onDragOver,
}: HandleEditorProps): JSX.Element {
  const { context } = store

  const t = useTranslate()
  const widget = useVal(store.widget$)
  const collapsed = useVal(widget.collapsed$)
  const descCollapsed = useVal(widget.descCollapsed$)

  const schemaType = useVal(widget.schemaWidgetType$)
  const widgetType = useVal(widget.widgetType$)
  const restricted = useVal(context.restrict$) != null
  const hasSubpanel = useVal(widget.hasSubpanel$)

  const description = useVal(store.displayDescription$)
  const reference = useVal(store.reference$)
  const nullable = useVal(store.nullable$)
  const showSettings = useVal(store.showSettings$)
  const kind = useVal(store.kind$)
  const formError = useVal(presentation === 'form' ? store.error$ : undefined)
  const formSchema = useVal(presentation === 'form' ? store.schema$ : undefined)
  const formValue = useVal(presentation === 'form' ? store.value$ : undefined)

  const rfHandleId = toRFHandleName(store.name)

  const renameError$ = useMemo(() => val<string | undefined>(), [])
  const onUpdateName = useCallback((name: string): void => renameError$.set(validate?.(name, store.name)), [renameError$, store, validate])
  const onCommit = useCallback(
    (name: string) => {
      if (renameError$.value) {
        return
      } else if (name !== store.name) {
        onRename?.(name)
      } else {
        renameError$.set(undefined)
      }
    },
    [store, onRename],
  )
  const renameError = useVal(renameError$)

  if (presentation === 'form') {
    const required = asArray(toPlainObject(formSchema)?.required).filter(isString)
    const value = toPlainObject(formValue)
    const missing = required.filter((name) => value?.[name] === undefined)
    const errorMessage =
      formError == null
        ? undefined
        : missing.length > 0
          ? t('inputHandleEditor.requiredFieldsUnset', { fields: missing.join(', ') })
          : formError.type === 'typeError'
            ? t('inputHandleEditor.typeError', { expected: asPrimitiveType(schemaType) || schemaType })
            : formError.message.startsWith('$')
              ? t(`inputHandleEditor.${formError.message.slice(1)}`)
              : t('inputHandleEditor.validationError', { message: formError.message })

    return (
      <>
        {errorMessage != null && (
          <div className={styles.formError} role="alert">
            <i aria-hidden="true" className="i-codicon:error" />
            <span>{errorMessage}</span>
          </div>
        )}
        {hasSubpanel ? (
          <Subpanel isLast type={widgetType} store={widget} nullable={nullable} presentation="form" />
        ) : (
          <HandleRow className={styles[context.inout]} variant="value-only" value={<ValueReconciler type={widgetType} store={widget} nullable={nullable} />} />
        )}
      </>
    )
  }

  return (
    <>
      {dragTarget?.handle === store.name && toTrue(dragPosition < 0) && <div className={styles.dragIndicator} />}
      <HandleRow
        className={clsx(styles[context.inout])}
        prefix={
          <>
            {(context.handlePosition || context.inout) === 'in' && <Handle id={rfHandleId} type="input" kind={kind} />}
            {context.canEditSchema && onDragStart && (
              <div draggable className={styles.dragHandle} onDragStart={onDragStart} data-handle={`h:${store.name}`}>
                <i className="i-carbon:draggable" />
              </div>
            )}
          </>
        }
        suffix={(context.handlePosition || context.inout) === 'out' && <Handle id={rfHandleId} type="output" kind={kind} />}
        expanded={reference ? null : hasSubpanel ? !collapsed : null}
        onExpandedChange={(e) => setValue(widget.collapsed$, !e)}
        name={
          <DesignerTooltip open={!!renameError} placement="left" title={renameError}>
            <div className={styles.handleNameWrapper}>
              <Input
                selectOnFocus
                className={clsx(renameError && styles.renameError)}
                value={store.name}
                title={store.name + (description ? `\n${description}` : '')}
                readOnly={!context.canEditSchema}
                onChange={onUpdateName}
                onRealChange={onCommit}
                onBlur={(input) => {
                  input.value = store.name
                  renameError$.set(undefined)
                }}
              />
            </div>
          </DesignerTooltip>
        }
        value={<RootField reference={reference} nullable={nullable} type={schemaType} store={widget} descCollapsed={descCollapsed} error$={store.error$} />}
        actions={[
          <DesignerCheckbox
            ariaLabel={t('inputHandleEditor.nullable')}
            checked={nullable}
            disabled={restricted || !context.canEditSchema}
            onChange={(checked) => {
              setValue(store.nullable$, checked)
              if (checked && store.value$ && store.value$.value === undefined) {
                setValue(store.value$, null)
              } else if (!checked && store.value$?.value === null) {
                setValue(store.value$, undefined)
              }
            }}
            titlePlacement="right"
            onContextMenu={(ev) => {
              ev.preventDefault()
              if (context.canEditSchema) {
                setValue(store.nullable$, true)
              }
              if (context.canEditValue && store.nullable$.value && store.value$) {
                setValue(store.value$, null)
              }
            }}
          />,
          showSchemaSettings && (
            <div className={styles.showSettings}>
              <Button active={showSettings} disabled={!context.canViewSchema} onClick={() => setValue(store.showSettings$, !showSettings)}>
                <i className={iconOf('settings')} />
              </Button>
              {showSettings && (
                <div className={styles.schemaEditor} onClickCapture={stopEvent}>
                  <SchemaEditor
                    title={context.inout === 'in' ? t('inputHandleEditor.configPanelTitle') : t('outputHandleEditor.configPanelTitle')}
                    store={store.schemaRowStore}
                    panelWidth$={panelWidth$}
                    reactFlowStore={reactFlowStore}
                    onClose={() => setValue(store.showSettings$, false)}
                    validate={validate}
                    onRename={onRename}
                    onDelete={onDelete}
                  />
                </div>
              )}
            </div>
          ),
        ]}
        onDragOver={onDragOver}
      />
      {!store.value$ && !descCollapsed && <SchemaDescription store={widget} subpanel={hasSubpanel && !collapsed} onDragOver={onDragOver} />}
      {!reference && hasSubpanel && !collapsed && <Subpanel level=" " isLast type={widgetType} store={widget} onDragOver={onDragOver} nullable={nullable} />}
      {dragTarget?.handle === store.name && toTrue(dragPosition > 0) && <div className={styles.dragIndicator} />}
    </>
  )
}

interface RootFieldProps {
  readonly reference?: boolean
  readonly nullable?: boolean
  readonly type: WidgetType
  readonly descCollapsed?: boolean
  readonly store: WidgetStore
  readonly error$: Val<HandleError | undefined>
}

function RootField(props: RootFieldProps) {
  const t = useTranslate()
  const designerType = useDesignerType()
  const subflowViewMode = useSubflowViewMode()
  const nodeType = useNodeType()
  const hasValue = props.store.value$ != null
  const restricted = useVal(props.store.context.restrict$) != null
  const error = useVal(props.error$)
  const options = widgetSelectOptions(t, (type) => !isBannedType(props.store.context, type))

  const showError = toTrue(
    designerType !== DESIGNER_TYPE.Block &&
      !(designerType === DESIGNER_TYPE.Subflow && subflowViewMode === SUBFLOW_VIEW_MODE.Block) &&
      nodeType !== NODE_TYPE.InputNode &&
      nodeType !== NODE_TYPE.OutputNode &&
      props.store.context.canEditValue,
  )

  const localize = (message?: string): string | undefined => {
    if (!message) return message
    if (message[0] === '$') return t(`inputHandleEditor.${message.slice(1)}`)
    return message
  }

  const onChange = (e: WidgetSelectOption | null) => {
    if (e) {
      if (isWidgetType(e.value)) {
        setValue(props.store.schema$, getBaseSchema(e.value, props.store.schema$.value))
      }
    }
  }

  const body =
    !hasValue && props.type === 'array' ? (
      <ValueInlineArray type={props.type} nullable={props.nullable} store={props.store as ArrayWidgetStore} options={options} onChange={onChange} />
    ) : (
      <Select value={optionOf(t, props.type)} options={options} disabled={restricted || !props.store.context.canEditSchema} onChange={onChange} />
    )

  return (
    <div className={clsx(styles.value, !hasValue && styles.noValue)}>
      {props.store.context.enableSchemaDesc ? (
        <div className={styles.withDescButton}>
          {body}
          <Button
            className={styles.descButton}
            onClick={toggle(props.store.descCollapsed$)}
            active={!props.descCollapsed}
            title={t('handleEditor.descButton')}
            titlePlacement="top"
          >
            <i className="i-carbon:playlist" />
          </Button>
        </div>
      ) : (
        body
      )}
      {hasValue && (
        <DesignerTooltip className={styles.errorOverlay} placement="top" title={showError && localize(error?.message)}>
          <div className={clsx(styles.inlineValue, showError && error && styles.error)}>
            {props.reference ? (
              <ValueReference isSuffix type="binary" store={props.store} />
            ) : (
              <ValueReconciler isSuffix type={props.type} nullable={props.nullable} store={props.store} showError={showError} />
            )}
          </div>
        </DesignerTooltip>
      )}
    </div>
  )
}

interface SchemaDescriptionProps {
  readonly store: WidgetStore
  readonly subpanel: boolean
  readonly onDragOver?: (ev: React.DragEvent<HTMLElement>) => void
}

function SchemaDescription(props: SchemaDescriptionProps) {
  const t = useTranslate()
  const description = useVal(props.store.description$)

  return (
    <HandleRow
      resizable
      className={styles[props.store.context.inout]}
      variant="value-only"
      isLast={!props.subpanel}
      level={props.subpanel ? '|' : void 0}
      value={
        <Input
          multiline
          value={description}
          height={false}
          onResize={props.store.height$.set}
          maxHeight={TEXTAREA_MAX_HEIGHT}
          onChange={props.store.description$.set}
          readOnly={!props.store.context.canEditSchema}
          placeholder={t('handleEditor.schemaDescription')}
        />
      }
      onDragOver={props.onDragOver}
    />
  )
}

interface SubpanelProps {
  readonly level?: string
  readonly isLast?: boolean
  readonly nullable?: boolean
  readonly presentation?: 'form'
  readonly type: WidgetType
  readonly store: WidgetStore
  onDragOver?: (ev: React.DragEvent<HTMLElement>) => void
}

function Subpanel(props: SubpanelProps) {
  switch (props.type) {
    case 'text':
      return <SubpanelText {...props} />
    case 'object':
      if (!props.store.isObject()) {
        console.warn('Expecting object widget store, got', props.store)
        return null
      }
      return <SubpanelObject {...props} store={props.store as ObjectWidgetStore} />
    case 'array':
      if (!props.store.isArray()) {
        console.warn('Expecting array widget store, got', props.store)
        return null
      }
      return <SubpanelArray {...props} store={props.store as ArrayWidgetStore} />
    default:
      if (props.store.isAnyOf()) {
        return <SubpanelAnyOf {...props} store={props.store as AnyOfWidgetStore} />
      }
      return <SubpanelOther {...props} />
  }
}

function SubpanelOther(props: SubpanelProps) {
  return (
    <HandleRow
      className={styles[props.store.context.inout]}
      level={props.level}
      isLast={props.isLast}
      variant="value-only"
      value={<ValueReconciler {...props} />}
      onDragOver={props.onDragOver}
    />
  )
}

function SubpanelAnyOf(props: SubpanelProps & { readonly store: AnyOfWidgetStore }) {
  const condition = useVal(props.store.condition$)
  const widget = useVal(condition?.widget$)
  const schemaType = useVal(widget?.schemaWidgetType$)

  // An empty anyOf condition has no subpanel. The level marker may look invalid, but the source is already malformed.
  if (!condition || !widget || !schemaType) {
    return null
  }

  return <Subpanel isLast level={props.level} type={schemaType} store={widget} nullable={props.nullable} presentation={props.presentation} />
}

const TEXTAREA_MAX_HEIGHT = 300

function SubpanelText(props: SubpanelProps) {
  const value = useDerived(props.store.value$, asString)
  const height = useVal(props.store.height$)

  return (
    <HandleRow
      resizable
      className={styles[props.store.context.inout]}
      variant="value-only"
      level={props.level}
      isLast={props.isLast}
      value={
        <Input
          multiline
          value={value}
          height={height}
          onResize={props.store.height$.set}
          maxHeight={TEXTAREA_MAX_HEIGHT}
          onChange={props.store.value$?.set}
          readOnly={!props.store.context.canEditValue}
        />
      }
      onDragOver={props.onDragOver}
    />
  )
}

interface ValueProps extends SubpanelProps {
  // Array items do not need leading padding.
  readonly isSuffix?: boolean
  // The validation error for the current value.
  readonly error?: string
  // Whether to display the validation error.
  readonly showError?: true
  // Text and object values render differently inside a recursive anyOf branch.
  readonly isInsideAnyOf?: boolean
  readonly onRequestType?: () => void
}

let reconcilerLoop = 0
let reconcilerTimer = 0
function onRenderValueReconciler(props: ValueProps) {
  const now = Date.now()
  if (now - reconcilerTimer > 500) {
    reconcilerLoop = 0
    reconcilerTimer = now
  }
  reconcilerLoop++
  if (reconcilerLoop > 1000) {
    throw new Error('Reconciler loop too much on ' + props.type)
  }
}

const ValueReconciler = /*#__PURE__*/ memo(function ValueReconciler(props: ValueProps) {
  onRenderValueReconciler(props)

  const t = useTranslate()
  const value = useVal(props.store.value$)
  const expected = asPrimitiveType(props.type)
  const valueType = inferPrimitiveType(value)

  const schema = useVal(props.type == 'select' || props.type == 'multiSelect' || props.type == 'anyOf' ? props.store.schema$ : undefined)

  // Open the schema editor when enum or anyOf options are empty.
  if (props.store.context.canEditSchema) {
    let shouldOpenSchemaEditor = false
    if (props.type === 'select') {
      const enumValues = deepGet(schema, ['enum'])
      if (asArray(enumValues).length === 0) {
        shouldOpenSchemaEditor = true
      }
    } else if (props.type === 'multiSelect') {
      const enumValues = deepGet(schema, ['items', 'enum'])
      if (asArray(enumValues).length === 0) {
        shouldOpenSchemaEditor = true
      }
    } else if (props.type === 'anyOf') {
      const anyOf = deepGet(schema, ['anyOf'])
      if (asArray(anyOf).length === 0) {
        shouldOpenSchemaEditor = true
      }
    }

    if (shouldOpenSchemaEditor) {
      return <ValueOpenSchemaEditor {...props} />
    }
  }

  // Select supports several value types, so validate against the schema enum.
  if (props.type === 'select' && !toArray(toPlainObject(schema)?.enum)?.includes(value)) {
    if (value === null && props.nullable) {
      return <ValueNullable {...props} />
    }

    return <ValueError {...props} error={t('inputHandleEditor.enumError')} />
  }

  // Show a repair action when the value has the wrong type.
  if (expected && valueType !== expected) {
    if (value === null && props.nullable) {
      return <ValueNullable {...props} />
    }

    return <ValueError {...props} error={t('inputHandleEditor.typeError', { expected: expected || 'any' })} />
  }

  switch (props.type) {
    case 'string':
      return <ValueString {...props} />
    case 'number':
    case 'integer':
      return <ValueNumber {...props} />
    case 'secret':
      return <ValueSecret {...props} />
    case 'boolean':
      return <ValueBoolean {...props} />
    case 'color':
      return <ValueColor {...props} />
    case 'text':
      return <ValueText {...props} />
    case 'object':
      return <ValueObject {...props} />
    case 'array':
      if (!props.store.isArray()) {
        console.warn('Expecting array widget store, got', props.store)
        return null
      }
      return <ValueArray {...props} store={props.store as ArrayWidgetStore} />
    case 'select':
      return <ValueSelect {...props} />
    case 'multiSelect':
      return <ValueMultiSelect {...props} />
    case 'date':
      return <ValueDate {...props} />
    case 'anyOf':
    case 'allOf':
    case 'oneOf':
      if (!props.store.isAnyOf()) {
        console.warn('Expecting anyOf widget store, got', props.store)
        return null
      }
      return <ValueAnyOf {...props} store={props.store as AnyOfWidgetStore} />
    case 'binary':
      return <ValueBinary {...props} />
    case 'any':
    case 'variable':
      return <ValueAny {...props} />
    case 'null':
      return <ValueNull {...props} />
    default:
      return <ValueUnknown {...props} />
  }
})

function ValueString(props: ValueProps) {
  const value = useDerived(props.store.value$, asString)

  return (
    <Input
      isSuffix={props.isSuffix}
      value={value}
      onChange={(e: string | null) => {
        if (!props.nullable && e == null) {
          props.store.value$?.set(undefined)
        } else {
          props.store.value$?.set(e)
        }
      }}
      isClearable={props.store.context.canEditValue}
      readOnly={!props.store.context.canEditValue}
    />
  )
}

function ValueText(props: ValueProps) {
  const string = useDerived(props.store.value$, asString)
  const collapsed = useVal(props.store.collapsed$)

  const foldIcon = collapsed ? 'i-carbon:expand-all' : 'i-carbon:collapse-all'

  return (
    <Button
      isSuffix={props.isSuffix}
      wrapperClassName={toTrue(props.isInsideAnyOf) && styles.isInsideAnyOf}
      className={clsx(styles.expandButton, !collapsed && styles.expanded)}
      onClick={() => setValue(props.store.collapsed$, !collapsed)}
      onClear={toTrue(props.store.context.canEditValue) && (() => props.store.value$?.set(props.nullable ? null : undefined))}
      disabled={!props.store.context.canEditValue}
    >
      <span data-type={props.type}>{props.isInsideAnyOf ? <i className={`${foldIcon} mb-[2px]`} /> : string}</span>
    </Button>
  )
}

function ValueNumber(props: ValueProps) {
  const value = useDerived(props.store.value$, asNumber) ?? 0
  const schema = useDerived(props.store.schema$, toPlainObject, equalConfig)

  const step = asNumber(deepGet(schema, [ui_options, 'step'])) || (props.type === 'integer' ? 1 : 0.01)
  const minimumValue = toNumber(schema?.exclusiveMinimum) ?? toNumber(schema?.minimum)
  const maximumValue = toNumber(schema?.exclusiveMaximum) ?? toNumber(schema?.maximum)

  return (
    <Input
      isSuffix={props.isSuffix}
      type="number"
      step={step}
      min={minimumValue}
      max={maximumValue}
      value={String(value)}
      onChange={(raw: string | null) => props.store.value$?.set(raw === null ? (props.nullable ? raw : undefined) : asNumber(raw, props.type === 'integer'))}
      onBlur={(input) => {
        input.value = String(value)
      }}
      isClearable={props.store.context.canEditValue}
      readOnly={!props.store.context.canEditValue}
      returnToCommit
    />
  )
}

function ValueSecret(props: ValueProps) {
  const t = useTranslate()
  const root = useHandleEditorContext()
  const reference = useDerived(props.store.value$, parseSecretReference)
  const value = reference ? [reference.secretId, reference.key] : undefined
  const secrets = useValues(root.secretStore?.items$)
  const loading = useVal(root.secretStore?.loading$)
  const descriptors = useMemo(() => secrets ?? [], [secrets])
  const options = useMemo<BaseCascadeOption[]>(
    () =>
      descriptors.map((secret) => ({
        icon: 'i-carbon:api-key',
        label: secret.name,
        value: secret.secretId,
        children: secret.fields.map((field) => ({ label: field.key, value: field.key })),
      })),
    [descriptors],
  )

  const missing =
    root.secretStore != null &&
    reference != null &&
    !loading &&
    !descriptors.some((secret) => secret.secretId === reference.secretId && secret.fields.some((field) => field.key === reference.key))
  const warning = missing ? '$secretNotFound' : undefined

  const localize = (message?: string): string | undefined => {
    if (!message) return message
    if (message[0] === '$') return t(`inputHandleEditor.${message.slice(1)}`)
    return message
  }

  return (
    <Cascade
      isSuffix={props.isSuffix}
      title={root.secretStore ? undefined : t('handleEditor.secretUnavailable')}
      options={options}
      value={value}
      onChange={(raw) => {
        const secret = descriptors.find((descriptor) => descriptor.secretId === raw?.[0])
        const key = raw?.[1]
        const next = secret && key ? formatSecretReference({ secretId: secret.secretId, key }) : null
        props.store.value$?.set(next === null ? (props.nullable ? next : undefined) : next)
      }}
      disabled={!props.store.context.canEditValue}
      loading={loading}
      warning={localize(warning)}
    />
  )
}

function ValueBoolean(props: ValueProps) {
  const value = useDerived(props.store.value$, asTrue)

  // return (
  //   <DesignerCheckbox
  //     isSuffix={props.isSuffix}
  //     checked={value}
  //     onChange={props.store.value$?.set}
  //     label={trueFalse}
  //     disabled={!props.store.context.canEditValue}
  //   />
  // );

  return (
    <LabeledSwitch
      isSuffix={props.isSuffix}
      checked={value}
      onChange={props.store.value$?.set}
      label={trueFalse}
      onClear={toTrue(props.store.context.canEditValue) && (() => props.store.value$?.set(props.nullable ? null : undefined))}
      disabled={!props.store.context.canEditValue}
    />
  )
}

function ValueColor(props: ValueProps) {
  const colorType = useDerived(props.store.schema$, (schema) => asColorType(deepGet(toPlainObject(schema), [ui_options, 'colorType'])))
  const value = useDerived(props.store.value$, asString)
  const onTypeChange = (type: ColorType) => {
    const schema = toPlainObject(props.store.schema$.value)
    props.store.schema$?.set({ ...schema, [ui_options]: { ...toPlainObject(schema?.[ui_options]), colorType: type } })
  }

  return (
    <ColorPicker
      isSuffix={props.isSuffix}
      type={colorType}
      onTypeChange={toTrue(props.store.context.canEditSchema) && onTypeChange}
      value={value}
      onChange={(e) => props.store.value$?.set(e === null ? (props.nullable ? e : undefined) : e)}
      isClearable={props.store.context.canEditValue}
      disabled={!props.store.context.canEditValue}
    />
  )
}

interface EnumOption extends IBasicOption {
  readonly label: string | undefined
  readonly value: string
  readonly realValue: unknown
}

function ValueSelect(props: ValueProps) {
  const options: EnumOption[] = useDerived(props.store.schema$, (schema_) => {
    const schema = toPlainObject(schema_)
    const values = toArray(schema?.enum) || []
    const labels = toArray(toPlainObject(schema?.[ui_options])?.labels) || []
    return values.map((v, i) => ({ label: filterString(labels[i] ?? v), value: asString(v), realValue: v }))
  })

  const selectedValue = useDerived(props.store.value$, asString) ?? ''
  const value: IBasicOption = options.find((option) => option.value === selectedValue) || { label: selectedValue, value: selectedValue }

  return (
    <Select
      isSuffix={props.isSuffix}
      options={options}
      value={value}
      isClearable={props.store.context.canEditValue}
      onChange={(raw) => {
        const e = raw?.value ?? null
        const v = e === null ? (props.nullable ? e : undefined) : (options.find((o) => o.value === e)?.realValue ?? e)
        props.store.value$?.set(v)
      }}
      disabled={!props.store.context.canEditValue}
    />
  )
}

function ValueMultiSelect(props: ValueProps) {
  const options: IBasicOption[] = useDerived(props.store.schema$, (schema_) => {
    const schema = toPlainObject(schema_)
    const values = toArray(toPlainObject(schema?.items)?.enum) || []
    const labels = toArray(toPlainObject(schema?.[ui_options])?.labels) || []
    return values.map((v, i) => ({ label: filterString(labels[i] ?? v), value: filterString(v) }))
  })

  const selectedValues = useDerived(props.store.value$, toArray) ?? []
  const value: IBasicOption[] = selectedValues.map((selectedValue) => ({
    label: options.find((option) => option.value === selectedValue)?.label ?? filterString(selectedValue),
    value: filterString(selectedValue),
  }))

  return (
    <Select
      isSuffix={props.isSuffix}
      isMulti
      options={options}
      value={value}
      isClearable={props.store.context.canEditValue}
      onChange={(selectedOptions) => props.store.value$?.set(selectedOptions.map((option) => option.value))}
      disabled={!props.store.context.canEditValue}
    />
  )
}

function ValueDate(props: ValueProps) {
  const format = useDerived(props.store.schema$, (schema) => asDateTimeFormat(toPlainObject(schema)?.format))
  const value = useDerived(props.store.value$, asDate)

  return (
    <DateTimePicker
      isSuffix={props.isSuffix}
      value={value}
      showDate={format.includes('date')}
      showTime={format.includes('time')}
      isClearable={props.store.context.canEditValue}
      onChange={(d) => {
        const e = d && formatDate(d, format)
        props.store.value$?.set(e === null ? (props.nullable ? e : undefined) : e)
      }}
      disabled={!props.store.context.canEditValue}
    />
  )
}

function ValueAny(props: ValueProps) {
  const t = useTranslate()
  const value = useVal(props.store.value$)
  const overrideType = useVal(props.store.overrideWidgetType$)
  const primitiveType = inferSchemaTypeFromPrimitive(inferPrimitiveType(value))
  const finalType = isUndecidable(overrideType) ? primitiveType : overrideType
  const [menuOpen, setMenuOpen] = useState(false)

  return isUndecidable(finalType) || menuOpen ? (
    menuOpen ? (
      <Select
        defaultOpen
        isSuffix={props.isSuffix}
        value={optionOf(t, finalType)}
        options={widgetSelectOptions(
          t,
          (type) => !isBannedSubType(type) && type !== 'select' && type !== 'multiSelect' && (type !== 'any' || finalType !== 'any'),
        )}
        onChange={(e) => {
          if (e) {
            const overrideSchema = props.store.overrideSchema$.value
            const schema = getBaseSchema(e.value, overrideSchema?.schema)
            if (e.value === 'any') {
              props.store.value$?.set(undefined)
            } else if (e.value === 'null') {
              props.store.value$?.set(null)
            } else {
              const expected = asPrimitiveType(e.value)
              const currentValue = props.store.value$?.value
              if (currentValue == null || (expected != null && inferPrimitiveType(currentValue) !== expected)) {
                props.store.value$?.set(getDefaultValue(e.value, schema))
              }
            }
            setValue(props.store.overrideSchema$, {
              ...overrideSchema,
              path: props.store.path,
              schema,
            })
          }
        }}
        onClose={() => setMenuOpen(false)}
        disabled={!props.store.context.canEditValue}
      />
    ) : (
      <Button
        isSuffix={props.isSuffix}
        variant={toTrue(props.showError || isDefined(value)) && 'danger'}
        title={props.error}
        titlePlacement="bottomRight"
        disabled={!props.store.context.canEditValue}
        onClick={toTrue(props.store.context.canEditValue) && (() => setMenuOpen(true))}
        className="justify-start!"
      >
        <span className={`${styles.buttonText} ${styles.btnSetValue}`}>{`<${t('inputHandleEditor.valueUnset')}>`}</span>
      </Button>
    )
  ) : (
    <div className={styles.inlineAny}>
      <Button dropDown onClick={() => setMenuOpen(true)} disabled={!props.store.context.canEditValue}>
        <i className={iconOf(finalType)} />
      </Button>
      <ValueReconciler isSuffix type={finalType} store={props.store} nullable={props.nullable} onRequestType={() => setMenuOpen(true)} />
    </div>
  )
}

//#region Object

function formatObject(value: unknown): string {
  if (isString(value)) {
    return value
  }
  if (value == null) {
    return ''
  }
  try {
    // Difference to `asString()`: add spaces for better readability
    return JSON.stringify(value, null, 2)
  } catch {
    try {
      // Insane case: data = { toString: () => { throw data } }
      return value + ''
    } catch {
      return ''
    }
  }
}

function ValueObject(props: ValueProps) {
  const string = useDerived(props.store.value$, formatObject)
  const collapsed = useVal(props.store.collapsed$)

  const foldIcon = collapsed ? 'i-carbon:expand-all' : 'i-carbon:collapse-all'

  return (
    <Button
      isSuffix={props.isSuffix}
      wrapperClassName={toTrue(props.isInsideAnyOf) && styles.isInsideAnyOf}
      className={clsx(styles.expandButton, !collapsed && styles.expanded)}
      onClick={() => setValue(props.store.collapsed$, !collapsed)}
      onClear={toTrue(props.store.context.canEditValue) && (() => props.store.value$?.set(props.nullable ? null : undefined))}
      disabled={!props.store.context.canEditValue}
    >
      <span data-type={props.type}>{props.isInsideAnyOf ? <i className={`${foldIcon} mb-[2px]`} /> : string}</span>
    </Button>
  )
}

function SubpanelObject(props: SubpanelProps & { readonly store: ObjectWidgetStore }) {
  const t = useTranslate()
  const context = props.store.context
  const restricted = useVal(context.restrict$) != null

  const fixed = useVal(props.store.fixedFields$)
  const override = useVal(props.store.overrideFields$)
  const untyped = useVal(props.store.untypedFields$)
  const schemaWidgetType = useVal(props.store.schemaWidgetType$)
  const allowsUntypedFields = useVal(props.store.allowsUntypedFields$)

  const size = fixed.length + override.length + (untyped?.length ?? 0)
  const canAddFixed = !restricted && context.canEditSchema && schemaWidgetType === 'object'
  const canAddUntyped = !restricted && context.canEditValue && allowsUntypedFields
  const addGroup = canAddFixed ? 'fixed' : 'untyped'

  return (
    <>
      {size === 0 && (canAddFixed || canAddUntyped) && (
        <HandleRow
          className={styles[context.inout]}
          level={props.level}
          isLast={props.isLast}
          variant="value-only"
          value={
            <Button className={styles.addItemOrField} onClick={() => props.store.addField(addGroup, -1)} prefix={<i className={iconOf('objectAdd')} />}>
              {t('inputHandleEditor.addField')}
            </Button>
          }
          onDragOver={props.onDragOver}
        />
      )}
      {fixed.map((field, i) => {
        const isLast = i === size - 1
        return (
          <SubpanelObjectField
            key={field.name}
            index={i}
            group="fixed"
            isLast={isLast}
            level={(props.level ?? '').slice(0, -1) + (isLast ? ' ' : '|')}
            store={field}
            objectStore={props.store}
            onDragOver={props.onDragOver}
            presentation={props.presentation}
          />
        )
      })}
      {override.map((field, i) => {
        const isLast = i + fixed.length === size - 1
        return (
          <SubpanelObjectField
            key={field.name}
            index={i}
            group="override"
            isLast={isLast}
            level={(props.level ?? '').slice(0, -1) + (isLast ? ' ' : '|')}
            store={field}
            objectStore={props.store}
            onDragOver={props.onDragOver}
            presentation={props.presentation}
          />
        )
      })}
      {untyped?.map((field, i) => {
        const isLast = i + fixed.length + override.length === size - 1
        return (
          <SubpanelObjectField
            key={field.name}
            index={i}
            group="untyped"
            isLast={isLast}
            level={(props.level ?? '').slice(0, -1) + (isLast ? ' ' : '|')}
            store={field}
            objectStore={props.store}
            onDragOver={props.onDragOver}
            presentation={props.presentation}
          />
        )
      })}
    </>
  )
}

type ObjectFieldGroup = 'fixed' | 'override' | 'untyped'

interface SubpanelObjectFieldProps {
  // The field index within its group.
  readonly index: number
  readonly group: ObjectFieldGroup
  readonly isLast?: boolean
  readonly level?: string
  readonly store: ObjectFieldStore
  readonly objectStore: ObjectWidgetStore
  readonly presentation?: 'form'
  onDragOver?: (ev: React.DragEvent<HTMLElement>) => void
}

function SubpanelObjectField(props: SubpanelObjectFieldProps) {
  const t = useTranslate()
  const { context } = props.store

  const widget = useVal(props.store.widget$)
  const collapsed = useVal(widget.collapsed$)

  const schemaType = useVal(widget.schemaWidgetType$)
  const widgetType = useVal(widget.widgetType$)
  const restricted = useVal(context.restrict$) != null
  const hasSubpanel = useVal(widget.hasSubpanel$)

  const renameError$ = useMemo(() => val<string | undefined>(), [])
  const onUpdateName = useCallback(
    (name: string): void => renameError$.set(isBannedName(name) ? t('inputHandleEditor.widget.object.banned', { name }) : undefined),
    [],
  )
  const onCommit = useCallback(
    (name: string) => {
      if (renameError$.value) {
        return
      } else if (name !== props.store.name) {
        props.objectStore.renameField(props.store.name, name)
      } else {
        renameError$.set(undefined)
      }
    },
    [props.objectStore, props.store],
  )
  const renameError = useVal(renameError$)

  const allowsUntypedFields = useVal(props.group == 'untyped' ? props.objectStore.allowsUntypedFields$ : undefined)
  const allowUntyped = !restricted && context.canEditValue && allowsUntypedFields
  const allowAdd = (!restricted && context.canEditSchema && props.group === 'fixed') || (allowUntyped && props.group === 'untyped')

  const actionAdd: IHandleAction = {
    title: t('inputHandleEditor.addField'),
    icon: iconOf('objectAdd'),
    disabled: !allowAdd,
    onClick: () => {
      if (props.group === 'fixed' || props.group === 'untyped') props.objectStore.addField(props.group, props.index)
    },
  }

  const allowDelete = (!restricted && context.canEditSchema) || (allowUntyped && props.group === 'untyped')

  const actionDelete: IHandleAction = {
    title: t('inputHandleEditor.deleteField'),
    icon: iconOf('objectDelete'),
    disabled: !allowDelete,
    onClick: () => props.objectStore.removeField(props.store.name),
  }

  const allowEditSchema = !restricted && context.canEditSchema

  const allowEditName = (!restricted && context.canEditSchema && props.group === 'fixed') || (allowUntyped && props.group === 'untyped')

  return (
    <>
      <HandleRow
        className={styles[context.inout]}
        level={props.level}
        isLast={props.isLast}
        expanded={hasSubpanel ? !collapsed : null}
        onExpandedChange={(e) => setValue(widget.collapsed$, !e)}
        name={
          <DesignerTooltip open={!!renameError} placement="left" title={renameError}>
            <div className={styles.objectFieldNameWrapper}>
              <Input
                className={clsx(renameError && styles.renameError)}
                value={props.store.name}
                readOnly={!allowEditName}
                onChange={onUpdateName}
                onRealChange={onCommit}
                onBlur={(input) => {
                  input.value = props.store.name
                  renameError$.set(undefined)
                }}
              />
            </div>
          </DesignerTooltip>
        }
        value={
          props.presentation === 'form' ? (
            <ValueReconciler type={props.group === 'override' ? widgetType : schemaType} store={widget} />
          ) : (
            <ObjectField
              group={props.group}
              type={props.group === 'override' ? widgetType : schemaType}
              store={props.store}
              schemaDisabled={!allowEditSchema}
              valueDisabled={!allowEditName}
            />
          )
        }
        actions={
          props.presentation === 'form' && props.group !== 'untyped'
            ? undefined
            : props.group === 'fixed' || props.group === 'untyped'
              ? [actionAdd, actionDelete]
              : [actionDelete]
        }
        onDragOver={props.onDragOver}
      />
      {hasSubpanel && !collapsed && <Subpanel isLast level={(props.level ?? '') + ' '} type={widgetType} store={widget} presentation={props.presentation} />}
    </>
  )
}

interface ObjectFieldProps {
  readonly group: ObjectFieldGroup
  readonly type: WidgetType
  readonly store: ObjectFieldStore
  readonly schemaDisabled?: boolean
  readonly valueDisabled?: boolean
}

function ObjectField(props: ObjectFieldProps) {
  const t = useTranslate()
  const widget = useVal(props.store.widget$)

  return (
    <div className={clsx(styles.value, !props.store.value$ && styles.noValue)}>
      <Select
        value={optionOf(t, props.type)}
        options={widgetSelectOptions(t, (type) => !isBannedSubType(type))}
        disabled={props.schemaDisabled}
        onChange={(e) => e && props.store.setSchema(props.group, getBaseSchema(e.value, widget.schema$.value))}
      />
      {props.store.context.inout === 'in' && <ValueReconciler isSuffix type={props.type} store={widget} />}
    </div>
  )
}

//#endregion

//#region OutputArray

// Output array values use the same compact presentation as any values.
function ValueInlineArray(
  props: ValueProps & {
    readonly store: ArrayWidgetStore
    readonly options: WidgetSelectOption[]
    readonly onChange: (e: WidgetSelectOption | null) => void
  },
) {
  const t = useTranslate()
  const [menuOpen, setMenuOpen] = useState(false)
  const restricted = useVal(props.store.context.restrict$) != null

  return menuOpen ? (
    <Select
      defaultOpen
      isSuffix={props.isSuffix}
      value={optionOf(t, props.type)}
      options={props.options}
      onChange={props.onChange}
      onClose={() => setMenuOpen(false)}
      disabled={restricted || !props.store.context.canEditSchema}
    />
  ) : (
    <div className={styles.outputArray}>
      <Button dropDown onClick={() => setMenuOpen(true)} disabled={restricted || !props.store.context.canEditSchema}>
        <i className={iconOf(props.type)} />
      </Button>
      <ValueArray isSuffix type={props.type} nullable={props.nullable} store={props.store} />
    </div>
  )
}

//#endregion

//#region Array

function ValueArray(props: ValueProps & { readonly store: ArrayWidgetStore }) {
  const t = useTranslate()
  const restricted = useVal(props.store.context.restrict$) != null
  const itemsWidgetType = useVal(props.store.itemsWidgetType$)

  return (
    <div className={styles.inlineArray}>
      <span className={styles.of}>{t('handleEditor.of')}</span>
      <Select
        isSuffix
        value={optionOf(t, itemsWidgetType)}
        options={widgetSelectOptions(t, (type) => !isBannedSubType(type))}
        disabled={restricted || !props.store.context.canEditSchema}
        isClearable={props.store.context.canEditValue}
        onChange={(e) => {
          if (e) {
            props.store.itemsSchema$.set(getBaseSchema(e.value, props.store.itemsSchema$.value))
          } else {
            props.store.itemsSchema$.set(undefined)
            props.store.value$?.set(props.nullable ? null : undefined)
          }
        }}
      />
    </div>
  )
}

function SubpanelArray(props: SubpanelProps & { readonly store: ArrayWidgetStore }) {
  const t = useTranslate()
  const { context } = props.store

  const items = useVal(props.store.items$)
  const itemsWidgetType = useVal(props.store.itemsWidgetType$)
  const size = items ? items.length : 0

  return (
    <>
      {size === 0 && context.canEditValue && (
        <HandleRow
          className={styles[context.inout]}
          level={props.level}
          isLast={props.isLast}
          variant="value-only"
          value={
            <Button
              className={styles.addItemOrField}
              onClick={() => props.store.addItem(-1)}
              prefix={<i className={iconOf('objectAdd')} />}
              onClear={() => props.store.value$?.set(props.nullable ? null : undefined)}
            >
              {t('handleEditor.addItem')}
            </Button>
          }
          onDragOver={props.onDragOver}
        />
      )}
      {items?.map((item, i) => {
        const isLast = i === size - 1
        return (
          <SubpanelArrayItem
            key={item.index}
            index={i}
            isLast={isLast}
            level={(props.level ?? '').slice(0, -1) + (isLast ? ' ' : '|')}
            type={itemsWidgetType}
            store={item}
            arrayStore={props.store}
            onDragOver={props.onDragOver}
            presentation={props.presentation}
          />
        )
      })}
    </>
  )
}

interface SubpanelArrayItemProps {
  readonly index: number
  readonly isLast?: boolean
  readonly level?: string
  readonly type: WidgetType
  readonly store: ArrayItemStore
  readonly arrayStore: ArrayWidgetStore
  readonly presentation?: 'form'
  onDragOver?: (ev: React.DragEvent<HTMLElement>) => void
}

function SubpanelArrayItem(props: SubpanelArrayItemProps) {
  const t = useTranslate()
  const { context } = props.store

  const widget = useVal(props.store.widget$)
  const collapsed = useVal(widget.collapsed$)

  const widgetType = useVal(widget.widgetType$)
  const restricted = useVal(context.restrict$) != null
  const hasSubpanel = doesTypeHasSubpanel(context, widgetType, null, restricted)

  const allowAdd = context.canEditSchema || (context.canEditValue && context.inout === 'in')
  const actionAdd: IHandleAction = {
    title: t('handleEditor.addItem'),
    icon: iconOf('objectAdd'),
    disabled: !allowAdd,
    onClick: () => props.arrayStore.addItem(props.index),
  }

  const allowDelete = allowAdd
  const actionDelete: IHandleAction = {
    title: t('delete'),
    icon: iconOf('objectDelete'),
    disabled: !allowDelete,
    onClick: () => props.arrayStore.removeItem(props.store.index),
  }

  return (
    <>
      <HandleRow
        className={styles[context.inout]}
        level={props.level}
        isLast={props.isLast}
        variant="value-only"
        expanded={hasSubpanel ? !collapsed : null}
        onExpandedChange={(e) => setValue(widget.collapsed$, !e)}
        arrowPrefix={
          <span className={styles.arrayItemIndex} title={String(props.index)}>
            <span>{props.index}.</span>
          </span>
        }
        value={<ValueReconciler type={props.type} store={widget} />}
        actions={[actionAdd, actionDelete]}
        onDragOver={props.onDragOver}
      />
      {hasSubpanel && !collapsed && <Subpanel isLast level={(props.level ?? '') + ' '} type={widgetType} store={widget} presentation={props.presentation} />}
    </>
  )
}

//#endregion

//#region AnyOf

function ValueAnyOf(props: ValueProps & { readonly store: AnyOfWidgetStore }) {
  const t = useTranslate()
  const schema = toPlainObject(useVal(props.store.schema$))
  const conditions = toArray(schema?.[props.type]) || []
  const labels = toArray(toPlainObject(schema?.[ui_options])?.labels) || []
  const selected = useDerived(props.store.overrideSchema$, (o) => asNumber(toPlainObject(o?.[ui_options])?.selected))

  const options: IBasicOption[] = conditions.map((_, i) => ({
    label: filterString(labels[i]) || t('inputHandleEditor.widget.conditions.title', { index: i + 1 }),
    value: String(i),
  }))
  const value: IBasicOption | undefined = options[selected]

  const condition = useVal(props.store.condition$)
  const widget = useVal(condition?.widget$)
  const widgetType = useVal(widget?.widgetType$)

  const restricted = useVal(props.store.context.restrict$) != null
  const hasSubpanel = widget && widgetType && doesTypeHasSubpanel(props.store.context, widgetType, null, restricted)

  const selectCondition = (
    <Select
      isSuffix={props.isSuffix}
      options={options}
      value={value}
      onChange={(e) => e && setValue(props.store.selected$, asNumber(e.value))}
      disabled={!props.store.context.canEditValue}
    />
  )

  return hasSubpanel ? (
    <div className={styles.value}>
      {selectCondition}
      <ValueReconciler isSuffix type={widgetType} store={widget} nullable={props.nullable} isInsideAnyOf />
    </div>
  ) : (
    selectCondition
  )
}

//#endregion

function ValueBinary(props: ValueProps) {
  const t = useTranslate()

  return (
    <Label
      className={styles.binary}
      disabled={!props.store.context.canEditValue}
      isSuffix={props.isSuffix}
      // prefix={<i className="i-codicon:file-binary ml-1" />}
    >
      {`<${t('inputHandleEditor.noData')}>`}
    </Label>
  )
}

function ValueNull(props: ValueProps) {
  if (props.onRequestType != null && props.store.context.canEditValue) {
    return (
      <Button className="justify-start!" isSuffix={props.isSuffix} onClick={props.onRequestType}>
        <Null />
      </Button>
    )
  }
  return (
    <Label disabled={!props.store.context.canEditValue} isSuffix={props.isSuffix}>
      <Null />
    </Label>
  )
}

function ValueUnknown(props: ValueProps) {
  const t = useTranslate()

  return (
    <Label disabled={!props.store.context.canEditValue} isSuffix={props.isSuffix}>
      {t('handleEditor.unknown')}
    </Label>
  )
}

function ValueReference(props: ValueProps) {
  const t = useTranslate()

  return (
    <Label
      className={styles.reference}
      disabled={!props.store.context.canEditValue}
      isSuffix={props.isSuffix}
      // prefix={<i className="i-carbon:data-refinery-reference ml-1" />}
    >
      {`<${t('inputHandleEditor.reference')}>`}
    </Label>
  )
}

function ValueNullable(props: ValueProps) {
  const value$ = props.store.value$
  // const suffix = <i className="i-codicon:edit" />;

  const onClick = (ev: React.MouseEvent<HTMLButtonElement>) => {
    if (!value$) return
    const isRoot = props.store.path.length === 0
    const expected = asPrimitiveType(props.type)
    // Prefer the author-provided default value.
    let defaultValue = toTrue(isRoot) && props.store.context.defaultValue$.value
    const valueType = inferPrimitiveType(defaultValue)
    if (defaultValue == null || (expected ? valueType !== expected : defaultValue === undefined)) {
      // Fall back to the type default when the author default is absent or incompatible.
      defaultValue = getDefaultValue(props.type, props.store.schema$.value) ?? null
    }
    setValue(value$, defaultValue)
    tryAutoFocusElementUnder(ev)
  }

  return (
    <Button
      title={props.error}
      titlePlacement="bottomRight"
      disabled={!props.store.context.canEditValue}
      isSuffix={props.isSuffix}
      // suffix={suffix}
      onClear={toTrue(props.store.context.canEditValue) && onClick}
      clearIcon="i-codicon:edit"
      onClick={onClick}
      className="justify-start!"
    >
      <Null />
    </Button>
  )
}

function ValueError(props: ValueProps) {
  const t = useTranslate()
  const value$ = props.store.value$
  const value = useVal(value$)
  const showError = props.showError

  // const prefix = value$ && (
  //   <i
  //     className="i-codicon:error"
  //     style={{ color: "var(--widget-error-color)" }}
  //   />
  // );

  const onClick = (ev: React.MouseEvent<HTMLButtonElement>) => {
    if (!value$) return
    const isRoot = props.store.path.length === 0
    const expected = asPrimitiveType(props.type)
    // Prefer the author-provided default value.
    let defaultValue = toTrue(isRoot) && props.store.context.defaultValue$.value
    const valueType = inferPrimitiveType(defaultValue)
    if (defaultValue === null && props.nullable) {
      // Preserve an explicit null for nullable values.
    } else if (defaultValue == null || (expected ? valueType !== expected : defaultValue === undefined)) {
      // Fall back to the type default when the author default is absent or incompatible.
      defaultValue = getDefaultValue(props.type, props.store.schema$.value) ?? null
    }
    setValue(value$, defaultValue)
    tryAutoFocusElementUnder(ev)
  }

  const onClear = (ev: React.MouseEvent<HTMLButtonElement>) => {
    if (!value$) return
    if (props.nullable) {
      setValue(value$, null)
    } else {
      onClick(ev)
    }
  }

  return (
    <Button
      variant={toTrue(showError || isDefined(value)) && 'danger'}
      title={props.error}
      titlePlacement="bottomRight"
      disabled={!props.store.context.canEditValue}
      isSuffix={props.isSuffix}
      // prefix={showError && prefix}
      onClear={toTrue(props.store.context.canEditValue) && onClear}
      clearIcon={props.nullable ? undefined : 'i-codicon:edit'}
      onClick={onClick}
      className="justify-start!"
    >
      {value === undefined ? (
        <span className={`${styles.buttonText} ${styles.btnSetValue}`}>{`<${t('inputHandleEditor.valueUnset')}>`}</span>
      ) : (
        <span className={styles.buttonText}>{inspect(value)}</span>
      )}
    </Button>
  )
}

function ValueOpenSchemaEditor(props: ValueProps) {
  const t = useTranslate()

  return (
    <Button isSuffix onClick={() => props.store.context.requestOpenSchemaEditor()} className={`justify-start! ${styles.btnDefineSchema}`}>
      {'<'}
      {props.type === 'anyOf' || props.type === 'select' || props.type === 'multiSelect'
        ? t('inputHandleEditor.defineOptions')
        : t('inputHandleEditor.defineSchema')}
      {'>'}
    </Button>
  )
}

function isBannedType(context: WidgetContext, type: WidgetType): boolean {
  // Value nodes can disable complex widgets.
  if (context.enableAny === false && (isUndecidable(type) || type === 'binary')) return true
  // Outputs do not support schema applicators yet.
  if (context.inout === 'out') {
    return type === 'anyOf' || type === 'allOf' || type === 'oneOf'
  } else {
    return type === 'allOf' || type === 'oneOf'
  }
}

// Keep nested schemas simple by excluding undecidable and binary widget types.
function isBannedSubType(type: WidgetType): boolean {
  if (type === 'any') return false
  return isUndecidable(type) || type === 'binary'
}

function doesTypeHasSubpanel(
  context: WidgetContext,
  // The effective type after applying the override.
  t: WidgetType,
  // The original schema. Null means use the effective type.
  schema?: JsonSchema | null,
  // Whether editing is restricted.
  restricted?: boolean,
): boolean {
  // if (!context.canEditValue) return false;
  const o = schema === null ? t : typeOfSchema(schema)

  if (t == 'object') {
    if ((!restricted && context.canEditSchema) || o === 'any') return true
    const hasProperties = !!schema?.properties && Object.keys(schema.properties).length > 0
    if (context.inout === 'in') {
      return hasProperties || schema?.additionalProperties !== false
    } else {
      return hasProperties
    }
  }

  return context.inout === 'in' && (t == 'text' || t == 'array' || o == 'anyOf' || o == 'allOf' || o == 'oneOf')
}

// Repairing a null or invalid value replaces the button with a concrete input.
// Try to focus that input on the next frame.
function tryAutoFocusElementUnder(ev: React.MouseEvent<HTMLElement>) {
  const { clientX, clientY } = ev
  setTimeout(() => {
    const element = document.elementFromPoint(clientX, clientY)
    if (element instanceof HTMLElement) {
      if (shouldFocus(element)) {
        simulateClick(element)
      } else {
        simulateExpand(element)
      }
    }
  }, 50)
}

function simulateExpand(element: HTMLElement) {
  const $handleRow = element.closest<HTMLElement>(`.${HANDLE_ROW_CLASSNAME}`)
  if (!$handleRow) return
  if (element.tagName === 'BUTTON' && element.className.includes('handleEditor_expandButton_')) {
    if (!$handleRow.classList.contains(HANDLE_ROW_EXPANDED_CLASSNAME)) {
      simulateClick(element)
    }
  }
  // Wait expanded.
  setTimeout(() => {
    const $nextHandleRow = $handleRow.nextElementSibling
    const textarea = $nextHandleRow?.querySelector('textarea')
    if (textarea) simulateClick(textarea)
    const button = $nextHandleRow?.querySelector<HTMLButtonElement>("button[class*='handleEditor_addItemOrField_']")
    if (button) simulateClick(button)
  })
}

// Limit automatic focus to known-safe controls, excluding elements such as a Boolean checkbox.
function shouldFocus(element: HTMLElement): boolean {
  if (element.tagName === 'INPUT') {
    return true
  }
  if (element.tagName === 'BUTTON' && element.className.includes('colorPicker_swatch_')) {
    return true
  }
  return false
}

function simulateClick(element: HTMLElement): void {
  // Triggers most React DOM events.
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  // Triggers PointerEvent { type: "click" }.
  element.click()
  element.focus({ preventScroll: true })
}
