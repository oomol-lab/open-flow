interface EdgeGradientProps {
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourceColor: string
  targetColor: string
}

export function EdgeGradient({ id, sourceX, sourceY, targetX, targetY, sourceColor, targetColor }: EdgeGradientProps): React.ReactElement {
  return (
    <defs>
      <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
        <stop offset="0%" stopColor={sourceColor} />
        <stop offset="100%" stopColor={targetColor} />
      </linearGradient>
    </defs>
  )
}
