import type { pickerAppGroups } from './nodePickerApps.ts'

import { useTranslate } from 'val-i18n-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../../../ui/browser/tooltip.tsx'

export function ProviderGroupHeading({ group, container }: { group: (typeof pickerAppGroups)[number]; container?: HTMLElement | null }) {
  const t = useTranslate()
  return (
    <div className="flex items-center gap-1 px-2.5 pb-1 text-muted-foreground">
      <h3 style={{ margin: 0 }} className="text-xs font-medium">
        {t(`nodePicker.${group}`)}
      </h3>
      <Tooltip>
        <TooltipTrigger
          aria-label={t(`nodePicker.${group}`)}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden="true" className="i-codicon:question text-[13px]" />
        </TooltipTrigger>
        <TooltipContent container={container} side="top" align="start">
          {t(`nodePicker.${group}Description`)}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
