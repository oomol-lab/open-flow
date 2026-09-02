import styles from './schemaEditor.module.scss'
import type { useStoreApi } from '@xyflow/react'
import type { ErrorObject } from 'ajv'
import type { JSX } from 'react/jsx-runtime'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { HandleRowProps, IHandleAction } from '../components/handleRow.tsx'
import type { AnyOfConditionStore, AnyOfWidgetStore } from '../stores/schemaEditor/anyOfWidget.store.ts'
import type { ArrayWidgetStore } from '../stores/schemaEditor/arrayWidget.store.ts'
import type { MultiSelectWidgetStore } from '../stores/schemaEditor/multiSelectWidget.store.ts'
import type { ObjectFieldStore, ObjectWidgetStore } from '../stores/schemaEditor/objectWidget.store.ts'
import type { WidgetStore } from '../stores/schemaEditor/reconcileWidget.ts'
import type { SchemaRowStore } from '../stores/schemaEditor/schemaRow.store.ts'
import type { SelectItemStore, SelectWidgetStore } from '../stores/schemaEditor/selectWidget.store.ts'
import type { WidgetContext } from '../stores/schemaEditor/widgetContext.ts'
import type { WidgetType } from './preset.ts'

import { seq } from '@wopjs/async-seq'
import { disposableStore } from '@wopjs/disposable'
import Ajv from 'ajv'
import { clsx } from 'clsx'
import { isEqual } from 'radash'
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVal, useValues } from 'use-value-enhancer'
import { Trans, useI18n, useTranslate } from 'val-i18n-react'
import { readonlyVal, setValue, val } from 'value-enhancer'
import { NODE_HANDLE_CLASSNAME } from '../base/designer.ts'
import { asString, isBannedName, stringifyJSON, toNonEmptyString, toTrue, trueFalse, tryParseJSON } from '../base/trivial.ts'
import { Button } from '../components/button.tsx'
import { colorTypeOptions, dateTimeFormatOptions, optionOfColorType, optionOfDateTimeFormat } from '../components/constants.ts'
import { CssWrapper } from '../components/cssWrapper.tsx'
import { HandleRow } from '../components/handleRow.tsx'
import { Input } from '../components/input.tsx'
import { TranslationInput } from '../components/input2.tsx'
import { Label } from '../components/label.tsx'
import { Null } from '../components/null.tsx'
import { DesignerCombobox as Select } from '../components/select.tsx'
import { LabeledSwitch } from '../components/toggleSwitch.tsx'
import { DesignerTooltip } from '../components/tooltip.tsx'
import { optionOfStringFormat, stringFormatOptions, typeHasSubpanel } from '../stores/schemaEditor/constants.ts'
import { localizeAjvErrors } from '../validate/ajvLocalize.ts'
import { getBaseSchema, iconOf, isUndecidable, optionOf, ui_options, widgetSelectOptions } from './preset.ts'
import { useHandleTrack } from './useHandleTrack.ts'

const MIN_SCHEMA_WIDTH = 400

export interface SchemaEditorProps {
  readonly title: string
  readonly store: SchemaRowStore
  readonly panelWidth$: Val<number | undefined>
  readonly reactFlowStore?: ReturnType<typeof useStoreApi>
  /** Return an error message when a proposed name is invalid. */
  validate?: (name: string, oldName: string) => string | undefined
  onRename?: (name: string) => void
  onClose?: () => void
  onDelete?: () => void
}

export function SchemaEditor({ title, store, panelWidth$, reactFlowStore, validate, onRename, onClose, onDelete }: SchemaEditorProps): JSX.Element {
  const t = useTranslate()
  const [sourceCode, setSourceCode] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const handleTrack = useHandleTrack(MIN_SCHEMA_WIDTH, panelWidth$, containerRef, reactFlowStore)

  return (
    <div ref={containerRef} className={styles.wrapper}>
      <header className={`${styles.header} ${NODE_HANDLE_CLASSNAME}`}>
        <h3>
          <span className={styles.title}>{title}</span>
          {store.context.canEditSchema && onDelete && (
            <Button wrapperClassName={styles.deleteBtn} onClick={onDelete}>
              <i className="i-codicon:trash" />
            </Button>
          )}
        </h3>
        <aside>
          <Button onClick={() => setSourceCode((s) => !s)}>
            <i className={iconOf('gotoFile')} />
          </Button>
          {onClose && (
            <Button ariaLabel={t('close')} title={t('close')} onClick={onClose}>
              <i className={iconOf('close')} />
            </Button>
          )}
        </aside>
      </header>
      {sourceCode ? <CodeEditor store={store} /> : <LowCodeEditor store={store} validate={validate} onRename={onRename} />}
      <div data-pos="e" className={`${styles.resizeHandle} ${styles.resizeHandleE}`} onPointerDown={handleTrack} />
    </div>
  )
}

interface CodeEditorProps {
  readonly store: SchemaRowStore
}

function CodeEditor({ store }: CodeEditorProps) {
  const i18n = useI18n()
  const [div, setDiv] = useState<HTMLDivElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const restricted = useVal(store.context.restrict$) != null

  useLayoutEffect(() => {
    if (div) {
      const dispose = disposableStore()
      const initialValue = stringifyJSON(store.schema$.value)

      let isMounted = true
      let schema$: Val<string> | ReadonlyVal<string>
      if (store.context.canEditSchema && !restricted) {
        schema$ = dispose.add(val(initialValue))

        let schema = store.schema$.value
        dispose.add(
          store.schema$.reaction((newSchema) => {
            if (isEqual(schema, newSchema)) return
            schema = newSchema
            return setValue(schema$, stringifyJSON(schema))
          }),
        )

        const ajv = new Ajv({ allErrors: true, verbose: true })
        const queue = dispose.add(seq({ dropHead: true, window: 1 }))
        // Kept so the reported message can be re-localized when the UI language changes.
        let schemaErrors: ErrorObject[] | null = null
        dispose.add(
          i18n.lang$.reaction((lang) => {
            if (!isMounted || schemaErrors == null) return
            localizeAjvErrors(lang, schemaErrors)
            setError(ajv.errorsText(schemaErrors))
          }),
        )
        schema$.reaction((json) =>
          queue.schedule(async () => {
            try {
              const result = tryParseJSON(json)
              if (result.isErr()) {
                schemaErrors = null
                if (isMounted) setError(result.unwrapErr())
                return
              }
              schema = result.unwrap()
              await ajv.validateSchema(schema as any)
              schemaErrors = ajv.errors != null && ajv.errors.length > 0 ? ajv.errors : null
              if (isMounted) {
                if (schemaErrors != null) {
                  localizeAjvErrors(i18n.lang, schemaErrors)
                  setError(ajv.errorsText(schemaErrors))
                } else {
                  setError(null)
                  store.schema$.set(schema)
                }
              }
            } catch (err) {
              schemaErrors = null
              if (isMounted) setError(err + '')
            }
          }),
        )
      } else {
        schema$ = dispose.add(readonlyVal(initialValue)[0])
      }

      const unmount = store.context.createSchemaEditor(div, schema$)
      if (unmount) dispose.add(unmount)

      return () => {
        isMounted = false
        setTimeout(() => dispose(), 0)
      }
    }
  }, [div, store.context.createSchemaEditor])

  return (
    <>
      <div ref={setDiv} className={styles.sourceEditor} />
      <div className={styles.schemaError}>{error}</div>
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
      <Label className={styles.label} tooltipClassName={styles.labelTooltip} title={props.title} htmlTitle={props.name} suffix={props.labelSuffix}>
        {props.name}
      </Label>
    ) : (
      props.name
    )

  return <HandleRow {...props} className={clsx(styles[props.context.inout], styles.field)} name={name} value={props.children} actions={props.actions} />
}

export interface LowCodeEditorProps {
  readonly store: SchemaRowStore
  readonly level?: string
  readonly nameFactor?: number
  readonly valueFactor?: number
  readonly hideHandle?: boolean
  validate?: (name: string, oldName: string) => string | undefined
  onRename?: (name: string) => void
}

export function LowCodeEditor({ store, level, nameFactor = 1, valueFactor = 1, hideHandle, validate, onRename }: LowCodeEditorProps): JSX.Element {
  const t = useTranslate()
  const { context } = store

  const description = useVal(store.displayDescription$)
  const [descriptionExpanded, setDescriptionExpanded] = useState(false)
  const toggleDescription = () => setDescriptionExpanded((e) => !e)

  const restricted = useVal(context.restrict$) != null
  const nullable = useVal(store.nullable$)
  const kind = useVal(store.kind$)
  const widget = useVal(store.widget$)
  const widgetType = useVal(widget.widgetType$)

  const expanded = useVal(widget.expanded$)
  const hasSubpanel = doesTypeHasSubpanel(widgetType)

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

  return (
    <CssWrapper css={{ '--name-factor': nameFactor, '--value-factor': valueFactor }}>
      {hideHandle ? null : (
        <Field level={level} isLast={false} context={context} name={t('inputHandleEditor.handleName')}>
          <DesignerTooltip open={!!renameError} placement="bottomLeft" title={renameError}>
            <div className={styles.handleNameWrapper}>
              <Input
                className={clsx(renameError && styles.renameError)}
                value={store.name}
                disabled={!context.canEditSchema}
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
      )}
      <Field level={level} isLast={false} context={context} name={t('inputHandleEditor.nullable')}>
        <LabeledSwitch
          checked={nullable}
          onChange={store.nullable$.set}
          disabled={restricted || !context.canEditSchema}
          label={{
            true: (
              <Trans message={t('inputHandleEditor.canPassNull')}>
                <Null />
              </Trans>
            ),
            false: (
              <Trans message={t('inputHandleEditor.cannotPassNull')}>
                <Null />
              </Trans>
            ),
          }}
        />
      </Field>
      <Field
        level={level}
        isLast={false}
        context={context}
        name={t('schemaEditor.kind')}
        labelSuffix={
          <DesignerTooltip placement="top" title={t('schemaEditor.kindTooltip')}>
            <div className={styles.question}>
              <i className="i-codicon:question" />
            </div>
          </DesignerTooltip>
        }
        title="kind"
      >
        <Input
          placeholder={t('inputHandleEditor.unset')}
          value={kind || ''}
          onChange={(value) => setValue(store.kind$, toNonEmptyString(value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field
        level={level}
        isLast={false}
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
      <Field
        level={level}
        context={context}
        name={t('inputHandleEditor.presetType')}
        expanded={hasSubpanel ? expanded : null}
        onExpandedChange={widget.expanded$.set}
      >
        <Select
          options={widgetSelectOptions(t, (type) => !isBannedType(context, type))}
          value={optionOf(t, widgetType)}
          disabled={restricted || !context.canEditSchema}
          onChange={(e) => e && setValue(store.schema$, getBaseSchema(e.value, store.schema$.value))}
        />
      </Field>
      {hasSubpanel && expanded && <Subpanel level={level ? level.slice(0, -1) + ' |' : ' '} type={widgetType} store={widget} />}
    </CssWrapper>
  )
}

interface SubpanelProps {
  readonly level: string
  readonly type: WidgetType
  readonly store: WidgetStore
}

const Subpanel = /*#__PURE__*/ memo(function Subpanel(props: SubpanelProps) {
  // Keep these branches aligned with typeHasSubpanel.
  switch (props.type) {
    case 'string':
      return <SubpanelString {...props} />
    case 'integer':
    case 'number':
      return <SubpanelNumber {...props} />
    case 'color':
      return <SubpanelColor {...props} />
    case 'date':
      return <SubpanelDate {...props} />
    case 'select':
      if (!props.store.isSelect()) {
        console.warn('Expecting select widget store, got', props.store)
        return null
      }
      return <SubpanelSelect {...props} />
    case 'multiSelect':
      if (!props.store.isMultiSelect()) {
        console.warn('Expecting multiSelect widget store, got', props.store)
        return null
      }
      return <SubpanelSelect {...props} />
    case 'array':
      if (!props.store.isArray()) {
        console.warn('Expecting array widget store, got', props.store)
        return null
      }
      return <SubpanelArray {...props} />
    case 'object':
      if (!props.store.isObject()) {
        console.warn('Expecting object widget store, got', props.store)
        return null
      }
      return <SubpanelObject {...props} />
    case 'anyOf':
      if (!props.store.isAnyOf()) {
        console.warn('Expecting anyOf widget store, got', props.store)
        return null
      }
      return <SubpanelAnyOf {...props} />
    default:
      return null
  }
})

function SubpanelString(props: SubpanelProps) {
  const t = useTranslate()
  const { context } = props.store
  const restricted = useVal(context.restrict$) != null

  const { format$, pattern$, minLength$, maxLength$ } = useMemo(() => props.store.configureString(), [props.store])

  const format = useVal(format$)
  const pattern = useVal(pattern$)
  const minLength = useVal(minLength$)
  const maxLength = useVal(maxLength$)

  return (
    <>
      <Field context={context} level={props.level} isLast={false} name={t('inputHandleEditor.widget.string.format')} title="format">
        <Select
          options={stringFormatOptions(t)}
          value={optionOfStringFormat(format, t)}
          onChange={(e) => e && setValue(format$, e.value || undefined)}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field context={context} level={props.level} isLast={false} name={t('inputHandleEditor.widget.string.pattern')} title="pattern">
        <Input
          placeholder={t('inputHandleEditor.unset')}
          value={asString(pattern)}
          onChange={(value) => setValue(pattern$, toNonEmptyString(value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field context={context} level={props.level} isLast={false} name={t('inputHandleEditor.widget.string.minLength')} title="minLength">
        <Input
          type="number"
          min={0}
          step={1}
          placeholder={t('inputHandleEditor.unset')}
          value={asString(minLength)}
          onRealChange={(value) => setValue(minLength$, filterNatural(parseInteger(value)))}
          onBlur={(input) => {
            input.value = asString(minLength)
          }}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field context={context} level={props.level} name={t('inputHandleEditor.widget.string.maxLength')} title="maxLength">
        <Input
          type="number"
          min={0}
          step={1}
          placeholder={t('inputHandleEditor.unset')}
          value={asString(maxLength)}
          onRealChange={(value) => setValue(maxLength$, filterNatural(parseInteger(value)))}
          onBlur={(input) => {
            input.value = asString(maxLength)
          }}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
    </>
  )
}

function parseNumber(value: string): number | undefined {
  const num = Number.parseFloat(value)
  if (Number.isFinite(num)) return num
}

function parseInteger(value: string): number | undefined {
  const num = Number.parseFloat(value)
  if (Number.isSafeInteger(num)) return num
}

function filterNatural(value: number | undefined): number | undefined {
  if (value == null) return value
  return Number.isSafeInteger(value) && value >= 0 ? value : void 0
}

function SubpanelNumber(props: SubpanelProps) {
  const t = useTranslate()
  const { context } = props.store
  const restricted = useVal(context.restrict$) != null

  const { step$, minimum$, maximum$, exclusiveMinimum$, exclusiveMaximum$ } = useMemo(() => props.store.configureNumber(), [props.store])

  const step = useVal(step$)
  const minimum = useVal(minimum$)
  const maximum = useVal(maximum$)
  const exclusiveMinimum = useVal(exclusiveMinimum$)
  const exclusiveMaximum = useVal(exclusiveMaximum$)

  return (
    <>
      <Field context={context} level={props.level} isLast={false} name={t('inputHandleEditor.widget.number.step')} title={`'${ui_options}'.step`}>
        <Input
          type="number"
          placeholder={t('inputHandleEditor.unset')}
          value={asString(step)}
          onChange={(value) => setValue(step$, parseNumber(value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field context={context} level={props.level} isLast={false} name={t('inputHandleEditor.widget.number.minimum')} title="minimum">
        <Input
          type="number"
          placeholder={t('inputHandleEditor.unset')}
          value={asString(minimum)}
          onChange={(value) => setValue(minimum$, parseNumber(value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field context={context} level={props.level} isLast={false} name={t('inputHandleEditor.widget.number.maximum')} title="maximum">
        <Input
          type="number"
          placeholder={t('inputHandleEditor.unset')}
          value={asString(maximum)}
          onChange={(value) => setValue(maximum$, parseNumber(value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field context={context} level={props.level} isLast={false} name={t('inputHandleEditor.widget.number.exclusiveMinimum')} title="exclusiveMinimum">
        <Input
          type="number"
          placeholder={t('inputHandleEditor.unset')}
          value={asString(exclusiveMinimum)}
          onChange={(value) => setValue(exclusiveMinimum$, parseNumber(value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field context={context} level={props.level} name={t('inputHandleEditor.widget.number.exclusiveMaximum')} title="exclusiveMaximum">
        <Input
          type="number"
          placeholder={t('inputHandleEditor.unset')}
          value={asString(exclusiveMaximum)}
          onChange={(value) => setValue(exclusiveMaximum$, parseNumber(value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
    </>
  )
}

function SubpanelColor(props: SubpanelProps) {
  const t = useTranslate()
  const { context } = props.store
  const restricted = useVal(context.restrict$) != null

  const { colorType$ } = useMemo(() => props.store.configureColor(), [props.store])
  const colorType = useVal(colorType$)

  return (
    <Field context={context} level={props.level} name={t('inputHandleEditor.widget.color.type')} title={`'${ui_options}'.colorType`}>
      <Select
        options={colorTypeOptions}
        value={colorType && optionOfColorType(colorType)}
        onChange={(e) => e && setValue(colorType$, e.value)}
        disabled={restricted || !context.canEditSchema}
      />
    </Field>
  )
}

function SubpanelDate(props: SubpanelProps) {
  const t = useTranslate()
  const { context } = props.store
  const restricted = useVal(context.restrict$) != null

  const { format$ } = useMemo(() => props.store.configureDate(), [props.store])
  const format = useVal(format$)

  return (
    <Field context={context} level={props.level} name={t('inputHandleEditor.widget.date.format')} title="format">
      <Select
        value={format && optionOfDateTimeFormat(format)}
        options={dateTimeFormatOptions}
        onChange={(e) => e && setValue(format$, e.value)}
        disabled={restricted || !context.canEditSchema}
      />
    </Field>
  )
}

function AddButton(props: { readonly level: string; readonly isLast?: boolean; readonly context: WidgetContext; onAdd: () => void }) {
  const t = useTranslate()

  return (
    <HandleRow
      level={props.level}
      isLast={props.isLast}
      className={clsx(styles[props.context.inout], styles.addButtonRow)}
      variant="value-only"
      value={
        <Button className={styles.addButton} onClick={props.onAdd} disabled={!props.context.canEditSchema} prefix={<i className={iconOf('objectAdd')} />}>
          {t('handleEditor.addItem')}
        </Button>
      }
    />
  )
}

function SubpanelSelect(props: SubpanelProps) {
  const store = props.store as SelectWidgetStore | MultiSelectWidgetStore
  const { context, items$ } = store
  const restricted = useVal(context.restrict$) != null
  const items = useValues(items$)

  return (
    <>
      {items.length === 0 && !restricted && context.canEditSchema && <AddButton level={props.level} context={context} onAdd={() => store.addItem(-1)} />}
      {items.map((widget, index) => {
        const isLast = index === items.length - 1
        return (
          <SelectItem
            key={index}
            index={index}
            level={props.level.slice(0, -1) + (isLast ? ' ' : '|')}
            isLast={isLast}
            store={widget}
            onAdd={() => store.addItem(index)}
            onDelete={() => store.removeItem(index)}
          />
        )
      })}
    </>
  )
}

function SelectItem(props: {
  readonly level: string
  readonly isLast: boolean
  readonly index: number
  readonly store: SelectItemStore
  readonly onAdd: () => void
  readonly onDelete: () => void
}) {
  const t = useTranslate()
  const { context } = props.store
  const restricted = useVal(context.restrict$) != null
  const value = useVal(props.store.value$)
  const label = useVal(props.store.label$)

  const allowAdd = context.role === 'author' && !restricted
  const actionAdd: IHandleAction = {
    icon: iconOf('objectAdd'),
    title: t('inputHandleEditor.addField'),
    disabled: !allowAdd,
    onClick: props.onAdd,
  }

  const allowDelete = context.role === 'author' && !restricted
  const actionDelete: IHandleAction = {
    icon: iconOf('objectDelete'),
    title: t('nodeActions.delete'),
    disabled: !allowDelete,
    onClick: props.onDelete,
  }

  return (
    <>
      <Field
        context={context}
        level={props.level}
        isLast={false}
        name={t('schemaEditor.value')}
        actions={[actionAdd, actionDelete]}
        arrowPrefix={
          <span className={styles.arrayItemIndex} title={String(props.index + 1)}>
            <span>{props.index + 1}.</span>
          </span>
        }
      >
        <Input
          value={asString(value)}
          onChange={props.store.value$.set}
          placeholder={t('inputHandleEditor.unset')}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field context={context} level={props.level} isLast={props.isLast} name={t('schemaEditor.label')}>
        <Input value={label} onChange={props.store.label$.set} placeholder={t('inputHandleEditor.unset')} disabled={restricted || !context.canEditSchema} />
      </Field>
    </>
  )
}

function SubpanelArray(props: SubpanelProps) {
  const t = useTranslate()
  const { context, itemsSchema$, itemsWidget$ } = props.store as ArrayWidgetStore
  const restricted = useVal(context.restrict$) != null

  const { minItems$, maxItems$ } = useMemo(() => props.store.configureArray(), [props.store])
  const minItems = useVal(minItems$)
  const maxItems = useVal(maxItems$)

  const widget = useVal(itemsWidget$)
  const widgetType = useVal(widget.widgetType$)
  const expanded = useVal(widget.expanded$)
  const hasSubpanel = doesTypeHasSubpanel(widgetType)

  // Nested object and array items are not supported yet.
  return (
    <>
      <Field context={context} level={props.level} isLast={false} name={t('inputHandleEditor.widget.array.minItems')} title="minItems">
        <Input
          type="number"
          min={0}
          step={1}
          placeholder={t('inputHandleEditor.unset')}
          value={asString(minItems)}
          onRealChange={(value) => setValue(minItems$, filterNatural(parseInteger(value)))}
          onBlur={(input) => {
            input.value = asString(minItems)
          }}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field context={context} level={props.level} isLast={false} name={t('inputHandleEditor.widget.array.maxItems')} title="maxItems">
        <Input
          type="number"
          min={0}
          step={1}
          placeholder={t('inputHandleEditor.unset')}
          value={asString(maxItems)}
          onRealChange={(value) => setValue(maxItems$, filterNatural(parseInteger(value)))}
          onBlur={(input) => {
            input.value = asString(maxItems)
          }}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      <Field
        context={context}
        level={props.level}
        expanded={hasSubpanel ? expanded : null}
        onExpandedChange={widget.expanded$.set}
        name={t('inputHandleEditor.widget.array.itemType')}
        title="items.type"
      >
        <Select
          options={widgetSelectOptions(t, (type) => !isBannedSubType(type))}
          value={optionOf(t, widgetType)}
          onChange={(e) => e && setValue(itemsSchema$, getBaseSchema(e.value, itemsSchema$.value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      {hasSubpanel && expanded && <Subpanel level={props.level.slice(0, -1) + '  '} type={widgetType} store={widget} />}
    </>
  )
}

function SubpanelObject(props: SubpanelProps) {
  const t = useTranslate()
  const store = props.store as ObjectWidgetStore
  const context = store.context
  const restricted = useVal(context.restrict$) != null

  const { additionalProperties$ } = useMemo(() => props.store.configureObject(), [props.store])
  const additionalProperties = useVal(additionalProperties$) ?? true

  const allowAdd = context.role === 'author' && !restricted
  const actionAdd: IHandleAction = {
    icon: iconOf('objectAdd'),
    title: t('inputHandleEditor.addField'),
    disabled: !allowAdd,
    onClick: () => store.addField(),
  }

  const fields = useVal(store.fields$)

  return (
    <>
      <Field
        context={store.context}
        level={props.level}
        isLast={!store.context.canEditSchema && fields.length === 0}
        name={t('inputHandleEditor.widget.object.additionalProperties')}
        title="additionalProperties"
        actions={toTrue(fields.length > 0 && store.context.canEditSchema) && [actionAdd]}
      >
        <LabeledSwitch
          checked={additionalProperties}
          onChange={(v) => setValue(additionalProperties$, v ? undefined : v)}
          label={trueFalse}
          disabled={restricted || !store.context.canEditSchema}
        />
      </Field>
      {fields.length === 0 && !restricted && store.context.canEditSchema && (
        <AddButton level={props.level} isLast={fields.length === 0} context={store.context} onAdd={() => store.addField()} />
      )}
      {fields.map((field, index) => {
        const isLast = index === fields.length - 1
        return (
          <ObjectField
            key={field.name}
            level={props.level.slice(0, -1) + (isLast ? ' ' : '|')}
            isLast={isLast}
            store={field}
            onRename={(newName) => store.renameField(field.name, newName)}
            onAdd={() => store.addField(field.name)}
            onDelete={() => store.removeField(field.name)}
          />
        )
      })}
    </>
  )
}

function ObjectField(props: {
  readonly level: string
  readonly isLast: boolean
  readonly store: ObjectFieldStore
  readonly onRename: (newName: string) => void
  readonly onAdd: () => void
  readonly onDelete: () => void
}) {
  const t = useTranslate()
  const { context } = props.store
  const restricted = useVal(context.restrict$) != null

  const widget = useVal(props.store.widget$)
  const widgetType = useVal(widget.widgetType$)
  const expanded = useVal(widget.expanded$)
  const hasSubpanel = doesTypeHasSubpanel(widgetType)

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
        props.onRename(name)
      } else {
        renameError$.set(undefined)
      }
    },
    [props.onRename, props.store],
  )
  const renameError = useVal(renameError$)

  const allowAdd = context.role === 'author' && !restricted
  const actionAdd: IHandleAction = {
    icon: iconOf('objectAdd'),
    title: t('inputHandleEditor.addField'),
    disabled: !allowAdd,
    onClick: props.onAdd,
  }

  const allowDelete = context.role === 'author' && !restricted
  const actionDelete: IHandleAction = {
    icon: iconOf('objectDelete'),
    title: t('inputHandleEditor.deleteField'),
    disabled: !allowDelete,
    onClick: props.onDelete,
  }

  return (
    <>
      <Field
        context={context}
        level={props.level}
        isLast={props.isLast}
        expanded={hasSubpanel ? expanded : null}
        onExpandedChange={widget.expanded$.set}
        name={
          <DesignerTooltip open={!!renameError} placement="left" title={renameError}>
            <div className={styles.objectFieldNameWrapper}>
              <Input
                className={clsx(renameError && styles.renameError)}
                value={props.store.name}
                onChange={onUpdateName}
                onRealChange={onCommit}
                disabled={!context.canEditSchema}
                onBlur={(input) => {
                  input.value = props.store.name
                  renameError$.set(undefined)
                }}
              />
            </div>
          </DesignerTooltip>
        }
        actions={[actionAdd, actionDelete]}
      >
        <Select
          options={widgetSelectOptions(t, (type) => !isBannedSubType(type))}
          value={optionOf(t, widgetType)}
          onChange={(e) => e && setValue(props.store.schema$, getBaseSchema(e.value, props.store.schema$.value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      {hasSubpanel && expanded && <Subpanel level={props.level + (props.isLast ? ' ' : '|')} type={widgetType} store={widget} />}
    </>
  )
}

function SubpanelAnyOf(props: SubpanelProps) {
  const store = props.store as AnyOfWidgetStore
  const { context, conditions$ } = store
  const restricted = useVal(context.restrict$) != null

  const conditions = useValues(conditions$)

  return (
    <>
      {conditions.length === 0 && !restricted && context.canEditSchema && (
        <AddButton level={props.level} context={context} onAdd={() => store.addCondition(-1)} />
      )}
      {conditions.map((widget, index) => {
        const isLast = index === conditions.length - 1
        return (
          <AnyOfCondition
            key={index}
            index={index}
            level={props.level.slice(0, -1) + (isLast ? ' ' : '|')}
            isLast={isLast}
            store={widget}
            onAdd={() => store.addCondition(index)}
            onDelete={() => store.removeCondition(index)}
          />
        )
      })}
    </>
  )
}

function AnyOfCondition(props: {
  readonly index: number
  readonly level: string
  readonly isLast: boolean
  readonly store: AnyOfConditionStore
  readonly onAdd: () => void
  readonly onDelete: () => void
}) {
  const t = useTranslate()
  const { context } = props.store
  const restricted = useVal(context.restrict$) != null
  const label = useVal(props.store.label$)

  const widget = useVal(props.store.widget$)
  const widgetType = useVal(widget.widgetType$)
  const expanded = useVal(widget.expanded$)
  const hasSubpanel = doesTypeHasSubpanel(widgetType)

  const allowAdd = context.role === 'author' && !restricted
  const actionAdd: IHandleAction = {
    icon: iconOf('objectAdd'),
    title: t('handleEditor.addItem'),
    disabled: !allowAdd,
    onClick: props.onAdd,
  }

  const allowDelete = context.role === 'author' && !restricted
  const actionDelete: IHandleAction = {
    icon: iconOf('objectDelete'),
    title: t('nodeActions.delete'),
    disabled: !allowDelete,
    onClick: props.onDelete,
  }

  return (
    <>
      <Field
        level={props.level}
        isLast={props.isLast}
        expanded={hasSubpanel ? expanded : null}
        onExpandedChange={widget.expanded$.set}
        context={context}
        name={
          <Input
            placeholder={t('inputHandleEditor.widget.conditions.title', { index: props.index + 1 })}
            value={label}
            onRealChange={props.store.label$.set}
            disabled={restricted || !context.canEditSchema}
          />
        }
        actions={[actionAdd, actionDelete]}
      >
        <Select
          value={optionOf(t, widgetType)}
          options={widgetSelectOptions(t, (type) => type === 'binary' || !isBannedSubType(type))}
          onChange={(e) => e && setValue(props.store.schema$, getBaseSchema(e.value, props.store.schema$.value))}
          disabled={restricted || !context.canEditSchema}
        />
      </Field>
      {hasSubpanel && expanded && <Subpanel level={props.level + (props.isLast ? ' ' : '|')} type={widgetType} store={widget} />}
    </>
  )
}

function isBannedType(context: WidgetContext, t: WidgetType): boolean {
  if (t === 'allOf' || t === 'oneOf') return true
  if ((t === 'any' || t === 'anyOf') && !context.enableAny) return true
  return false
}

// Keep nested schemas simple by excluding undecidable widget types.
function isBannedSubType(type: WidgetType): boolean {
  if (type === 'any') return false
  return isUndecidable(type) || type === 'binary'
}

function doesTypeHasSubpanel(type: WidgetType): boolean {
  return typeHasSubpanel.has(type)
}
