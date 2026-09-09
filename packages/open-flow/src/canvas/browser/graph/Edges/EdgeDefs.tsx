import { useMemo } from 'react'
import { allPossibleEdgeGradients, edgeColors, gradientId } from '../../stores/edge/colors.ts'

/** Renders edge gradient definitions at the Designer root. */
export function EdgeDefs(): React.ReactElement {
  const gradients = useMemo(allPossibleEdgeGradients, [])

  const invisible: React.CSSProperties = {
    position: 'absolute',
    zIndex: -1,
    opacity: 0,
    pointerEvents: 'none',
  }

  return (
    <svg width={0} height={0} style={invisible}>
      <defs>
        {gradients.map((g, i) => (
          <linearGradient key={i} id={gradientId(g[0], g[1])}>
            <stop offset="35%" style={{ stopColor: edgeColors[g[0]] }} />
            <stop offset="65%" style={{ stopColor: edgeColors[g[1]] }} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  )
}
