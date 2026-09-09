import styles from './NodeMinimap.module.scss'

import { memo } from 'react'
import { useVal } from 'use-value-enhancer'
import { NODE_HANDLE_CLASSNAME } from '../../../base/canvas.ts'
import { useNodeMiniMapPhase } from '../../../components/minimap.tsx'
import { NodeMiniMapPhase } from '../../../stores/canvas/nodeMiniMap.ts'
import { useCanvasStore } from '../../CanvasStoreContext.tsx'

export const NodeMinimap: React.FC = /* @__PURE__ */ memo(function NodeMinimap() {
  const nodeMiniMapPhase = useNodeMiniMapPhase()

  if (nodeMiniMapPhase !== NodeMiniMapPhase.None) {
    return <NodeMimimapContent />
  } else {
    return null
  }
})

function NodeMimimapContent() {
  const canvasStore = useCanvasStore()

  const scale = useVal(canvasStore.$.scale)

  return <div style={{ ['--open-flow-canvas-scale' as any]: scale }} className={`${styles.wrapper} ${NODE_HANDLE_CLASSNAME}`}></div>
}
