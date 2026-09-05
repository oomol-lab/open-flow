import styles from './conditionEditor.module.scss'
import type { useStoreApi } from '@xyflow/react'
import type { JSX } from 'react/jsx-runtime'
import type { Val } from 'value-enhancer'
import type { HandleName } from '../../../schema/index.ts'
import type { HandleRowProps, IHandleAction } from '../components/handleRow.tsx'
import type { DesignerOption as IBasicOption } from '../components/select.tsx'
import type { ConditionRowStore } from '../stores/conditionHandle/conditionRow.store.ts'
import type { ConditionOperator } from '../stores/conditionHandle/constants.ts'
import type { ConditionExpressionStore, ConditionWidgetStore } from '../stores/conditionHandle/widget.store.ts'
import type { WidgetContext } from '../stores/conditionHandle/widgetContext.ts'
import type { HandleIndex } from '../stores/node/constants.ts'
import type { PrimitiveType } from './preset.ts'

import { clsx } from 'clsx'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useDerived, useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { setValue, val } from 'value-enhancer'
import { NODE_HANDLE_CLASSNAME } from '../base/designer.ts'
import { stopEvent } from '../base/dom.ts'
import { asNumber, asString, asTrue, inspect, toTrue, trueFalse } from '../base/trivial.ts'
import { Button } from '../components/button.tsx'
import { HandleRow } from '../components/handleRow.tsx'
import { Input } from '../components/input.tsx'
import { TranslationInput } from '../components/input2.tsx'
import { Label } from '../components/label.tsx'
import { Null } from '../components/null.tsx'
import { DesignerCombobox as Select } from '../components/select.tsx'
import { LabeledSwitch } from '../components/toggleSwitch.tsx'
import { DesignerTooltip } from '../components/tooltip.tsx'
import {
  doesOperatorHasValue,
  logicalSelectOptions,
  operatorSelectOptions,
  optionOfLogical,
  optionOfOperator,
  optionOfValueType,
  predicateOperator,
  predicateValueType,
  valueTypeSelectOptions,
} from '../stores/conditionHandle/constants.ts'
import { asPrimitiveType, iconOf, iconOfSchema, inferPrimitiveType, typeOfSchema } from './preset.ts'
import { useHandleTrack } from './useHandleTrack.ts'

export interface ConditionEditorProps {
  readonly store: ConditionRowStore
  readonly panelWidth$: Val<number | undefined>
  readonly reactFlowStore?: ReturnType<typeof useStoreApi>
  validate?: (name: string, oldName: string) => string | undefined
  onRename?: (name: string) => void
  onDelete?: () => void
  readonly dragTarget?: HandleIndex
  readonly dragPosition?: number
  onDragStart?: (ev: React.DragEvent<HTMLElement>) => void
  onDragOver?: (ev: React.DragEvent<HTMLElement>) => void
  /** Adds a condition after the current row. */
  addCondition?: () => void
}

export function ConditionEditor({
  store,
  panelWidth$,
  reactFlowStore,
  validate,
  onRename,
  onDelete,
  dragTarget,
  dragPosition = 0,
  onDragStart,
  onDragOver,
  addCondition,
}: ConditionEditorProps): JSX.Element {
  const { context } = store

  const t = useTranslate()
  const widget = store.widget
  const collapsed = useVal(widget.collapsed$)

  const logical = useVal(store.logical$)
  const description = useVal(store.displayDescription$)
  const showSettings = useVal(store.showSettings$)

  const labelId = useId()

  const { renameError$, renameError, onUpdateName, onCommit } = useRename(store, validate, onRename)

  return (
    <>
      {dragTarget?.handle === store.name && toTrue(dragPosition < 0) && <div className={styles.dragIndicator} />}
      <HandleRow
        className={styles.row}
        prefix={
          <>
            {context.canEditSchema && onDragStart && (
              <div draggable className={styles.dragHandle} onDragStart={onDragStart} data-handle={`h:${store.name}`}>
                <i className="i-carbon:draggable" />
              </div>
            )}
          </>
        }
        expanded={context.isDefault ? null : !collapsed}
        onExpandedChange={(e) => setValue(widget.collapsed$, !e)}
        name={
          <DesignerTooltip open={!!renameError} placement="left" title={renameError}>
            <div className={styles.nameWrapper}>
              <Input
                id={labelId}
                selectOnFocus
                className={clsx(renameError && styles.renameError)}
                value={store.name}
                title={`${context.isDefault ? t('condition.default') : t('condition.label')}: ${store.name}${description ? `\n${description}` : ''}`}
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
        value={
          <div className={styles.value}>
            {context.isDefault ? (
              <Label help={t('condition.defaultHelp')}>{t('condition.defaultDescription')}</Label>
            ) : (
              <Select
                className={styles.logicalSelect}
                value={optionOfLogical(t, logical)}
                options={logicalSelectOptions(t)}
                disabled={!context.canEditSchema}
                onChange={(e) => e && setValue(store.logical$, e.value)}
              />
            )}
          </div>
        }
        actions={[
          context.isDefault
            ? null
            : {
                title: t('condition.addCondition'),
                icon: iconOf('objectAdd'),
                disabled: !(context.canEditSchema && addCondition),
                onClick: addCondition,
              },
          <div className={styles.showSettings}>
            <Button active={showSettings} onClick={() => setValue(store.showSettings$, !showSettings)}>
              <i className={iconOf('settings')} />
            </Button>
            {showSettings && (
              <div className={styles.settingsPanel} onClickCapture={stopEvent}>
                <SettingsPanel
                  title={t('condition.configPanelTitle')}
                  store={store}
                  panelWidth$={panelWidth$}
                  reactFlowStore={reactFlowStore}
                  onClose={() => setValue(store.showSettings$, false)}
                  validate={validate}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              </div>
            )}
          </div>,
        ]}
        onDragOver={onDragOver}
      />
      {!context.isDefault && !collapsed && <Subpanel level=" " isLast store={widget} onDragOver={onDragOver} />}
      {dragTarget?.handle === store.name && toTrue(dragPosition > 0) && <div className={styles.dragIndicator} />}
    </>
  )
}

interface SettingsPanelProps {
  readonly title: string
  readonly store: ConditionRowStore
  readonly panelWidth$: Val<number | undefined>
  readonly reactFlowStore?: ReturnType<typeof useStoreApi>
  validate?: (name: string, oldName: string) => string | undefined
  onRename?: (name: string) => void
  onClose?: () => void
  onDelete?: () => void
}

const MIN_PANEL_WIDTH = 400

function SettingsPanel({ title, store, panelWidth$, reactFlowStore, validate, onRename, onClose, onDelete }: SettingsPanelProps) {
  const t = useTranslate()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const handleTrack = useHandleTrack(MIN_PANEL_WIDTH, panelWidth$, containerRef, reactFlowStore)

  return (
    <div ref={containerRef} className={styles.settingsPanelWrapper}>
      <header className={`${styles.header} ${NODE_HANDLE_CLASSNAME}`}>
        <h3>
          <span className={styles.title}>{title}</span>
          {store.context.canEditSchema && onDelete && (
            <Button wrapperClassName={styles.deleteBtn} onClick={onDelete}>
              <i className="i-codicon:trash" />
            </Button>
          )}
          <aside>
            {onClose && (
              <Button ariaLabel={t('close')} title={t('close')} onClick={onClose}>
                <i className={iconOf('close')} />
              </Button>
            )}
          </aside>
        </h3>
      </header>
      <SettingsContent store={store} validate={validate} onRename={onRename} />
      <div data-pos="e" className={`${styles.resizeHandle} ${styles.resizeHandleE}`} onPointerDown={handleTrack} />
    </div>
  )
}

interface SettingsContentProps {
  readonly level?: string
  readonly store: ConditionRowStore
  validate?: (name: string, oldName: string) => string | undefined
  onRename?: (name: string) => void
}

function SettingsContent({ level, store, validate, onRename }: SettingsContentProps) {
  const t = useTranslate()
  const { context } = store

  const description = useVal(store.displayDescription$)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const toggleDescription = () => setDescriptionExpanded((v) => !v)

  const { renameError$, renameError, onUpdateName, onCommit } = useRename(store, validate, onRename)

  return (
    <>
      <Field level={level} isLast={false} context={context} name={t('inputHandleEditor.handleName')}>
        <DesignerTooltip open={!!renameError} placement="bottomLeft" title={renameError}>
          <div className={styles.nameWrapper}>
            <Input
              className={clsx(styles.nameInput, renameError && styles.renameError)}
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
      </Field>
      <Field
        level={level}
        isLast={!descriptionExpanded}
        context={context}
        expanded={descriptionExpanded}
        onExpandedChange={setDescriptionExpanded}
        name={t('schemaEditor.description')}
      >
        <Button className={styles.expandButton} title={description} onClick={toggleDescription}>
          <span>{description}</span>
        </Button>
      </Field>
      {descriptionExpanded && (
        <HandleRow
          resizable
          level={level ? '|' + level : ' '}
          variant="value-only"
          value={
            <TranslationInput
              multiline
              className={styles.input}
              rawValue$={store.description$}
              displayValue$={store.displayDescription$}
              placeholder={t('inputHandleEditor.unset')}
              disabled={!context.canEditSchema}
              useRealChange
            />
          }
        />
      )}
    </>
  )
}

interface FieldProps extends HandleRowProps {
  readonly context: WidgetContext
  readonly name: string | React.ReactNode
  readonly title?: string
  readonly labelSuffix?: React.ReactNode
  readonly children?: React.ReactNode
  readonly actions?: IHandleAction[]
}

function Field(props: FieldProps) {
  const name =
    typeof props.name === 'string' ? (
      <Label className={styles.field} tooltipClassName={styles.fieldTooltip} title={props.title} htmlTitle={props.name} suffix={props.labelSuffix}>
        {props.name}
      </Label>
    ) : (
      props.name
    )

  return <HandleRow {...props} className={clsx(styles.row, styles.field)} name={name} value={props.children} actions={props.actions} />
}

interface SubpanelProps {
  readonly level?: string
  readonly isLast?: boolean
  readonly store: ConditionWidgetStore
  onDragOver?: (ev: React.DragEvent<HTMLElement>) => void
}

function Subpanel(props: SubpanelProps) {
  const t = useTranslate()
  const { context } = props.store

  const expressions = useVal(props.store.expressions$)
  const size = expressions.length

  return (
    <>
      {size === 0 && (
        <HandleRow
          className={styles.row}
          level={props.level}
          isLast={props.isLast}
          variant="value-only"
          value={
            <Button
              className={styles.addItem}
              onClick={() => props.store.addExpression(-1)}
              prefix={<i className={iconOf('objectAdd')} />}
              disabled={!context.canEditValue}
            >
              {t('condition.addCondition')}
            </Button>
          }
          onDragOver={props.onDragOver}
        />
      )}
      {expressions.map((expr, i) => {
        const isLast = i === size - 1
        return (
          <SubpanelExpression
            key={expr.index}
            index={i}
            isLast={isLast}
            level={(props.level ?? '').slice(0, -1) + (isLast ? ' ' : '|')}
            store={expr}
            conditionStore={props.store}
            onDragOver={props.onDragOver}
          />
        )
      })}
    </>
  )
}

interface SubpanelExpressionProps {
  readonly index: number
  readonly isLast?: boolean
  readonly level?: string
  readonly store: ConditionExpressionStore
  readonly conditionStore: ConditionWidgetStore
  onDragOver?: (ev: React.DragEvent<HTMLElement>) => void
}

interface InputHandleOption extends IBasicOption {
  readonly value: HandleName
}

function SubpanelExpression(props: SubpanelExpressionProps) {
  const t = useTranslate()
  const { context } = props.store

  const handleOptions = useDerived(context.inputHandleDefs$, (defs) =>
    defs?.map(
      (d): InputHandleOption => ({
        label: d.handle,
        value: d.handle,
        icon: iconOfSchema(d.json_schema),
      }),
    ),
  )
  const handle = useVal(props.store.inputHandle$)
  const handleValue: InputHandleOption | undefined = handleOptions?.find((o) => o.value === handle)
  const inputHandleDef = useVal(props.store.inputHandleDef$)

  const operatorOptions = operatorSelectOptions(t, predicateOperator(inputHandleDef))
  const operator = useVal(props.store.operator$)
  const operatorHasValue = doesOperatorHasValue(operator)

  const actionAdd: IHandleAction = {
    title: t('condition.addCondition'),
    icon: iconOf('objectAdd'),
    disabled: !context.canEditValue,
    onClick: () => props.conditionStore.addExpression(props.index),
  }

  const actionDelete: IHandleAction = {
    title: t('condition.deleteCondition'),
    icon: iconOf('objectDelete'),
    disabled: !context.canEditValue,
    onClick: () => props.conditionStore.removeExpression(props.index),
  }

  return (
    <HandleRow
      className={styles.row}
      level={props.level}
      isLast={props.isLast}
      name={
        <Select
          className={styles.handleSelect}
          options={handleOptions}
          value={handleValue ?? { label: handle, value: handle, icon: iconOfSchema(null) }}
          variant={toTrue(!handleValue) && 'danger'}
          disabled={!context.canEditValue}
          onChange={(e) => e && setValue(props.store.inputHandle$, e.value)}
        />
      }
      value={
        <div className={clsx(styles.operatorAndValue, !operatorHasValue && styles.noValue)}>
          <Select
            className={styles.operatorSelect}
            options={operatorOptions}
            value={optionOfOperator(t, operator)}
            variant={toTrue(!operatorOptions.some((e) => e.value === operator)) && 'danger'}
            disabled={!context.canEditValue}
            onChange={(e) => e && setValue(props.store.operator$, e.value)}
          />
          {operatorHasValue && (
            <ValueReconciler isSuffix type={asPrimitiveType(typeOfSchema(inputHandleDef?.json_schema))} operator={operator} store={props.store} />
          )}
        </div>
      }
      actions={[actionAdd, actionDelete]}
      onDragOver={props.onDragOver}
    />
  )
}

interface ValueProps {
  readonly isSuffix?: boolean
  readonly type: PrimitiveType | undefined
  readonly operator: ConditionOperator | undefined
  readonly store: ConditionExpressionStore
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
  const inputHandleDef = useVal(props.store.inputHandleDef$)
  const value = useVal(props.store.value$)
  const expected = predicateValueType(inputHandleDef, props.operator)
  const valueType = inferPrimitiveType(value)

  // Show a repair action when the value has the wrong type.
  if (expected && valueType !== expected && value != null) {
    const error = t('inputHandleEditor.typeError', { expected: expected || 'any' })
    return <ValueError {...props} error={error} />
  }

  switch (props.type) {
    case 'string':
      return <ValueString {...props} />
    case 'number':
      return <ValueNumber {...props} />
    case 'boolean':
      return <ValueBoolean {...props} />
    case 'object':
      return <ValueObject {...props} />
    case 'array':
      return <ValueArray {...props} />
    case 'null':
      return <ValueNull {...props} />
    default:
      return <ValueUnknown {...props} />
  }
})

function ValueNull(props: ValueProps) {
  useEffect(() => props.store.value$?.set(null), [props.store])

  return (
    <Label disabled={!props.store.context.canEditValue} isSuffix={props.isSuffix}>
      <Null />
    </Label>
  )
}

function ValueBoolean(props: ValueProps) {
  const value = useDerived(props.store.value$, asTrue)

  return (
    <LabeledSwitch
      isSuffix={props.isSuffix}
      checked={value}
      onChange={props.store.value$?.set}
      label={trueFalse}
      disabled={!props.store.context.canEditValue}
    />
  )
}

function ValueNumber(props: ValueProps) {
  const value = useDerived(props.store.value$, asNumber) ?? 0

  return (
    <Input
      isSuffix={props.isSuffix}
      type="number"
      value={String(value)}
      onChange={(raw: string | null) => props.store.value$?.set(asNumber(raw))}
      onBlur={(input) => {
        input.value = String(value)
      }}
      readOnly={!props.store.context.canEditValue}
      returnToCommit
    />
  )
}

function ValueString(props: ValueProps) {
  const value = useDerived(props.store.value$, asString)

  return <Input isSuffix={props.isSuffix} value={value} onChange={props.store.value$.set} readOnly={!props.store.context.canEditValue} />
}

function ValueObject(props: ValueProps) {
  if (props.operator === 'has key' || props.operator === 'not has key') {
    return <ValueString {...props} />
  } else {
    return <ValueAny {...props} />
  }
}

function ValueArray(props: ValueProps) {
  return <ValueAny {...props} />
}

function ValueUnknown(props: ValueProps) {
  const op = props.operator
  if (op === '<' || op === '>' || op === '<=' || op === '>=') {
    return <ValueNumber {...props} />
  } else if (op === 'has key' || op === 'not has key' || op === 'starts with' || op === 'ends with') {
    return <ValueString {...props} />
  } else {
    return <ValueAny {...props} />
  }
}

const typesWithComponent: Set<PrimitiveType> = new Set(['string', 'number', 'boolean'])
type TypeWithComponent = 'string' | 'number' | 'boolean'

function ValueAny(props: ValueProps) {
  const t = useTranslate()
  const value = useVal(props.store.value$)
  const [type, setType] = useState((): TypeWithComponent | undefined => {
    const inferredType = inferPrimitiveType(value)
    return typesWithComponent.has(inferredType) ? (inferredType as TypeWithComponent) : undefined
  })
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    // Reconcile the value when its selected type changes. The store-level repair does not cover this case.
    if (type) {
      const v = props.store.value$.value
      const valueType = typeof v
      if (type === 'string' && valueType !== 'string') {
        props.store.value$.set(asString(v))
      } else if (type === 'number' && valueType !== 'number') {
        props.store.value$.set(asNumber(v))
      } else if (type === 'boolean' && valueType !== 'boolean') {
        props.store.value$.set(asTrue(v))
      }
    }
  }, [type])

  return !type || menuOpen ? (
    menuOpen ? (
      <Select
        defaultOpen
        isSuffix={props.isSuffix}
        options={valueTypeSelectOptions(t)}
        value={optionOfValueType(t, type)}
        onChange={(e) => {
          if (e) setType(e.value)
        }}
        onClose={() => setMenuOpen(false)}
        disabled={!props.store.context.canEditValue}
      />
    ) : (
      <Button
        isSuffix={props.isSuffix}
        variant="danger"
        disabled={!props.store.context.canEditValue}
        onClick={() => setMenuOpen(true)}
        className="justify-start!"
      >
        <span className={styles.buttonText}>{`<${t('inputHandleEditor.valueUnset')}>`}</span>
      </Button>
    )
  ) : (
    <div className={styles.inlineAny}>
      <Button dropDown onClick={() => setMenuOpen(true)} disabled={!props.store.context.canEditValue}>
        <i className={iconOf(type)} />
      </Button>
      <ValueReconciler isSuffix type={type} operator={props.operator} store={props.store} />
    </div>
  )
}

function ValueError(props: ValueProps & { readonly error: string }) {
  const t = useTranslate()
  const value$ = props.store.value$
  const value = useVal(value$)

  const onClick = async (ev: React.MouseEvent<HTMLButtonElement>) => {
    const def = props.store.inputHandleDef$.value
    const valueType = predicateValueType(def, props.operator)
    let repairedValue: string | boolean | number | null | undefined
    if (valueType === 'string' && typeof value$.value !== 'string') {
      repairedValue = asString(value$.value)
    } else if (valueType === 'number' && typeof value$.value !== 'number') {
      repairedValue = asNumber(value$.value)
    } else if (valueType === 'boolean' && typeof value$.value !== 'boolean') {
      repairedValue = asTrue(value$.value)
    }
    setValue(value$, repairedValue)
    tryAutoFocusElementUnder(ev)
  }

  return (
    <Button
      variant="danger"
      title={props.error}
      titlePlacement="bottomRight"
      disabled={!props.store.context.canEditValue}
      isSuffix={props.isSuffix}
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

function useRename(
  store: ConditionRowStore,
  validate: ((name: string, oldName: string) => string | undefined) | undefined,
  onRename: ((name: string) => void) | undefined,
) {
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
  return { renameError, onUpdateName, onCommit, renameError$ }
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
      }
    }
  }, 50)
}

// Limit automatic focus to known-safe controls, excluding elements such as a Boolean checkbox.
function shouldFocus(element: HTMLElement): boolean {
  return element.tagName === 'INPUT'
}

function simulateClick(element: HTMLElement): void {
  // Triggers most React DOM events.
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  // Triggers PointerEvent { type: "click" }.
  element.click()
  element.focus({ preventScroll: true })
}
