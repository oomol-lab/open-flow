import styles from './CornerControls.module.scss'
import containerStyles from './ReactFlowContainer.module.scss'
import type { Val } from 'value-enhancer'

import { Controls, MiniMap as RFMiniMap } from '@xyflow/react'
import { memo } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../../../ui/browser/button.tsx'
import { cn } from '../../../../ui/browser/utils.ts'

export interface CornerControlsProps {
  children?: React.ReactNode
  miniMapExpanded$?: Val<boolean | undefined>
}

export function MiniMapToggleIcon({ expanded }: { readonly expanded: boolean }): React.ReactElement {
  return (
    <i
      aria-hidden="true"
      className={expanded ? 'i-carbon:shrink-screen' : 'i-custom:minimap'}
      data-corner-icon
      data-icon={expanded ? 'mini-map-close' : 'mini-map-open'}
    />
  )
}

export const CornerControls: React.FC<CornerControlsProps> = /* @__PURE__ */ memo(function (props: CornerControlsProps) {
  const t = useTranslate()
  const miniMapExpanded = useVal(props.miniMapExpanded$)
  if (props.miniMapExpanded$ == null && props.children == null) return null

  return (
    <>
      <Controls
        className={cn(containerStyles.island, styles.surface, styles.corner)}
        orientation="horizontal"
        position="top-right"
        showFitView={false}
        showInteractive={false}
        showZoom={false}
      >
        {props.miniMapExpanded$ != null && (
          <Button
            aria-label={t('miniMap')}
            aria-expanded={miniMapExpanded === true}
            onClick={() => props.miniMapExpanded$?.set(miniMapExpanded !== true)}
            size="icon"
            title={t('miniMap')}
            type="button"
            variant="ghost"
          >
            <MiniMapToggleIcon expanded={miniMapExpanded === true} />
          </Button>
        )}
        {props.children}
      </Controls>
      {miniMapExpanded === true && <RFMiniMap ariaLabel={t('miniMap')} className={styles.miniMap} pannable position="top-right" zoomable />}
    </>
  )
})
