import styles from './NodeOutline.module.scss'

import { memo } from 'react'
import { useVal } from 'use-value-enhancer'
import { useNodeMiniMapPhase } from '../../../components/minimap.tsx'
import { NodeMiniMapPhase } from '../../../stores/canvas/nodeMiniMap.ts'
import { useCanvasStore } from '../../CanvasStoreContext.tsx'
import { useNodeStore } from '../NodeStoreContext.tsx'
import { useShowNodeError } from './useShowNodeError.ts'

export const NodeOutline: React.FC = memo(function NodeOutline() {
  const canvasStore = useCanvasStore()
  const nodeStore = useNodeStore()
  const nodeMiniMapPhase = useNodeMiniMapPhase()
  const scale = useVal(canvasStore.$.scale)
  const selected = useVal(nodeStore.$.selected)
  const showError = useShowNodeError(nodeStore)
  const outlineWidth = nodeMiniMapPhase === NodeMiniMapPhase.None ? (selected ? 2 : 1) : scale

  const selectedOutlineColor: string | undefined = showError ? 'var(--edge-error)' : undefined

  return (
    <div
      style={{
        outlineWidth,
        ['--node-selected-border-color' as any]: selectedOutlineColor,
      }}
      className={styles.outline}
    />
  )
})
