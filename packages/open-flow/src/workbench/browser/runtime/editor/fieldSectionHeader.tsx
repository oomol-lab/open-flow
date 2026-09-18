import type { ReactNode, Ref } from 'react'

import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { FieldLabel } from '../../../../ui/browser/field.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'

/** Shared heading and actions for editable property-panel field lists. */
export function FieldSectionHeader({
  ref,
  title,
  disabled,
  canSort,
  sorting,
  onToggleSorting,
  addLabel,
  onAdd,
}: {
  ref?: Ref<HTMLDivElement>
  title?: ReactNode
  disabled: boolean
  canSort: boolean
  sorting: boolean
  onToggleSorting: () => void
  addLabel: string
  onAdd: () => void
}) {
  const t = useTranslate()
  const sortLabel = t(sorting ? 'inspector.ports.finishSorting' : 'inspector.ports.sort')
  return (
    <div ref={ref} className="inspector-section-title justify-between">
      {title != null ? <FieldLabel>{title}</FieldLabel> : <span />}
      {!disabled && (
        <div className="ml-auto flex items-center">
          {canSort && (
            <Tooltip>
              <TooltipTrigger
                render={<Button type="button" variant="ghost" size="xs" aria-pressed={sorting} aria-label={sortLabel} onClick={onToggleSorting} />}
              >
                <i aria-hidden="true" data-icon="inline-start" className={sorting ? 'i-lucide-light:check' : 'i-lucide-light:list-ordered'} />
                {sortLabel}
              </TooltipTrigger>
              <TooltipContent>{sortLabel}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={addLabel} onClick={onAdd} />}>
              <i aria-hidden="true" className="i-lucide-light:plus text-lg" />
            </TooltipTrigger>
            <TooltipContent>{addLabel}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
}
