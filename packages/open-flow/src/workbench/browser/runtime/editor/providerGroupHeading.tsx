import type { MouseEventHandler } from 'react'
import type { pickerAppGroups } from './nodePickerApps.ts'

import { useTranslate } from 'val-i18n-react'
import { PickerGroupHeading } from './pickerGroupHeading.tsx'

export function ProviderGroupHeading({
  group,
  container,
  onClick,
}: {
  onClick: MouseEventHandler<HTMLButtonElement>
  group: (typeof pickerAppGroups)[number]
  container?: HTMLElement | null
}) {
  const t = useTranslate()
  return (
    <div className="sticky top-0 z-10 bg-popover">
      <PickerGroupHeading title={t(`nodePicker.${group}`)} help={t(`nodePicker.${group}Description`)} container={container} onClick={onClick} />
    </div>
  )
}
