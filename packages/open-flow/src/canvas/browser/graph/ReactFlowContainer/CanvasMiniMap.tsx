import styles from './ReactFlowContainer.module.scss'
import type { Val } from 'value-enhancer'

import { MiniMap } from '@xyflow/react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { CanvasTooltip } from '../../components/tooltip.tsx'

export function MiniMapToggleIcon({ expanded }: { readonly expanded: boolean }): React.ReactElement {
  return <i aria-hidden="true" className="i-lucide-light:picture-in-picture-2" data-corner-icon data-icon={expanded ? 'mini-map-close' : 'mini-map-open'} />
}

export function CanvasMiniMap({ miniMapExpanded$ }: { readonly miniMapExpanded$: Val<boolean | undefined> }) {
  const t = useTranslate()
  const miniMapExpanded = useVal(miniMapExpanded$)
  return (
    <>
      <CanvasTooltip placement="top" title={t('miniMap')}>
        <Button
          aria-label={t('miniMap')}
          aria-expanded={miniMapExpanded === true}
          onClick={() => miniMapExpanded$.set(miniMapExpanded !== true)}
          size="icon"
          type="button"
          variant="ghost"
        >
          <MiniMapToggleIcon expanded={miniMapExpanded === true} />
        </Button>
      </CanvasTooltip>
      {miniMapExpanded === true && <MiniMap ariaLabel={t('miniMap')} className={styles.miniMap} pannable position="bottom-left" zoomable />}
    </>
  )
}
