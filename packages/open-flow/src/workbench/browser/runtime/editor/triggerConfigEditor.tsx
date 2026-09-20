import type { ComponentProps } from 'react'
import type { JsonValue } from '../api.ts'

import { useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { EditableChoices } from '../../../../form/browser/editableChoices.tsx'
import { FieldName } from '../../../../form/browser/fieldName.tsx'
import { FieldTable, FieldTableRow } from '../../../../form/browser/fieldTable.tsx'
import { ValueEditor, ValueEditorFeedback } from '../../../../form/browser/valueEditor.tsx'
import { isJsonValue, objectValue } from '../../../../form/common/value.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Input } from '../../../../ui/browser/input.tsx'
import { Popover, PopoverPanelContent } from '../../../../ui/browser/popover.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { fieldPanelAnchor } from './fieldPanelAnchor.ts'
import { InspectorSection } from './inspectorSection.tsx'
import { TriggerConfigTitle } from './triggerConfigTitle.tsx'

// Invalid text stays inside the field editor; there is no separate submit action.
const draftIssue = () => {}

function ConfigFieldSettings({
  name,
  description,
  anchor,
  container,
}: {
  readonly name: string
  readonly description?: string
  readonly anchor: ComponentProps<typeof PopoverPanelContent>['anchor']
  readonly container: HTMLElement | null
}) {
  const t = useTranslate()
  return (
    <PopoverPanelContent
      anchor={anchor}
      container={container}
      sectionTitle={t('triggerConfig.configuration')}
      title={t('valueEditor.fieldSettings')}
      closeLabel={t('common.close')}
    >
      <Field className="gap-1.5">
        <FieldLabel className="text-xs font-normal text-muted-foreground">{t('valueEditor.fieldName')}</FieldLabel>
        <Input controlSize="field" value={name} readOnly />
      </Field>
      <Field className="gap-1.5">
        <FieldLabel className="text-xs font-normal text-muted-foreground">{t('triggerConfig.description')}</FieldLabel>
        <Textarea rows={2} className="min-h-16 max-h-40 resize-y text-xs md:text-xs" value={description ?? ''} readOnly />
      </Field>
    </PopoverPanelContent>
  )
}

export function TriggerConfigEditor({
  schema,
  config,
  disabled,
  onChange,
}: {
  readonly schema: JsonValue
  readonly config: Readonly<Record<string, JsonValue>>
  readonly disabled: boolean
  readonly onChange: (name: string, value: JsonValue | undefined) => void
}) {
  const t = useTranslate()
  const list = useRef<HTMLDivElement>(null)
  const [settingsIndex, setSettingsIndex] = useState<number>()
  const source = objectValue(schema)
  const required = Array.isArray(source?.required) ? source.required : []
  const properties = Object.entries(objectValue(source?.properties) ?? {})
    .filter(([, candidate]) => objectValue(candidate) != null)
    .toSorted(([left], [right]) => Number(!required.includes(left)) - Number(!required.includes(right)))
  if (properties.length === 0) return null
  return (
    <InspectorSection title={<TriggerConfigTitle />} contentInset={false} data-inspector-section="trigger">
      <FieldTable ref={list} layout="ports" fixedTypes typeColumn={false}>
        {properties.map(([name, candidate], index) => {
          const field = objectValue(candidate)!
          const description = typeof field.description === 'string' ? field.description : undefined
          const missing = required.includes(name) && !Object.hasOwn(config, name)
          const value = Object.hasOwn(config, name) ? config[name] : field.default
          const items = objectValue(field.items)
          const choices = Array.isArray(items?.enum) ? items.enum : undefined
          const change = (next: unknown) => {
            if (next === undefined || isJsonValue(next)) onChange(name, next as JsonValue | undefined)
          }
          const settings = (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    data-value-options
                    aria-label={`${name} ${t('valueEditor.fieldSettings')}`}
                    aria-expanded={settingsIndex === index}
                    onClick={() => setSettingsIndex(settingsIndex === index ? undefined : index)}
                  />
                }
              >
                <i aria-hidden="true" className="i-lucide-light:settings text-base" />
              </TooltipTrigger>
              <TooltipContent container={list.current}>{t('valueEditor.fieldSettings')}</TooltipContent>
            </Tooltip>
          )
          const editor =
            field.type === 'array' && choices != null ? (
              <ValueEditorFeedback error={missing ? t('triggerConfig.required') : undefined}>
                {(errorId) => (
                  <div aria-describedby={errorId}>
                    <EditableChoices
                      multiple
                      label={name}
                      options={choices}
                      labels={undefined}
                      value={value}
                      disabled={disabled}
                      invalid={missing}
                      onChange={change}
                    />
                  </div>
                )}
              </ValueEditorFeedback>
            ) : undefined
          return (
            <FieldTableRow key={name} data-config-index={index} data-editing={settingsIndex === index || undefined}>
              <ValueEditor
                layout="ports"
                header={
                  <FieldName name={name} description={description}>
                    <Input aria-label={t('valueEditor.fieldName')} value={name} readOnly />
                  </FieldName>
                }
                options={settings}
                hideValueTools
                schema={candidate}
                value={value}
                label={name}
                description={description}
                editor={editor}
                validationError={missing && editor == null ? t('triggerConfig.required') : undefined}
                disabled={disabled}
                path={`/${name.replaceAll('~', '~0').replaceAll('/', '~1')}`}
                onChange={change}
                onDraftIssue={draftIssue}
              />
              {settingsIndex === index && (
                <Popover
                  open
                  onOpenChange={(open) => {
                    if (!open) {
                      setSettingsIndex(undefined)
                      list.current?.querySelector<HTMLButtonElement>(`[data-config-index="${index}"] [data-value-options]`)?.focus()
                    }
                  }}
                >
                  <ConfigFieldSettings
                    name={name}
                    description={description}
                    container={list.current?.closest<HTMLElement>('.editor-context-panel') ?? list.current}
                    anchor={() => fieldPanelAnchor(list.current?.querySelector(`[data-config-index="${index}"]`))}
                  />
                </Popover>
              )}
            </FieldTableRow>
          )
        })}
      </FieldTable>
    </InspectorSection>
  )
}
