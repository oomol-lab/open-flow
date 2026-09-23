import type { JsonDataType } from '../common/value.ts'

import { useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { MenuHeader } from '../../ui/browser/menu-header.tsx'
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../../ui/browser/select.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/browser/tooltip.tsx'
import { jsonDataTypes, valueType } from '../common/value.ts'
import { editorComponentIcons } from './editorComponentIcon.tsx'
import { FieldTypeDisplay } from './fieldTypeDisplay.tsx'
import { selectionMenuContentClass, selectionMenuItemClass } from './selectionMenuStyles.ts'

type DisplayDataType = JsonDataType | 'any'

/** Selects the stored data type of an unconstrained schema without changing the schema itself. */
export function DataTypeAddon({
  name,
  value,
  any,
  disabled,
  onChange,
}: {
  name: string
  value: unknown
  any?: boolean
  disabled?: boolean
  onChange?: (type: JsonDataType | undefined) => void
}) {
  const t = useTranslate()
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const selected: DisplayDataType = any || value === undefined ? 'any' : (valueType({}, value) as JsonDataType)
  const label = t(selected === 'any' ? 'valueEditor.any' : `valueEditor.${selected}`)
  const accessibleLabel = t('valueEditor.valueDataType', { name, type: label })
  const icon = selected === 'any' ? editorComponentIcons.json : editorComponentIcons[selected]

  if (disabled || !onChange) {
    return (
      <FieldTypeDisplay
        label={label}
        accessibleLabel={accessibleLabel}
        icon={<i aria-hidden="true" className={`${icon} inline-block shrink-0 text-base`} />}
        addon
      />
    )
  }

  const items = [{ value: 'any', label: t('valueEditor.any') }, ...jsonDataTypes.map((type) => ({ value: type, label: t(`valueEditor.${type}`) }))]
  return (
    <div ref={setContainer} className="min-w-0">
      <Select
        open={open}
        onOpenChange={setOpen}
        value={selected}
        items={items}
        onValueChange={(next) => {
          if (next != null) onChange(next === 'any' ? undefined : (next as JsonDataType))
        }}
      >
        <Tooltip disabled={open}>
          <TooltipTrigger render={<SelectTrigger variant="addon" aria-label={accessibleLabel} />}>
            <SelectValue className="flex-none justify-center">
              <i aria-hidden="true" className={`${icon} inline-block shrink-0 text-base`} />
            </SelectValue>
          </TooltipTrigger>
          <TooltipContent container={container}>{label}</TooltipContent>
        </Tooltip>
        <SelectContent container={container} align="start" alignItemWithTrigger={false} className={`min-w-36 ${selectionMenuContentClass}`}>
          <SelectGroup className="p-0" aria-label={t('valueEditor.dataTypeTitle')}>
            <MenuHeader>{t('valueEditor.dataTypeTitle')}</MenuHeader>
            <SelectItem value="any" className={selectionMenuItemClass}>
              <i aria-hidden="true" className={`${editorComponentIcons.json} inline-block shrink-0 text-base`} />
              {t('valueEditor.any')}
            </SelectItem>
            <SelectSeparator className="mx-2 bg-border/50" />
            {jsonDataTypes.map((type) => (
              <SelectItem key={type} value={type} className={selectionMenuItemClass}>
                <i aria-hidden="true" className={`${editorComponentIcons[type]} inline-block shrink-0 text-base`} />
                {t(`valueEditor.${type}`)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
