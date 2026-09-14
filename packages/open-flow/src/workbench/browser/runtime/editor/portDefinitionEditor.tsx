import styles from './portList.module.scss'
import type { ReactNode } from 'react'
import type { ValueEditorProps } from '../../../../form/browser/valueEditor.tsx'
import type { Group, InputPort } from '../api.ts'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { EditorComponentSelect } from '../../../../form/browser/editorComponentSelect.tsx'
import { ValueEditor } from '../../../../form/browser/valueEditor.tsx'
import { valueForEditor } from '../../../../form/common/editorComponent.ts'
import { compile } from '../../../../form/common/validation/validator.ts'
import { objectValue } from '../../../../form/common/value.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { Popover, PopoverPanelContent } from '../../../../ui/browser/popover.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { movePort } from './portOrder.ts'

export function portType(port: InputPort): string {
  const type = objectValue(port.jsonSchema)?.type
  return Array.isArray(type) ? type.join(' | ') : typeof type === 'string' ? type : 'JSON'
}

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

function PortType({
  value,
  disabled,
  onChange,
  name = 'Schema',
}: {
  value: InputPort['jsonSchema']
  disabled: boolean
  onChange: (value: InputPort['jsonSchema']) => void
  name?: string
}) {
  return <EditorComponentSelect schema={value} name={name} disabled={disabled} onChange={(next) => onChange(next as InputPort['jsonSchema'])} />
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
      <PortType value={value} disabled={disabled} onChange={onChange} />
      <details className={styles.schema}>
        <summary>JSON Schema</summary>
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
      </details>
    </>
  )
}

type PortEditorProps = {
  layout?: 'values' | 'definition'
  defaultNullable?: boolean
  reservedNames?: readonly string[]
  disabled: boolean
  allowAddGroup?: boolean
  output?: boolean
  renderValue?: (port: InputPort, presentation: Pick<ValueEditorProps, 'header' | 'leadingControl' | 'description' | 'options'>) => ReactNode
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
  const listId = useId()
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
  const dragging = useRef<{ index: number; values: typeof values; x: number; y: number }>()
  const dropTarget = useRef<{ index: number; after: boolean }>()
  const [dragIndex, setDragIndex] = useState<number>()
  const [drop, setDrop] = useState<{ index: number; after: boolean }>()
  const [announcement, setAnnouncement] = useState('')
  const [editingIndex, setEditingIndex] = useState<number>()
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
    onChange(next)
    const port = values[from]!
    if ('handle' in port)
      setAnnouncement(t('inspector.ports.moved', { name: port.handle, position: values.slice(0, to + 1).filter((entry) => 'handle' in entry).length }))
  }
  const sections: { index?: number; group?: Group; ports: { port: InputPort; index: number }[] }[] = [{ ports: [] }]
  values.forEach((entry, index) => {
    if ('group' in entry) sections.push({ index, group: entry, ports: [] })
    else sections[sections.length - 1]!.ports.push({ port: entry, index })
  })
  const renderPort = ({ port, index }: { port: InputPort; index: number }) => {
    const leadingControl = !disabled ? (
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
          dragging.current = { index, values, x: event.clientX, y: event.clientY }
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
    const header = (
      <div className={styles.heading}>
        <span data-field-name className={styles.name} title={[port.handle, port.description].filter(Boolean).join(' — ')}>
          {props.layout === 'values' && !disabled ? (
            <PortName
              value={port.handle}
              names={[...reservedNames, ...values.flatMap((entry) => ('handle' in entry ? [entry.handle] : []))]}
              disabled={false}
              onChange={(handle) => update(index, { ...port, handle })}
            />
          ) : (
            <>
              {port.handle}
              {port.nullable ? ' ?' : ''}
            </>
          )}
        </span>
        <span data-field-type className={styles.type} title={portType(port)}>
          {props.layout === 'values' ? (
            <PortType
              name={port.handle}
              value={port.jsonSchema}
              disabled={!!disabled}
              onChange={(jsonSchema) =>
                update(index, {
                  ...port,
                  jsonSchema,
                  ...(port.value === undefined ? {} : { value: valueForEditor(jsonSchema, port.value) as InputPort['value'] }),
                })
              }
            />
          ) : (
            portType(port)
          )}
        </span>
      </div>
    )
    const options = !disabled ? (
      <Button
        type="button"
        size="xs"
        variant="ghost"
        aria-label={`${port.handle} ${t('valueEditor.fieldSettings')}`}
        aria-expanded={editingIndex === index}
        onClick={() => setEditingIndex(editingIndex === index ? undefined : index)}
      >
        <i aria-hidden="true" className="i-lucide-light:settings-2" />
        {t('valueEditor.fieldSettings')}
      </Button>
    ) : undefined
    const settings =
      editingIndex === index && !disabled ? (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditingIndex(undefined)
              list.current?.querySelector<HTMLButtonElement>(`[data-port-index="${index}"] [data-value-options]`)?.focus()
            }
          }}
        >
          <PopoverPanelContent
            container={list.current}
            anchor={() => list.current?.querySelector(`[data-port-index="${index}"]`) ?? null}
            title={`${port.handle} · ${t('valueEditor.fieldSettings')}`}
            closeLabel={t('common.close')}
          >
            <Label>{t('valueEditor.fieldName')}</Label>
            <PortName
              value={port.handle}
              names={[...reservedNames, ...values.flatMap((entry) => ('handle' in entry ? [entry.handle] : []))]}
              disabled={disabled}
              onChange={(handle) => update(index, { ...port, handle })}
            />
            <Label htmlFor={`${listId}-${index}-description`}>{t('inspector.node.description')}</Label>
            <Input
              id={`${listId}-${index}-description`}
              value={port.description ?? ''}
              disabled={disabled}
              onChange={(event) => update(index, { ...port, description: event.target.value })}
            />
            <Label className="flex items-center gap-2 text-xs font-normal">
              <Checkbox disabled={disabled} checked={port.nullable} onCheckedChange={(nullable) => update(index, { ...port, nullable: nullable === true })} />
              {t('valueEditor.nullable')}
            </Label>
            <PortSchema
              value={port.jsonSchema}
              disabled={disabled}
              onChange={(jsonSchema) =>
                update(index, {
                  ...port,
                  jsonSchema,
                  ...(port.value === undefined ? {} : { value: valueForEditor(jsonSchema, port.value) as InputPort['value'] }),
                })
              }
            />
            {!disabled && (
              <Button
                type="button"
                size="xs"
                variant="destructive"
                className="self-start"
                onClick={() => {
                  setEditingIndex(undefined)
                  onChange(values.filter((_, i) => i !== index))
                }}
              >
                {t('valueEditor.remove')}
              </Button>
            )}
          </PopoverPanelContent>
        </Popover>
      ) : null
    return (
      <div
        key={port.handle}
        className={styles.row}
        data-port={port.handle}
        data-editing={editingIndex === index || undefined}
        data-drop={drop?.index === index ? (drop.after ? 'after' : 'before') : undefined}
        data-port-index={index}
        data-dragging={dragIndex === index || undefined}
      >
        {props.renderValue ? (
          props.renderValue(port, { header, leadingControl, options, description: port.description })
        ) : (
          <ValueEditor
            leadingControl={leadingControl}
            layout={props.layout}
            header={header}
            options={options}
            description={port.description}
            schema={port.jsonSchema}
            value={port.value}
            label={port.handle}
            nullable={port.nullable}
            disabled={disabled}
            valueEditable={!props.output}
            editor={props.output ? null : undefined}
            path={`/${index}`}
            onDraftIssue={onDraftIssue}
            onDefinitionChange={
              props.layout === 'values'
                ? (jsonSchema, value) => {
                    const { value: _value, ...rest } = port
                    update(index, {
                      ...rest,
                      jsonSchema: jsonSchema as InputPort['jsonSchema'],
                      ...(value === undefined ? {} : { value: value as InputPort['value'] }),
                    })
                  }
                : undefined
            }
            onChange={(value) => {
              const { value: _value, ...rest } = port
              update(index, { ...rest, ...(value === undefined ? {} : { value: value as InputPort['value'] }) })
            }}
          />
        )}
        {settings}
      </div>
    )
  }
  return (
    <>
      {props.layout === 'values' && (
        <div ref={heading} className={styles.valuesTitle}>
          <FieldLabel>{t('inspector.ports.valuesTitle')}</FieldLabel>
          {!disabled && (
            <Tooltip>
              <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={t('valueEditor.addField')} onClick={addField} />}>
                <i aria-hidden="true" className="i-ph:plus-light text-lg" />
              </TooltipTrigger>
              <TooltipContent>{t('valueEditor.addField')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      <div className={styles.list} data-layout={props.layout} data-inputs={props.renderValue != null || undefined} ref={list}>
        <div className={styles.columns} data-layout={props.layout} data-output={props.output || undefined}>
          <span>{t(props.layout === 'values' ? 'inspector.ports.columnHandle' : 'inspector.ports.columnName')}</span>
          <span>{t(props.layout === 'values' ? 'valueEditor.component' : 'inspector.ports.columnType')}</span>
          {!props.output && <span>{t('inspector.ports.columnValue')}</span>}
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {announcement}
        </span>
        {sections.map((section, sectionIndex) =>
          section.group == null ? (
            <div key="ungrouped">{section.ports.map(renderPort)}</div>
          ) : (
            <details key={`group:${sectionIndex}`} className={styles.group} open={section.group.collapsed !== true}>
              <summary>
                <i aria-hidden="true" className="i-lucide-light:chevron-down" />
                <span>{section.group.group}</span>
              </summary>
              {section.ports.map(renderPort)}
              {!disabled && (
                <details className={styles.groupSettings}>
                  <summary aria-label={t('inspector.ports.groupSettings')} title={t('inspector.ports.groupSettings')}>
                    <i aria-hidden="true" className="i-lucide-light:settings-2" />
                  </summary>
                  <div className={styles.branch}>
                    <Input
                      aria-label={t('valueEditor.group')}
                      value={section.group.group}
                      onChange={(event) => update(section.index!, { ...section.group!, group: event.target.value })}
                    />
                    <Label className="flex items-center gap-2 text-xs font-normal">
                      <Checkbox
                        checked={section.group.collapsed === true}
                        onCheckedChange={(collapsed) => update(section.index!, { ...section.group!, collapsed: collapsed === true })}
                      />
                      {t('valueEditor.collapsed')}
                    </Label>
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="self-start"
                      onClick={() => onChange(values.filter((_, index) => index !== section.index))}
                    >
                      {t('valueEditor.remove')}
                    </Button>
                  </div>
                </details>
              )}
            </details>
          ),
        )}
        {!disabled && props.layout !== 'values' && (
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
      </div>
    </>
  )
}
