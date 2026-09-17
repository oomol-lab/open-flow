import styles from './BasicEdge.module.scss'
import type { EdgeProps } from '@xyflow/react'
import type { RFEdge } from '../../base/rfHelpers.ts'

import { BaseEdge, EdgeLabelRenderer, Position, useInternalNode } from '@xyflow/react'
import { useId, useMemo } from 'react'
import { useVal } from 'use-value-enhancer'
import { ErrorCircle } from '../../components/errorCircle.tsx'
import { useCanvasStore } from '../CanvasStoreContext.tsx'
import { connectionNodeBounds, connectionPortIndex, getConnectionPath } from './connectionPath.ts'
import { EdgeGradient } from './EdgeGradient.tsx'

export function BasicEdge(props: EdgeProps<RFEdge>): React.ReactElement {
  const arrowId = useId().replaceAll(':', '')
  const edgeStore = props.data?.store
  const error = useVal(edgeStore?.$.error)
  const canvasStore = useCanvasStore()
  const scale = useVal(canvasStore.$.scale)

  // Leave space between the arrow tip and the target port in every direction.
  const gap = 3
  const targetX = props.targetX + (props.targetPosition == Position.Left ? -gap : props.targetPosition == Position.Right ? gap : 0)
  const targetY = props.targetY + (props.targetPosition == Position.Top ? -gap : props.targetPosition == Position.Bottom ? gap : 0)

  const sourceNode = useInternalNode(props.source)
  const targetNode = useInternalNode(props.target)
  const [path, labelX, labelY] = getConnectionPath({
    sourceBounds: connectionNodeBounds(sourceNode),
    sourcePortIndex: connectionPortIndex(sourceNode, props.sourceHandleId),
    targetPortIndex: connectionPortIndex(targetNode, props.targetHandleId),
    targetBounds: connectionNodeBounds(targetNode),
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX,
    targetY,
    targetPosition: props.targetPosition,
  })

  const selected = useVal(edgeStore?.$.selected)
  const nodeSelected = useVal(edgeStore?.$.nodeSelected)
  const sourceGradientColor = useVal(edgeStore?.$.sourceGradientColor) || 'var(--edge-primitive)'
  const targetGradientColor = useVal(edgeStore?.$.targetGradientColor) || 'var(--edge-primitive)'
  const connectionMeta = useVal(edgeStore?.$.connectionMeta)

  const emphasized = selected || nodeSelected
  const strokeWidth = emphasized ? 2.5 : 1.5
  const gradientId = `${arrowId}-gradient`
  const stroke = selected ? 'var(--edge-selected)' : connectionMeta?.muted ? undefined : `url(#${gradientId})`

  const style = useMemo<React.CSSProperties>(
    () => ({
      stroke,
      strokeDasharray: connectionMeta?.dashed ? '5,5' : undefined,
      strokeWidth,
    }),
    [stroke, strokeWidth, connectionMeta?.dashed],
  )

  const adjustedScale = scale > 2 ? scale * 0.8 : scale > 1 ? scale : 1

  return (
    <>
      <EdgeGradient
        id={gradientId}
        sourceX={props.sourceX}
        sourceY={props.sourceY}
        targetX={targetX}
        targetY={targetY}
        sourceColor={sourceGradientColor}
        targetColor={targetGradientColor}
      />
      <defs>
        <marker
          id={arrowId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="10.5"
          markerHeight="10.5"
          markerUnits="userSpaceOnUse"
          orient="auto-start-reverse"
          overflow="visible"
        >
          <path
            d="M 1 1 L 9 5 L 1 9"
            fill="none"
            stroke={selected ? 'var(--edge-selected)' : connectionMeta?.muted ? 'var(--edge-primitive)' : targetGradientColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <BaseEdge
        id={props.id}
        path={path}
        style={style}
        markerEnd={props.markerEnd ?? `url(#${arrowId})`}
        markerStart={props.markerStart}
        interactionWidth={props.interactionWidth}
      />
      <EdgeLabelRenderer>
        <div
          className={styles.label}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX || 0}px, ${labelY || 0}px) scale(${adjustedScale})`,
          }}
        >
          {error && <ErrorCircle message={error} />}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
