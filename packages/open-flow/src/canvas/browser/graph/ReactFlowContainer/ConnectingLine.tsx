import type { ConnectionLineComponentProps } from '@xyflow/react'
import type { NodeId } from '../../../../schema/index.ts'
import type { RFNodeId } from '../../base/rfHelpers.ts'

import { useId } from 'react'
import { useVal } from 'use-value-enhancer'
import { toManifestNodeId } from '../../base/rfHelpers.ts'
import { useCanvasStore } from '../CanvasStoreContext.tsx'
import { connectionNodeBounds, connectionPortIndex, getConnectionPath } from '../Edges/connectionPath.ts'
import { EdgeGradient } from '../Edges/EdgeGradient.tsx'

export const ConnectionLine: React.FC<ConnectionLineComponentProps> = ({
  fromHandle,
  toHandle,
  fromX,
  fromY,
  fromPosition,
  fromNode: rfStartNode,
  toX,
  toY,
  toPosition,
  toNode: rfEndNode,
  connectionLineStyle,
}: ConnectionLineComponentProps) => {
  const canvasStore = useCanvasStore()

  const [edgePath] = getConnectionPath({
    sourceBounds: connectionNodeBounds(rfStartNode),
    sourcePortIndex: connectionPortIndex(rfStartNode, fromHandle.id),
    targetPortIndex: connectionPortIndex(rfEndNode, toHandle?.id),
    targetBounds: connectionNodeBounds(rfEndNode),
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  })

  const nodes = useVal(canvasStore.$.nodes.$)
  const fromNode = nodes.get(rfStartNode ? toManifestNodeId(rfStartNode.id as RFNodeId) : ('' as NodeId))
  const toNode = nodes.get(rfEndNode ? toManifestNodeId(rfEndNode.id as RFNodeId) : ('' as NodeId))
  const fromColor = useVal(fromNode?.$.executionPortColor)
  const toColor = useVal(toNode?.$.executionPortColor)
  const gradientId = useId().replaceAll(':', '')

  return (
    <>
      <EdgeGradient
        id={gradientId}
        sourceX={fromX}
        sourceY={fromY}
        targetX={toX}
        targetY={toY}
        sourceColor={fromColor ?? toColor ?? 'var(--edge-primitive)'}
        targetColor={toColor ?? fromColor ?? 'var(--edge-primitive)'}
      />
      <path style={connectionLineStyle} fill="none" opacity={0.75} stroke={`url(#${gradientId})`} strokeWidth={2} d={edgePath} />
    </>
  )
}
