import type { EditorComponent } from '../common/editorComponent.ts'

import { Fragment, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../../ui/browser/select.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/browser/tooltip.tsx'
import { editorComponent, editorGroups, schemaForEditor } from '../common/editorComponent.ts'
import { EditorComponentIcon } from './editorComponentIcon.tsx'
import { fieldSelectTriggerClass, selectionMenuRowClass } from './fieldSelect.tsx'
import { FieldTypeDisplay } from './fieldTypeDisplay.tsx'

export function EditorComponentSelect({
  schema,
  id,
  name,
  disabled,
  readOnly,
  compact = true,
  onChange,
}: {
  schema: unknown
  id?: string
  name: string
  disabled?: boolean
  readOnly?: boolean
  compact?: boolean
  onChange: (schema: Record<string, unknown>) => void
}) {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const selectedComponent = editorComponent(schema)
  const label = t(`valueEditor.components.${selectedComponent}`)
  if (readOnly) {
    return (
      <FieldTypeDisplay
        id={id}
        label={label}
        accessibleLabel={`${t('valueEditor.type', { name })}: ${label}`}
        icon={<EditorComponentIcon component={selectedComponent} />}
        compact={compact}
      />
    )
  }
  const items = Object.values(editorGroups)
    .flat()
    .map((value) => ({ value, label: t(`valueEditor.components.${value}`) }))
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        value={selectedComponent}
        items={items}
        disabled={disabled}
        onValueChange={(value) => {
          if (value != null) onChange(schemaForEditor(value as EditorComponent, schema))
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={<SelectTrigger id={id} size="field" aria-label={`${t('valueEditor.type', { name })}: ${label}`} className={fieldSelectTriggerClass} />}
          >
            <SelectValue>
              <EditorComponentIcon component={selectedComponent} />
              <span className={compact ? 'sr-only' : undefined}>{label}</span>
            </SelectValue>
          </TooltipTrigger>
          {compact && <TooltipContent container={container}>{label}</TooltipContent>}
        </Tooltip>
        <SelectContent container={container} align="start" alignItemWithTrigger={false} className="min-w-44 p-2 [scrollbar-width:thin]">
          {Object.entries(editorGroups).map(([group, components], index) => (
            <Fragment key={group}>
              {index > 0 && <SelectSeparator className="mx-2 bg-border/50" />}
              <SelectGroup aria-label={t(`valueEditor.componentGroups.${group}`)} className="p-0">
                {components.map((component) => (
                  <SelectItem key={component} value={component} className={selectionMenuRowClass}>
                    <EditorComponentIcon component={component} />
                    {t(`valueEditor.components.${component}`)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </Fragment>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
