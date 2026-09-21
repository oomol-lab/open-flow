import styles from './portList.module.scss'
import type { ComponentProps } from 'react'
import type { FieldDisclosure } from '../../../../form/browser/fieldTypeDisplay.tsx'
import type { Group, InputPort } from '../api.ts'

import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { EditorComponentSelect } from '../../../../form/browser/editorComponentSelect.tsx'
import { JsonEditor } from '../../../../form/browser/jsonEditor.tsx'
import { valueForEditor } from '../../../../form/common/editorComponent.ts'
import { compile } from '../../../../form/common/validation/validator.ts'
import { objectValue } from '../../../../form/common/value.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Checkbox } from '../../../../ui/browser/checkbox.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Label } from '../../../../ui/browser/label.tsx'
import { PopoverPanelContent } from '../../../../ui/browser/popover.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'

export function PortName({
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

export function PortType({
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
        <PortType id={`${id}-type`} compact={false} readOnlySurface name={port.handle} value={port.jsonSchema} disabled={disabled} onChange={updateSchema} />
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
