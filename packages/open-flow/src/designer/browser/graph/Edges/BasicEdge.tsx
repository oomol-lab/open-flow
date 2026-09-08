import styles from './BasicEdge.module.scss'
import type { EdgeProps } from '@xyflow/react'
import type { RFEdge } from '../../base/rfHelpers.ts'

import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import { useMemo } from 'react'
import { useVal } from 'use-value-enhancer'
import { ErrorCircle } from '../../components/errorCircle.tsx'
import { gradientToStroke } from '../../stores/edge/colors.ts'
import { DEFAULT_HANDLE_KIND } from '../../stores/nodeHandle/handleKind.ts'
import { useDesignerStore } from '../DesignerStoreContext.tsx'

export function BasicEdge(props: EdgeProps<RFEdge>): React.ReactElement {
  const edgeStore = props.data?.store
  const error = useVal(edgeStore?.$.error)
  const designerStore = useDesignerStore()
  const scale = useVal(designerStore.$.scale)

  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: props.pathOptions?.curvature,
  })

  const selected = useVal(edgeStore?.$.selected)
  const nodeSelected = useVal(edgeStore?.$.nodeSelected)
  const sourceGradientColor = useVal(edgeStore?.$.sourceGradientColor) || DEFAULT_HANDLE_KIND
  const targetGradientColor = useVal(edgeStore?.$.targetGradientColor) || DEFAULT_HANDLE_KIND
  const connectionMeta = useVal(edgeStore?.$.connectionMeta)

  const inverse = props.sourceX > props.targetX
  const strokeWidth = selected || nodeSelected ? 4 : 2

  const style = useMemo<React.CSSProperties>(
    () => ({
      stroke: connectionMeta?.muted ? undefined : gradientToStroke(sourceGradientColor, targetGradientColor, inverse),
      strokeDasharray: connectionMeta?.dashed ? '5,5' : undefined,
      strokeWidth,
    }),
    [strokeWidth, sourceGradientColor, targetGradientColor, inverse, connectionMeta],
  )

  const adjustedScale = scale > 2 ? scale * 0.8 : scale > 1 ? scale : 1

  return (
    <>
      {selected && (
        <BaseEdge
          id={props.id + '-selected'}
          path={path}
          style={{
            ...style,
            strokeWidth: strokeWidth + 2,
            stroke: 'var(--highlight-indicate-color)',
            pointerEvents: 'none',
          }}
          markerEnd={props.markerEnd}
          markerStart={props.markerStart}
          interactionWidth={props.interactionWidth}
        />
      )}
      <BaseEdge id={props.id} path={path} style={style} markerEnd={props.markerEnd} markerStart={props.markerStart} interactionWidth={props.interactionWidth} />
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
