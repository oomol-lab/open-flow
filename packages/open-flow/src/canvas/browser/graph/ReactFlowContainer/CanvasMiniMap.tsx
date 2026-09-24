import styles from './ReactFlowContainer.module.scss'
import type { Val } from 'value-enhancer'

import { MiniMap } from '@xyflow/react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { DropdownMenuCheckboxItem } from '../../../../ui/browser/dropdown-menu.tsx'
import { CanvasTooltip } from '../../components/tooltip.tsx'

export function CanvasMiniMapMenuItem({ miniMapExpanded$ }: { readonly miniMapExpanded$: Val<boolean | undefined> }) {
  const t = useTranslate()
  const expanded = useVal(miniMapExpanded$)
  return (
    <DropdownMenuCheckboxItem checked={expanded === true} onCheckedChange={(checked) => miniMapExpanded$.set(checked)}>
      <i aria-hidden="true" className="i-lucide-light:picture-in-picture-2" />
      {t('miniMap')}
    </DropdownMenuCheckboxItem>
  )
}

export function CanvasMiniMap({ miniMapExpanded$ }: { readonly miniMapExpanded$: Val<boolean | undefined> }) {
  const t = useTranslate()
  const expanded = useVal(miniMapExpanded$)
  return expanded === true ? <MiniMap ariaLabel={t('miniMap')} className={styles.miniMap} pannable position="bottom-left" zoomable /> : null
}

export function CanvasMiniMapButton({ miniMapExpanded$ }: { readonly miniMapExpanded$: Val<boolean | undefined> }) {
  const t = useTranslate()
  const expanded = useVal(miniMapExpanded$)
  return (
    <CanvasTooltip placement="top" title={t('miniMap')}>
      <Button
        aria-label={t('miniMap')}
        aria-expanded={expanded === true}
        onClick={() => miniMapExpanded$.set(expanded !== true)}
        size="icon"
        type="button"
        variant="ghost"
      >
        <i aria-hidden="true" className="i-lucide-light:picture-in-picture-2" />
      </Button>
    </CanvasTooltip>
  )
}
