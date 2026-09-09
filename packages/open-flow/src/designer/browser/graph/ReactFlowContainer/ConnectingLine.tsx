import type { ConnectionLineComponentProps } from '@xyflow/react'
import type { RFHandleName, RFNodeId } from '../../base/rfHelpers.ts'
import type { HandleKind } from '../../components/handle.tsx'

import { getSmoothStepPath } from '@xyflow/react'
import { useMemo } from 'react'
import { toManifestHandleName, toManifestNodeId } from '../../base/rfHelpers.ts'
import { getHandleKind } from '../../components/handleKind.ts'
import { gradientToStroke } from '../../stores/edge/colors.ts'
import { useDesignerStore } from '../DesignerStoreContext.tsx'
import { portSchema } from '../FlowDesigner/nodeContent.ts'

export const ConnectionLine: React.FC<ConnectionLineComponentProps> = ({
  fromX,
  fromY,
  fromPosition,
  fromNode: rfStartNode,
  fromHandle: rfStartHandle,
  toX,
  toY,
  toPosition,
  toNode: rfEndNode,
  toHandle: rfEndHandle,
  connectionLineStyle,
}: ConnectionLineComponentProps) => {
  const designerStore = useDesignerStore()

  const [edgePath] = getSmoothStepPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    borderRadius: 20,
    offset: 32,
  })

  const isStartOutputHandle = rfStartHandle?.type !== 'target'
  const rfFromNode = isStartOutputHandle ? rfStartNode : rfEndNode
  const rfFromHandle = isStartOutputHandle ? rfStartHandle : rfEndHandle
  const rfToNode = isStartOutputHandle ? rfEndNode : rfStartNode
  const rfToHandle = isStartOutputHandle ? rfEndHandle : rfStartHandle

  const fromColor: HandleKind | undefined = useMemo(() => {
    if (!rfFromNode?.id || !rfFromHandle?.id) return

    const nodeId = toManifestNodeId(rfFromNode.id as RFNodeId)
    const handleName = toManifestHandleName(rfFromHandle.id as RFHandleName)

    const nodeStore = designerStore.$.nodes.get(nodeId)

    const handleKind = getHandleKind(portSchema(nodeStore?.content$.value, 'output', handleName))

    return handleKind
  }, [designerStore, rfFromNode?.id, rfFromHandle?.id])

  const toColor: HandleKind | undefined = useMemo(() => {
    if (!rfToNode?.id || !rfToHandle?.id) return

    const nodeId = toManifestNodeId(rfToNode.id as RFNodeId)
    const toRFHandle = rfToHandle.id as RFHandleName
    const handleName = toManifestHandleName(toRFHandle)

    const nodeStore = designerStore.$.nodes.get(nodeId)

    const handleKind = getHandleKind(portSchema(nodeStore?.content$.value, 'input', handleName))

    return handleKind
  }, [designerStore, rfToNode?.id, rfToHandle?.id])

  const inverse = isStartOutputHandle ? fromX > toX : fromX < toX
  const gradientColor = useMemo(() => {
    return gradientToStroke(fromColor || toColor || 'primitive', toColor || fromColor || 'primitive', inverse)
  }, [fromColor, toColor, inverse])

  return <path style={connectionLineStyle} fill="none" opacity={0.75} stroke={gradientColor} strokeWidth={2} d={edgePath} />
}
