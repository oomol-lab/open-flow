import type { ReactNode } from 'react'

import { forwardRef } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { FieldLabel } from '../../../../ui/browser/field.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../ui/browser/tooltip.tsx'
import { cn } from '../../../../ui/browser/utils.ts'

export type FieldSectionIcon = 'input' | 'output' | 'configuration'

/** The same title content is used by section headings and their settings panels. */
export function FieldSectionTitle({ children, icon }: { children: ReactNode; icon?: FieldSectionIcon }) {
  return (
    <>
      {icon === 'input' && <i aria-hidden="true" className="i-carbon:port-input text-base" />}
      {icon === 'output' && <i aria-hidden="true" className="i-carbon:port-output text-base" />}
      {icon === 'configuration' && <i aria-hidden="true" className="i-carbon:power -rotate-90 text-base" />}
      {children}
    </>
  )
}

interface FieldSectionHeaderProps {
  title?: ReactNode
  disabled: boolean
  canSort: boolean
  sorting: boolean
  onToggleSorting: () => void
  addLabel: string
  onReset?: () => void
  onAdd: () => void
  compact?: boolean
}

/** Shared heading and actions for editable property-panel field lists. */
export const FieldSectionHeader = forwardRef<HTMLDivElement, FieldSectionHeaderProps>(function FieldSectionHeader(
  { title, disabled, canSort, sorting, onToggleSorting, addLabel, onAdd, onReset, compact },
  ref,
) {
  const t = useTranslate()
  const sortLabel = t(sorting ? 'inspector.ports.finishSorting' : 'inspector.ports.sort')
  return (
    <div ref={ref} className={cn(compact ? 'flex min-h-7 items-center gap-2' : 'inspector-section-title', 'justify-between')}>
      {title != null ? <FieldLabel>{title}</FieldLabel> : <span />}
      {onReset && (
        <Tooltip>
          <TooltipTrigger render={<Button type="button" variant="ghost" size="xs" aria-label={t('valueEditor.resetDefaults')} onClick={onReset} />}>
            <i aria-hidden="true" data-icon="inline-start" className="i-lucide-light:rotate-ccw" />
            {t('valueEditor.reset')}
          </TooltipTrigger>
          <TooltipContent>{t('valueEditor.resetDefaults')}</TooltipContent>
        </Tooltip>
      )}
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
})
