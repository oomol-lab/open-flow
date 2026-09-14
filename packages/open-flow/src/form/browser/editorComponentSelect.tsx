import type { EditorComponent } from '../common/editorComponent.ts'

import { Fragment, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../../ui/browser/select.tsx'
import { editorComponent, editorGroups, schemaForEditor } from '../common/editorComponent.ts'
import { fieldSelectTriggerClass, selectionMenuRowClass } from './fieldSelect.tsx'

export function EditorComponentSelect({
  schema,
  name,
  disabled,
  onChange,
}: {
  schema: unknown
  name: string
  disabled?: boolean
  onChange: (schema: Record<string, unknown>) => void
}) {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const items = Object.values(editorGroups)
    .flat()
    .map((value) => ({ value, label: t(`valueEditor.components.${value}`) }))
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        value={editorComponent(schema)}
        items={items}
        disabled={disabled}
        onValueChange={(value) => {
          if (value != null) onChange(schemaForEditor(value as EditorComponent, schema))
        }}
      >
        <SelectTrigger size="field" aria-label={t('valueEditor.type', { name })} className={fieldSelectTriggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent container={container} align="start" alignItemWithTrigger={false} className="min-w-44 p-2 [scrollbar-width:thin]">
          {Object.entries(editorGroups).map(([group, components], index) => (
            <Fragment key={group}>
              {index > 0 && <SelectSeparator className="mx-2 bg-border/50" />}
              <SelectGroup aria-label={t(`valueEditor.componentGroups.${group}`)} className="p-0">
                {components.map((component) => (
                  <SelectItem key={component} value={component} className={selectionMenuRowClass}>
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
