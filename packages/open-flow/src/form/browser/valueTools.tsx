import styles from './valueEditor.module.scss'

import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/browser/tooltip.tsx'

/** Inline value actions share presentation; the editor owns their value and disclosure changes. */
export function ValueTools({
  label,
  container,
  raw,
  onClear,
  onToggleJson,
}: {
  label: string
  container: HTMLElement | null
  raw: boolean
  onClear?: () => void
  onToggleJson?: () => void
}) {
  const t = useTranslate()
  const toggleLabel = t(raw ? 'valueEditor.editAsForm' : 'valueEditor.editRawData')
  if (!onClear && !onToggleJson) return null
  return (
    <div className={styles.valueTools}>
      {onClear && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className={styles.clearValue}
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`${t('valueEditor.clear')} ${label}`}
                onClick={onClear}
              />
            }
          >
            <i aria-hidden="true" className="i-lucide-light:x" />
          </TooltipTrigger>
          <TooltipContent container={container}>{t('valueEditor.clear')}</TooltipContent>
        </Tooltip>
      )}
      {onToggleJson && (
        <Tooltip>
          <TooltipTrigger
            render={<Button type="button" variant="ghost" size="icon-xs" aria-label={`${label} ${toggleLabel}`} aria-pressed={raw} onClick={onToggleJson} />}
          >
            <i aria-hidden="true" className="i-lucide-light:braces" />
          </TooltipTrigger>
          <TooltipContent container={container}>{toggleLabel}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
