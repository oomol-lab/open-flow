import type { FrontendStory } from './stories.tsx'

import { getBezierPath, Position } from '@xyflow/react'

export const connectionPathsStory: FrontendStory = {
  group: 'Theme Preview',
  id: 'connection-paths',
  title: 'Connection paths',
  description: 'Bézier connection paths at short and long distances, in each port direction. Dots mark the port and pointer.',
  standalone: true,
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))', gap: 16, padding: 24 }}>
      {[Position.Right, Position.Left, Position.Bottom, Position.Top].map((position) => (
        <section key={position}>
          <h3>{position}</h3>
          {[0, 4, 16, 32, 64, 100, -32].map((distance) => {
            const horizontal = position === Position.Left || position === Position.Right
            const sign = position === Position.Left || position === Position.Top ? -1 : 1
            const fromX = 80
            const fromY = 70
            const toX = fromX + (horizontal ? distance * sign : 8)
            const toY = fromY + (horizontal ? 8 : distance * sign)
            return (
              <div key={distance}>
                <span>{distance} px</span>
                <svg viewBox="-30 -40 240 240" style={{ width: '100%', height: 150 }}>
                  <path
                    d={
                      getBezierPath({
                        sourceX: fromX,
                        sourceY: fromY,
                        sourcePosition: position,
                        targetX: toX,
                        targetY: toY,
                        targetPosition: horizontal ? (sign > 0 ? Position.Left : Position.Right) : sign > 0 ? Position.Top : Position.Bottom,
                      })[0]
                    }
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  />
                  <circle cx={fromX} cy={fromY} r={3} fill="#888" />
                  <circle cx={toX} cy={toY} r={3} fill="#38a" />
                </svg>
              </div>
            )
          })}
        </section>
      ))}
    </div>
  ),
}
