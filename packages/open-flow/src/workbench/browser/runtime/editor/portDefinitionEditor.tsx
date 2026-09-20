import styles from './portList.module.scss'
import type { ComponentProps, ReactNode } from 'react'
import type { FieldDisclosure } from '../../../../form/browser/fieldTypeDisplay.tsx'
import type { ValueEditorDeletion, ValueEditorProps } from '../../../../form/browser/valueEditor.tsx'
import type { Group, InputPort } from '../api.ts'
import type { PropertyDeletion } from './propertyDeletion.ts'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { EditorComponentSelect } from '../../../../form/browser/editorComponentSelect.tsx'
import { FieldName } from '../../../../form/browser/fieldName.tsx'
import { FieldSorting } from '../../../../form/browser/fieldSorting.ts'
import { FieldNullable, FieldTable, FieldTableRow } from '../../../../form/browser/fieldTable.tsx'
import { JsonEditor } from '../../../../form/browser/jsonEditor.tsx'
import { ValueEditor } from '../../../../form/browser/valueEditor.tsx'
import { valueForEditor } from '../../../../form/common/editorComponent.ts'
import { compile } from '../../../../form/common/validation/validator.ts'
import { objectValue } from '../../../../form/common/value.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { Popover, PopoverPanelContent } from '../../../../ui/browser/popover.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { fieldPanelAnchor } from './fieldPanelAnchor.ts'
import { FieldSectionHeader } from './fieldSectionHeader.tsx'
import { movePort } from './portOrder.ts'

export function portType(port: InputPort): string {
  const type = objectValue(port.jsonSchema)?.type
  return Array.isArray(type) ? type.join(' | ') : typeof type === 'string' ? type : 'JSON'
}

function PortName({
  value,
  disabled,
  names,
  onChange,
  id,
  compact,
}: {
  id?: string
  compact?: boolean
  value: string
  disabled: boolean
  names: readonly string[]
  onChange: (value: string) => void
}) {
  const t = useTranslate()
  const [draft, setDraft] = useState(value)
  const invalid = draft.trim() === '' || (draft !== value && names.includes(draft))
  useEffect(() => setDraft(value), [value])
  const save = () => {
    if (!disabled && !invalid && draft !== value) onChange(draft)
  }
  return (
    <Input
      id={id}
      controlSize={compact ? 'field' : 'default'}
      aria-label={t('valueEditor.fieldName')}
      aria-invalid={invalid}
      readOnly={disabled}
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

function PortType({
  value,
  disabled,
  onChange,
  name = 'Schema',
  id,
  compact = true,
  readOnlySurface = false,
  showArrayItemType = false,
  disclosure,
}: {
  value: InputPort['jsonSchema']
  disabled: boolean
  onChange: (value: InputPort['jsonSchema']) => void
  name?: string
  id?: string
  compact?: boolean
  readOnlySurface?: boolean
  showArrayItemType?: boolean
  disclosure?: FieldDisclosure
}) {
  return (
    <EditorComponentSelect
      id={id}
      compact={compact}
      schema={value}
      name={name}
      readOnly={disabled}
      readOnlySurface={readOnlySurface}
      showArrayItemType={showArrayItemType}
      disclosure={disclosure}
      onChange={(next) => onChange(next as InputPort['jsonSchema'])}
    />
  )
}

function PortSchema({ value, disabled, onChange }: { value: InputPort['jsonSchema']; disabled: boolean; onChange: (value: InputPort['jsonSchema']) => void }) {
  const t = useTranslate()
  const path = useId()
  const [invalid, setInvalid] = useState(false)
  useEffect(() => setInvalid(false), [value])
  const onDraftIssue = useCallback((_path: string, syntaxInvalid: boolean) => {
    if (syntaxInvalid) setInvalid(false)
  }, [])
  return (
    <Field className="gap-1.5">
      <span className="text-xs text-muted-foreground">JSON Schema</span>
      <JsonEditor
        autoHeight
        schema={true}
        label="JSON Schema"
        ariaLabel="JSON Schema"
        path={path}
        value={value}
        disabled={disabled}
        invalid={invalid}
        onDraftIssue={onDraftIssue}
        onChange={(next) => {
          if ((typeof next !== 'boolean' && objectValue(next) == null) || compile(next)[1]) {
            setInvalid(true)
            return
          }
          setInvalid(false)
          onChange(next as InputPort['jsonSchema'])
        }}
      />
      {invalid && (
        <p role="alert" className="text-xs text-destructive">
          {t('valueEditor.invalidSchema')}
        </p>
      )}
    </Field>
  )
}

function PortSettingsFields({
  port,
  names,
  disabled,
  showNullable,
  onChange,
}: {
  showNullable: boolean
  port: InputPort
  names: readonly string[]
  disabled: boolean
  onChange: (port: InputPort) => void
}) {
  const t = useTranslate()
  const id = useId()
  const updateSchema = (jsonSchema: InputPort['jsonSchema']) =>
    onChange({
      ...port,
      jsonSchema,
      ...(port.value === undefined
        ? {}
        : {
            value: valueForEditor(jsonSchema, port.value) as InputPort['value'],
          }),
    })
  return (
    <>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-name`} className="text-xs font-normal text-muted-foreground">
          {t('valueEditor.fieldName')}
        </FieldLabel>
        <PortName id={`${id}-name`} compact value={port.handle} names={names} disabled={disabled} onChange={(handle) => onChange({ ...port, handle })} />
      </Field>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-description`} className="text-xs font-normal text-muted-foreground">
          {t('inspector.node.description')}
        </FieldLabel>
        <Textarea
          id={`${id}-description`}
          rows={2}
          className="min-h-16 max-h-40 resize-y text-xs md:text-xs"
          value={port.description ?? ''}
          readOnly={disabled}
          onChange={(event) => onChange({ ...port, description: event.target.value })}
        />
      </Field>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-type`} className="text-xs font-normal text-muted-foreground">
          {t('inspector.ports.columnType')}
        </FieldLabel>
        <PortType id={`${id}-type`} compact={false} name={port.handle} value={port.jsonSchema} disabled={disabled} onChange={updateSchema} />
      </Field>
      <details className={styles.schema}>
        <summary>
          <i aria-hidden="true" className="i-lucide-light:chevron-right" />
          {t('valueEditor.advancedSettings')}
        </summary>
        <div className={styles.advancedContent}>
          {showNullable && (
            <Label className="flex items-center gap-2 text-xs font-normal">
              <Checkbox
                className="not-data-disabled:cursor-pointer"
                disabled={disabled}
                checked={port.nullable}
                onCheckedChange={(nullable) => onChange({ ...port, nullable: nullable === true })}
              />
              {t('valueEditor.nullable')}
            </Label>
          )}
          <PortSchema value={port.jsonSchema} disabled={disabled} onChange={updateSchema} />
        </div>
      </details>
    </>
  )
}

function RemoveFooter({ onRemove }: { onRemove: () => void }) {
  const t = useTranslate()
  return (
    <Button type="button" size="field" variant="destructive" className="ml-auto" onClick={onRemove}>
      {t('valueEditor.remove')}
    </Button>
  )
}

function GroupName({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const t = useTranslate()
  const [draft, setDraft] = useState(value)
  const invalid = draft.trim() === ''
  useEffect(() => setDraft(value), [value])
  const save = () => {
    if (!invalid && draft !== value) onChange(draft)
  }
  return (
    <Input
      id={id}
      controlSize="field"
      aria-label={t('valueEditor.groupName')}
      aria-invalid={invalid}
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

export function GroupSettingsPanel({
  group,
  onChange,
  onRemove,
  ...props
}: {
  group: Group
  onChange: (group: Group) => void
  onRemove: () => void
} & Pick<ComponentProps<typeof PopoverPanelContent>, 'anchor' | 'container' | 'side' | 'positionMethod' | 'sectionTitle'>) {
  const t = useTranslate()
  const id = useId()
  return (
    <PopoverPanelContent {...props} title={t('inspector.ports.groupSettings')} closeLabel={t('common.close')} footer={<RemoveFooter onRemove={onRemove} />}>
      <Field className="gap-1.5">
        <FieldLabel htmlFor={`${id}-name`} className="text-xs font-normal text-muted-foreground">
          {t('valueEditor.groupName')}
        </FieldLabel>
        <GroupName id={`${id}-name`} value={group.group} onChange={(name) => onChange({ ...group, group: name })} />
      </Field>
      <Label className="flex items-center gap-2 text-xs font-normal">
        <Checkbox checked={group.collapsed === true} onCheckedChange={(collapsed) => onChange({ ...group, collapsed: collapsed === true })} />
        {t('valueEditor.collapsed')}
      </Label>
    </PopoverPanelContent>
  )
}

export function PortSettingsPanel({
  port,
  names,
  disabled,
  onChange,
  onRemove,
  showNullable,
  ...props
}: ComponentProps<typeof PortSettingsFields> &
  Pick<ComponentProps<typeof PopoverPanelContent>, 'anchor' | 'container' | 'side' | 'positionMethod' | 'sectionTitle'> & { onRemove: () => void }) {
  const t = useTranslate()
  return (
    <PopoverPanelContent
      {...props}
      title={t('valueEditor.fieldSettings')}
      closeLabel={t('common.close')}
      footer={!disabled && <RemoveFooter onRemove={onRemove} />}
    >
      <PortSettingsFields showNullable={showNullable} port={port} names={names} disabled={disabled} onChange={onChange} />
    </PopoverPanelContent>
  )
}

type PortEditorProps = {
  layout?: 'values' | 'ports' | 'definition'
  title?: ReactNode
  titleIcon?: 'input' | 'output'
  defaultNullable?: boolean
  reservedNames?: readonly string[]
  disabled: boolean
  allowAddGroup?: boolean
  output?: boolean
  renderValue?: (
    port: InputPort,
    presentation: Pick<
      ValueEditorProps,
      'layout' | 'header' | 'leadingControl' | 'valueAddon' | 'trailingControl' | 'description' | 'options' | 'onDefinitionChange'
    >,
  ) => ReactNode
} & (
  | {
      groups: true
      values: readonly (InputPort | Group)[]
      onChange: (values: readonly (InputPort | Group)[], deletion?: PropertyDeletion) => void
    }
  | {
      groups?: false
      values: readonly InputPort[]
      onChange: (values: readonly InputPort[], deletion?: PropertyDeletion) => void
    }
)

export function PortDefinitionEditor(props: PortEditorProps) {
  const { defaultNullable = true, reservedNames = [], values, disabled } = props
  const onChange = (next: readonly (InputPort | Group)[], deletion?: PropertyDeletion) => {
    if (props.groups) props.onChange(next, deletion)
    else
      props.onChange(
        next.filter((port): port is InputPort => 'handle' in port),
        deletion,
      )
  }
  const t = useTranslate()
  const title = props.title ?? (props.layout === 'values' ? t('inspector.ports.valuesTitle') : undefined)
  const titleIcon = props.titleIcon ?? (props.output && props.layout === 'ports' && props.title != null ? 'output' : undefined)
  const [sorting, setSorting] = useState(false)
  const fieldCount = values.filter((port) => 'handle' in port).length
  const hasFields = fieldCount > 0
  const hasCompositeOutput =
    props.output === true &&
    values.some((value) => {
      if (!('handle' in value)) return false
      const type = objectValue(value.jsonSchema)?.type
      return type === 'array' || type === 'object'
    })
  const emptyMessage =
    disabled && !hasFields ? (props.output ? t('inspector.ports.noOutputs') : titleIcon === 'input' ? t('inspector.ports.noInputs') : undefined) : undefined
  const canSort = fieldCount > 1
  const sortingEnabled = sorting && !disabled && canSort
  useEffect(() => {
    if (!canSort) setSorting(false)
  }, [canSort])
  const onDraftIssue = useCallback(() => {}, [])
  const update = (index: number, port: InputPort | Group) => onChange(values.map((entry, i) => (i === index ? port : entry)))
  const list = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLDivElement>(null)
  const pendingName = useRef<string>()
  useEffect(() => {
    if (!pendingName.current) return
    const row = Array.from(list.current?.querySelectorAll<HTMLElement>('[data-port]') ?? []).find((element) => element.dataset.port === pendingName.current)
    const input = row?.querySelector<HTMLInputElement>('input')
    if (!input) return
    pendingName.current = undefined
    let scrollRoot = row!.parentElement
    while (scrollRoot && !/(auto|scroll)/.test(getComputedStyle(scrollRoot).overflowY)) scrollRoot = scrollRoot.parentElement
    if (scrollRoot) {
      const bounds = scrollRoot.getBoundingClientRect()
      const field = row!.getBoundingClientRect()
      const top = bounds.top + (heading.current?.offsetHeight ?? 0)
      if (field.bottom > bounds.bottom) scrollRoot.scrollBy({ top: field.bottom - bounds.bottom })
      else if (field.top < top) scrollRoot.scrollBy({ top: field.top - top })
    }
    input.focus({ preventScroll: true })
    input.select()
  }, [values])
  const addField = () => {
    let index = 1
    while (reservedNames.includes(`value${index}`) || values.some((port) => 'handle' in port && port.handle === `value${index}`)) index++
    pendingName.current = `value${index}`
    onChange([...values, { handle: `value${index}`, jsonSchema: {}, nullable: defaultNullable }])
  }
  const dragging = useRef<{
    index: number
    values: typeof values
    x: number
    y: number
  }>()
  const dropTarget = useRef<{ index: number; after: boolean }>()
  const [dragIndex, setDragIndex] = useState<number>()
  const [drop, setDrop] = useState<{ index: number; after: boolean }>()
  const [announcement, setAnnouncement] = useState('')
  const [editingIndex, setEditingIndex] = useState<number>()
  const [editingGroupIndex, setEditingGroupIndex] = useState<number>()
  const tableLayout = props.layout === 'values' || props.layout === 'ports'
  const cancelDrag = () => {
    dragging.current = undefined
    dropTarget.current = undefined
    setDrop(undefined)
    setDragIndex(undefined)
  }
  const reorder = (from: number, to: number) => {
    if (disabled) return
    const next = movePort(values, from, to)
    if (next === values) return
    setEditingIndex(undefined)
    setEditingGroupIndex(undefined)
    onChange(next)
    const port = values[from]!
    if ('handle' in port)
      setAnnouncement(
        t('inspector.ports.moved', {
          name: port.handle,
          position: values.slice(0, to + 1).filter((entry) => 'handle' in entry).length,
        }),
      )
  }
  const sections: {
    index?: number
    group?: Group
    ports: { port: InputPort; index: number }[]
  }[] = [{ ports: [] }]
  values.forEach((entry, index) => {
    if ('group' in entry) sections.push({ index, group: entry, ports: [] })
    else sections[sections.length - 1]!.ports.push({ port: entry, index })
  })
  const renderPort = ({ port, index }: { port: InputPort; index: number }) => {
    const leadingControl = sortingEnabled ? (
      <Button
        onClick={(event) => event.preventDefault()}
        type="button"
        size="icon-xs"
        variant="disclosure"
        className={`${styles.grip} w-[var(--field-toggle-width,24px)]`}
        aria-label={t('inspector.ports.reorder', { name: port.handle })}
        title={t('inspector.ports.reorderHint')}
        onPointerDown={(event) => {
          if (event.button !== 0 || disabled) return
          event.stopPropagation()
          dragging.current = {
            index,
            values,
            x: event.clientX,
            y: event.clientY,
          }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const source = dragging.current
          if (source == null || source.index !== index) return
          if (disabled || source.values !== values) {
            cancelDrag()
            return
          }
          if (Math.hypot(event.clientX - source.x, event.clientY - source.y) < 5) return
          setDragIndex(index)
          const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-port-index]')
          const target = row == null || !list.current?.contains(row) ? -1 : Number(row.dataset.portIndex)
          const rect = row?.getBoundingClientRect()
          const insertion = target < 0 || rect == null ? -1 : target + (event.clientY > rect.top + rect.height / 2 ? 1 : 0)
          const destination = insertion > index ? insertion - 1 : insertion
          if (insertion < 0 || movePort(values, index, destination) === values) {
            dropTarget.current = undefined
            setDrop(undefined)
            return
          }
          // A boundary has one owner, whether reached from the row above or below.
          const next = values[insertion] != null && 'handle' in values[insertion]! ? { index: insertion, after: false } : { index: insertion - 1, after: true }
          dropTarget.current = next
          setDrop(next)
        }}
        onPointerUp={(event) => {
          const source = dragging.current
          const target = dropTarget.current
          if (source != null && target != null && source.values === values) {
            const insertion = target.index + (target.after ? 1 : 0)
            reorder(source.index, insertion > source.index ? insertion - 1 : insertion)
          }
          cancelDrag()
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={cancelDrag}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancelDrag()
            return
          }
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          event.stopPropagation()
          reorder(index, index + (event.key === 'ArrowUp' ? -1 : 1))
        }}
      >
        <i aria-hidden="true" className="i-lucide-light:grip-vertical" />
      </Button>
    ) : undefined
    const header = (disclosure?: FieldDisclosure) => (
      <div className={styles.heading}>
        <FieldName name={port.handle} description={port.description} className={styles.name}>
          {tableLayout ? (
            <PortName
              value={port.handle}
              names={[...reservedNames, ...values.flatMap((entry) => ('handle' in entry ? [entry.handle] : []))]}
              disabled={disabled}
              onChange={(handle) => update(index, { ...port, handle })}
            />
          ) : (
            <>
              {port.handle}
              {port.nullable ? ' ?' : ''}
            </>
          )}
        </FieldName>
        <span data-field-type className={styles.type} title={tableLayout ? undefined : portType(port)}>
          {tableLayout ? (
            <PortType
              name={port.handle}
              compact={!props.output}
              readOnlySurface={!!props.output}
              showArrayItemType={!!props.output}
              disclosure={disabled && props.output ? disclosure : undefined}
              value={port.jsonSchema}
              disabled={!!disabled}
              onChange={(jsonSchema) =>
                update(index, {
                  ...port,
                  jsonSchema,
                  ...(port.value === undefined
                    ? {}
                    : {
                        value: valueForEditor(jsonSchema, port.value) as InputPort['value'],
                      }),
                })
              }
            />
          ) : (
            portType(port)
          )}
        </span>
      </div>
    )
    const trailingControl = tableLayout && (
      <FieldNullable name={port.handle} checked={port.nullable === true} onChange={disabled ? undefined : (nullable) => update(index, { ...port, nullable })} />
    )
    const options = (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              size={tableLayout ? 'icon-sm' : 'xs'}
              variant="ghost"
              data-value-options
              aria-label={`${port.handle} ${t('valueEditor.fieldSettings')}`}
              aria-expanded={editingIndex === index}
              onClick={() => {
                setEditingGroupIndex(undefined)
                setEditingIndex(editingIndex === index ? undefined : index)
              }}
            />
          }
        >
          <i aria-hidden="true" className="i-lucide-light:settings text-base" />
          {!tableLayout && t('valueEditor.fieldSettings')}
        </TooltipTrigger>
        <TooltipContent container={list.current}>{t('valueEditor.fieldSettings')}</TooltipContent>
      </Tooltip>
    )
    const settings =
      editingIndex === index ? (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditingIndex(undefined)
              list.current?.querySelector<HTMLButtonElement>(`[data-port-index="${index}"] [data-value-options]`)?.focus()
            }
          }}
        >
          <PortSettingsPanel
            sectionTitle={title}
            showNullable={!tableLayout}
            container={list.current?.closest<HTMLElement>('.editor-context-panel') ?? list.current}
            anchor={() => fieldPanelAnchor(list.current?.querySelector(`[data-port-index="${index}"]`))}
            port={port}
            names={[...reservedNames, ...values.flatMap((entry) => ('handle' in entry ? [entry.handle] : []))]}
            disabled={disabled}
            onChange={(next) => update(index, next)}
            onRemove={() => {
              setEditingIndex(undefined)
              onChange(
                values.filter((_, i) => i !== index),
                { target: 'field', name: port.handle },
              )
            }}
          />
        </Popover>
      ) : null
    const onDefinitionChange =
      tableLayout && !disabled
        ? (jsonSchema: unknown, value: unknown, deletion?: ValueEditorDeletion) => {
            const { value: _value, ...rest } = port
            onChange(
              values.map((entry, i) =>
                i === index
                  ? {
                      ...rest,
                      jsonSchema: jsonSchema as InputPort['jsonSchema'],
                      ...(props.output || value === undefined ? {} : { value: value as InputPort['value'] }),
                    }
                  : entry,
              ),
              deletion,
            )
          }
        : undefined
    return (
      <FieldTableRow
        key={port.handle}
        className={styles.row}
        data-port={port.handle}
        data-editing={editingIndex === index || undefined}
        data-drop={drop?.index === index ? (drop.after ? 'after' : 'before') : undefined}
        data-port-index={index}
        data-dragging={dragIndex === index || undefined}
      >
        {props.renderValue ? (
          props.renderValue(port, {
            layout: tableLayout ? props.layout : undefined,
            header,
            leadingControl,
            trailingControl,
            options,
            description: port.description,
            onDefinitionChange,
          })
        ) : (
          <ValueEditor
            leadingControl={leadingControl}
            layout={tableLayout ? props.layout : undefined}
            header={header}
            trailingControl={trailingControl}
            options={options}
            description={port.description}
            schema={port.jsonSchema}
            value={port.value}
            label={port.handle}
            nullable={port.nullable}
            disabled={disabled}
            definitionOnly={props.output}
            path={`/${index}`}
            onDraftIssue={onDraftIssue}
            onDefinitionChange={onDefinitionChange}
            onChange={(value, deletion) => {
              const { value: _value, ...rest } = port
              onChange(
                values.map((entry, i) =>
                  i === index
                    ? {
                        ...rest,
                        ...(value === undefined ? {} : { value: value as InputPort['value'] }),
                      }
                    : entry,
                ),
                deletion,
              )
            }}
          />
        )}
        {settings}
      </FieldTableRow>
    )
  }
  return (
    <FieldSorting.Provider value={sortingEnabled}>
      {(props.title != null || props.layout === 'values' || !disabled) && (
        <FieldSectionHeader
          ref={heading}
          title={
            title == null ? undefined : (
              <>
                {titleIcon === 'input' && <i aria-hidden="true" className="i-carbon:port-input text-base" />}
                {titleIcon === 'output' && <i aria-hidden="true" className="i-carbon:port-output text-base" />}
                {title}
              </>
            )
          }
          disabled={disabled}
          canSort={canSort}
          sorting={sortingEnabled}
          onToggleSorting={() => {
            cancelDrag()
            setSorting(!sortingEnabled)
          }}
          addLabel={t('valueEditor.addField')}
          onAdd={addField}
        />
      )}
      {emptyMessage != null && <p className="m-0 pr-3 pb-4 pl-8 text-left text-xs text-muted-foreground">{emptyMessage}</p>}
      <FieldTable
        className={styles.list}
        layout={props.layout}
        fixedTypes={disabled}
        output={props.output}
        nullable={tableLayout}
        empty={!hasFields}
        data-inputs={props.renderValue != null || undefined}
        data-composite-types={hasCompositeOutput || undefined}
        ref={list}
      >
        <span className="sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
        {sections.map((section, sectionIndex) =>
          section.group == null ? (
            <div key="ungrouped">{section.ports.map(renderPort)}</div>
          ) : (
            <div
              key={`group:${sectionIndex}`}
              className={styles.group}
              data-group-index={section.index}
              data-editing={editingGroupIndex === section.index || undefined}
            >
              <details open={section.group.collapsed !== true}>
                <summary>
                  <span aria-hidden="true" className={styles.groupToggle}>
                    <i className="i-lucide-light:chevron-right text-sm" data-collapsed />
                    <i className="i-lucide-light:chevron-down text-sm" data-expanded />
                  </span>
                  <span className={styles.groupName}>{section.group.group}</span>
                </summary>
                {section.ports.map(renderPort)}
              </details>
              {!disabled && (
                <>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          className={styles.groupSettings}
                          data-group-settings
                          aria-label={t('inspector.ports.groupSettings')}
                          aria-expanded={editingGroupIndex === section.index}
                          onClick={() => {
                            setEditingIndex(undefined)
                            setEditingGroupIndex(editingGroupIndex === section.index ? undefined : section.index)
                          }}
                        />
                      }
                    >
                      <i aria-hidden="true" className="i-lucide-light:settings-2 text-base" />
                    </TooltipTrigger>
                    <TooltipContent container={list.current}>{t('inspector.ports.groupSettings')}</TooltipContent>
                  </Tooltip>
                  {editingGroupIndex === section.index && (
                    <Popover
                      open
                      onOpenChange={(open) => {
                        if (!open) {
                          setEditingGroupIndex(undefined)
                          list.current?.querySelector<HTMLButtonElement>(`[data-group-index="${section.index}"] [data-group-settings]`)?.focus()
                        }
                      }}
                    >
                      <GroupSettingsPanel
                        sectionTitle={title}
                        container={list.current?.closest<HTMLElement>('.editor-context-panel') ?? list.current}
                        anchor={() => fieldPanelAnchor(list.current?.querySelector(`[data-group-index="${section.index}"] > details > summary`))}
                        group={section.group}
                        onChange={(next) => update(section.index!, next)}
                        onRemove={() => {
                          setEditingGroupIndex(undefined)
                          onChange(
                            values.filter((_, index) => index !== section.index),
                            { target: 'group', name: section.group!.group },
                          )
                        }}
                      />
                    </Popover>
                  )}
                </>
              )}
            </div>
          ),
        )}
        {!disabled && !tableLayout && (
          <div className={styles.actions}>
            <Button type="button" size="xs" variant="ghost" onClick={addField}>
              <i aria-hidden="true" className="i-lucide-light:plus" />
              {t('valueEditor.addField')}
            </Button>
            {props.groups && props.allowAddGroup !== false && (
              <Button type="button" size="xs" variant="ghost" onClick={() => onChange([...values, { group: t('valueEditor.group') }])}>
                {t('valueEditor.addGroup')}
              </Button>
            )}
          </div>
        )}
      </FieldTable>
    </FieldSorting.Provider>
  )
}
