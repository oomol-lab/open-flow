import styles from './valueEditor.module.scss'
import type { FieldDisclosure } from './fieldTypeDisplay.tsx'

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
  disclosure,
}: {
  label: string
  container: HTMLElement | null
  raw: boolean
  onClear?: () => void
  onToggleJson?: () => void
  disclosure?: FieldDisclosure & { disabled?: boolean }
}) {
  const t = useTranslate()
  const toggleLabel = t(raw ? 'valueEditor.editAsForm' : 'valueEditor.editRawData')
  if (!onClear && !onToggleJson && !disclosure) return null
  const disclosureButton = disclosure && (
    <Button
      key="disclosure"
      type="button"
      variant="disclosure"
      size="icon-xs"
      aria-label={label}
      aria-expanded={disclosure.expanded}
      aria-controls={disclosure.controls}
      disabled={disclosure.disabled}
      onClick={disclosure.onToggle}
    >
      <i aria-hidden="true" className={disclosure.expanded ? 'i-lucide-light:chevron-up text-lg' : 'i-lucide-light:chevron-down text-lg'} />
    </Button>
  )
  const clearButton = onClear && (
    <Tooltip key="clear">
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
  )
  const jsonButton = onToggleJson && (
    <Tooltip key="json">
      <TooltipTrigger
        render={<Button type="button" variant="ghost" size="icon-xs" aria-label={`${label} ${toggleLabel}`} aria-pressed={raw} onClick={onToggleJson} />}
      >
        <i aria-hidden="true" className="i-lucide-light:braces" />
      </TooltipTrigger>
      <TooltipContent container={container}>{toggleLabel}</TooltipContent>
    </Tooltip>
  )
  return (
    <div className={styles.valueTools}>{disclosure?.expanded ? [disclosureButton, clearButton, jsonButton] : [clearButton, jsonButton, disclosureButton]}</div>
  )
}
