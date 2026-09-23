import type { EditorComponent } from '../common/editorComponent.ts'
import type { FieldDisclosure } from './fieldTypeDisplay.tsx'

import { Fragment, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { MenuHeader } from '../../ui/browser/menu-header.tsx'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../../ui/browser/select.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/browser/tooltip.tsx'
import { editorComponent, editorGroups, schemaForEditor } from '../common/editorComponent.ts'
import { objectValue } from '../common/value.ts'
import { EditorComponentIcon } from './editorComponentIcon.tsx'
import { fieldSelectTriggerClass } from './fieldSelect.tsx'
import { FieldTypeDisplay } from './fieldTypeDisplay.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from './selectionMenuStyles.ts'

export function EditorComponentSelect({
  schema,
  id,
  name,
  disabled,
  invalid,
  readOnly,
  compact = true,
  showIcon = true,
  readOnlySurface = false,
  showArrayItemType = false,
  menuTitle,
  addon = false,
  disclosure,
  onChange,
}: {
  schema: unknown
  id?: string
  name: string
  disabled?: boolean
  invalid?: boolean
  readOnly?: boolean
  compact?: boolean
  showIcon?: boolean
  readOnlySurface?: boolean
  showArrayItemType?: boolean
  menuTitle?: string
  addon?: boolean
  disclosure?: FieldDisclosure
  onChange: (schema: Record<string, unknown>) => void
}) {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const selectedComponent = editorComponent(schema)
  const label = t(`valueEditor.components.${selectedComponent}`)
  if (showArrayItemType && selectedComponent === 'array' && !Array.isArray(objectValue(schema)?.items)) {
    const source = objectValue(schema) ?? {}
    return (
      <div className="flex min-w-0 items-center gap-1">
        <div className={`${readOnly ? 'w-8' : 'w-14'} shrink-0`}>
          <EditorComponentSelect
            schema={schema}
            name={name}
            disabled={disabled}
            invalid={invalid}
            readOnly={readOnly}
            compact
            readOnlySurface={readOnlySurface}
            onChange={onChange}
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{t('valueEditor.arrayOf')}</span>
        <div className="min-w-0 flex-1">
          <EditorComponentSelect
            schema={source.items ?? {}}
            name={`${name}[]`}
            menuTitle={t('valueEditor.arrayItemTypeTitle')}
            disabled={disabled}
            readOnly={readOnly}
            compact={false}
            readOnlySurface={readOnlySurface}
            onChange={(items) => onChange({ ...source, items })}
          />
        </div>
      </div>
    )
  }
  if (readOnly) {
    return (
      <FieldTypeDisplay
        id={id}
        label={label}
        accessibleLabel={`${t('valueEditor.type', { name })}: ${label}`}
        icon={showIcon && <EditorComponentIcon component={selectedComponent} />}
        compact={compact}
        surface={readOnlySurface}
        disclosure={selectedComponent === 'object' ? disclosure : undefined}
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
            render={
              <SelectTrigger
                id={id}
                size="field"
                aria-invalid={invalid}
                aria-label={`${t('valueEditor.type', { name })}: ${label}`}
                variant={addon ? 'addon' : 'default'}
                className={addon ? undefined : fieldSelectTriggerClass}
              />
            }
          >
            <SelectValue className={addon ? 'flex-none justify-center' : undefined}>
              {showIcon && <EditorComponentIcon component={selectedComponent} />}
              <span className={compact ? 'sr-only' : undefined}>{label}</span>
            </SelectValue>
          </TooltipTrigger>
          {compact && <TooltipContent container={container}>{label}</TooltipContent>}
        </Tooltip>
        <SelectContent
          container={container}
          align="start"
          alignItemWithTrigger={false}
          className={`min-w-44 [scrollbar-width:thin] ${selectionMenuContentClass}`}
        >
          <SelectGroup className="p-0" aria-label={menuTitle ?? t('valueEditor.typeTitle')}>
            <MenuHeader>{menuTitle ?? t('valueEditor.typeTitle')}</MenuHeader>
            {Object.entries(editorGroups).map(([group, components], index) => (
              <Fragment key={group}>
                {index > 0 && <SelectSeparator className="mx-2 bg-border/50" />}
                <SelectGroup aria-label={t(`valueEditor.componentGroups.${group}`)} className="p-0">
                  {components.map((component) => (
                    <SelectItem key={component} value={component} className={selectionMenuItemClass}>
                      {showIcon && <EditorComponentIcon component={component} />}
                      {t(`valueEditor.components.${component}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </Fragment>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

/** Displays a type inside explanatory copy without inheriting field-control height. */
export function InlineEditorComponentDisplay({ schema, name }: { schema: unknown; name: string }) {
  const t = useTranslate()
  const selectedComponent = editorComponent(schema)
  const label = t(`valueEditor.components.${selectedComponent}`)
  return (
    <span
      role="img"
      aria-label={`${t('valueEditor.type', { name })}: ${label}`}
      className="relative inline-flex min-w-0 items-center pl-[22px] text-xs leading-[18px] font-normal text-muted-foreground"
    >
      <span aria-hidden="true" className="absolute left-0 top-1/2 flex size-4 -translate-y-1/2 items-center justify-center">
        <EditorComponentIcon component={selectedComponent} />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}
