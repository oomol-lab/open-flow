import styles from './NodeLayout.module.scss'
import type { CanvasStore } from '../../../stores/canvas/canvas.store.ts'
import type { NodeStore } from '../../../stores/node/node.store.ts'
import type { FlowCanvasViewPosition } from '../../FlowCanvas/model.ts'
import type { NodeResizeChange } from './NodeResizeHandle.tsx'

import { useRef, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { NodeResizeHandle } from './NodeResizeHandle.tsx'

export function ConditionWidthControls({
  canvasStore,
  nodeStore,
  minimum,
  width,
  onPreview,
}: {
  readonly canvasStore: CanvasStore
  readonly nodeStore: NodeStore
  readonly minimum: number
  readonly width: number
  readonly onPreview: (width: number | undefined) => void
}) {
  const t = useTranslate()
  const origin = useRef<FlowCanvasViewPosition>()
  const [saving, setSaving] = useState(false)
  const start = () => {
    origin.current = nodeStore.$.position.value
  }
  const cancel = () => {
    if (origin.current) nodeStore.$$.position.set(origin.current)
    origin.current = undefined
    onPreview(undefined)
  }
  const preview = (change: NodeResizeChange) => {
    if (!origin.current) return
    onPreview(change.width)
    nodeStore.$$.position.set({ x: origin.current.x + change.offsetX, y: origin.current.y })
  }
  const commit = async (change: NodeResizeChange) => {
    const previousPosition = origin.current
    origin.current = undefined
    setSaving(true)
    const position = change.offsetX === 0 ? undefined : nodeStore.$.position.value
    try {
      if (!(await canvasStore.changeNodeWidth(nodeStore.nodeId, change.width, position)) && previousPosition) nodeStore.$$.position.set(previousPosition)
    } finally {
      onPreview(undefined)
      setSaving(false)
    }
  }
  return (['left', 'right'] as const).map((side) => (
    <NodeResizeHandle
      key={side}
      className={`${styles.widthResize} ${side === 'left' ? styles.widthResizeLeft : styles.widthResizeRight}`}
      label={t(side === 'left' ? 'nodeWidth.resizeLeft' : 'nodeWidth.resizeRight')}
      position={side}
      showTooltip={false}
      size={{ width, height: 0 }}
      minimum={{ width: minimum, height: 0 }}
      disabled={saving}
      onStart={start}
      onResize={preview}
      onCommit={(change) => void commit(change)}
      onCancel={cancel}
      onReset={() => void canvasStore.changeNodeWidth(nodeStore.nodeId, undefined)}
    />
  ))
}
