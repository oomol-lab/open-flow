import styles from './BasicEdge.module.scss'
import type { EdgeProps, Rect } from '@xyflow/react'
import type { RFEdge } from '../../base/rfHelpers.ts'

import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Position, useInternalNode } from '@xyflow/react'
import { useId, useMemo } from 'react'
import { useVal } from 'use-value-enhancer'
import { ErrorCircle } from '../../components/errorCircle.tsx'
import { DEFAULT_HANDLE_KIND } from '../../components/handleKind.ts'
import { gradientToStroke } from '../../stores/edge/colors.ts'
import { useDesignerStore } from '../DesignerStoreContext.tsx'
import { EDGE_GAP, getTurnY } from './route.ts'

export function BasicEdge(props: EdgeProps<RFEdge>): React.ReactElement {
  const arrowId = useId().replaceAll(':', '')
  const edgeStore = props.data?.store
  const error = useVal(edgeStore?.$.error)
  const designerStore = useDesignerStore()
  const scale = useVal(designerStore.$.scale)
  const sourceNode = useInternalNode(props.source)
  const targetNode = useInternalNode(props.target)

  // Leave space between the arrow tip and the target port in every direction.
  const gap = 3
  const targetX = props.targetX + (props.targetPosition == Position.Left ? -gap : props.targetPosition == Position.Right ? gap : 0)
  const targetY = props.targetY + (props.targetPosition == Position.Top ? -gap : props.targetPosition == Position.Bottom ? gap : 0)
  const sourceRect: Rect | undefined = sourceNode && {
    ...sourceNode.internals.positionAbsolute,
    width: sourceNode.measured.width ?? 0,
    height: sourceNode.measured.height ?? 0,
  }
  const targetRect: Rect | undefined = targetNode && {
    ...targetNode.internals.positionAbsolute,
    width: targetNode.measured.width ?? 0,
    height: targetNode.measured.height ?? 0,
  }

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX,
    targetY,
    targetPosition: props.targetPosition,
    borderRadius: 20,
    centerY: getTurnY(props, sourceRect, targetRect),
    offset: EDGE_GAP,
  })

  const selected = useVal(edgeStore?.$.selected)
  const nodeSelected = useVal(edgeStore?.$.nodeSelected)
  const sourceGradientColor = useVal(edgeStore?.$.sourceGradientColor) || DEFAULT_HANDLE_KIND
  const targetGradientColor = useVal(edgeStore?.$.targetGradientColor) || DEFAULT_HANDLE_KIND
  const connectionMeta = useVal(edgeStore?.$.connectionMeta)

  const inverse = props.sourceX > props.targetX
  const emphasized = selected || nodeSelected
  const strokeWidth = emphasized ? 2.5 : 1.5
  const stroke = selected ? 'var(--edge-selected)' : connectionMeta?.muted ? undefined : gradientToStroke(sourceGradientColor, targetGradientColor, inverse)

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
            stroke={selected ? 'var(--edge-selected)' : 'var(--edge-primitive)'}
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
