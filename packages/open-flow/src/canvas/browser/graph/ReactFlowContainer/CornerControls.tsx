import styles from './CornerControls.module.scss'

import { Controls, Panel } from '@xyflow/react'
import { memo } from 'react'
import { cn } from '../../../../ui/browser/utils.ts'

export interface CornerControlsProps {
  before?: React.ReactNode
  children?: React.ReactNode
}

export const CornerControls: React.FC<CornerControlsProps> = /* @__PURE__ */ memo(function (props: CornerControlsProps) {
  if (props.before == null && props.children == null) return null

  return (
    <>
      <Panel className={styles.group} data-canvas-control-scope position="top-right">
        {props.before}
        {props.children != null && (
          <Controls
            className={cn('open-flow-control-island open-flow-control-island-compact open-flow-control-island-soft-shadow', styles.corner)}
            orientation="horizontal"
            position="top-right"
            showFitView={false}
            showInteractive={false}
            showZoom={false}
          >
            {props.children}
          </Controls>
        )}
      </Panel>
    </>
  )
})
