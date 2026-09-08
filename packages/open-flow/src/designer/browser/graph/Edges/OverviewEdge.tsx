import styles from './OverviewEdge.module.scss'
import type { EdgeProps, EdgeTypes } from '@xyflow/react'
import type { OverviewRFEdge } from '../../stores/edge/overviewEdges.ts'

import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react'
import { clsx } from 'clsx'
import { useTranslate } from 'val-i18n-react'
import { ErrorCircle } from '../../components/errorCircle.tsx'
import { OVERVIEW_EDGE_TYPE } from '../../stores/edge/overviewEdges.ts'

export function OverviewEdge(props: EdgeProps<OverviewRFEdge>): React.ReactElement {
  const t = useTranslate()
  const [path, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: props.pathOptions?.curvature,
  })
  const data = props.data
  const errorTooltip =
    data && data.errorCount > 0 ? (
      <div>
        <div className={styles.tooltipSummary}>
          {t('edgeError.aggregateSummary', {
            connectionCount: data.connectionCount,
            errorCount: data.errorCount,
          })}
        </div>
        <div className={styles.tooltipErrors}>
          {data.errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      </div>
    ) : undefined

  return (
    <>
      <BaseEdge
        className={clsx(styles.edge, data?.dashed && styles.dashed, data?.nodeSelected && styles.nodeSelected)}
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        markerStart={props.markerStart}
        interactionWidth={0}
        pointerEvents="none"
      />
      {errorTooltip && (
        <EdgeLabelRenderer>
          <div
            className={styles.label}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX || 0}px, ${labelY || 0}px)`,
            }}
          >
            <ErrorCircle message={errorTooltip} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export const OVERVIEW_EDGE_TYPES: EdgeTypes = {
  [OVERVIEW_EDGE_TYPE]: OverviewEdge,
}
