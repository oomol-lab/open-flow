import type { FlowCanvasViewModel } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { Position } from '@xyflow/react'
import { useState } from 'react'
import { getConnectionPath } from '../../src/canvas/browser/graph/Edges/connectionPath.ts'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { useStoryActions } from './storyActions.tsx'

export const connectionPathsStory: FrontendStory = {
  group: 'Theme Preview',
  id: 'connection-paths',
  title: 'Connection paths',
  description:
    'Backward, self, forward and reciprocal connections in both diagonal layouts. Drag or collapse cards to inspect routing; port-distance samples follow below.',
  standalone: true,
  render: (log, dark, language) => (
    <>
      <BackwardConnections log={log} dark={dark} language={language} />
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
                        getConnectionPath({
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
    </>
  ),
}

const backwardModel: FlowCanvasViewModel = {
  viewport: { x: 50, y: 30, zoom: 0.55 },
  nodes: [
    {
      id: 'self',
      kind: 'wait',
      title: 'Self connection',
      position: { x: 600, y: 0 },
      inputs: [],
      outputs: [{ handle: 'notification' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'left',
      kind: 'wait',
      title: 'Return target',
      position: { x: 0, y: 680 },
      inputs: [],
      outputs: [{ handle: 'notification' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'right',
      kind: 'wait',
      title: 'Return source',
      description: 'Review the result before continuing.',
      position: { x: 550, y: 580 },
      inputs: [],
      outputs: [{ handle: 'notification' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'upper',
      kind: 'wait',
      title: 'Upper · reciprocal',
      position: { x: 1220, y: 0 },
      inputs: [],
      outputs: [{ handle: 'notification' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'lower',
      kind: 'wait',
      title: 'Lower · reciprocal',
      description: 'Expand or move this card to inspect the gap.',
      position: { x: 1040, y: 340 },
      inputs: [],
      outputs: [{ handle: 'notification' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'upper-left',
      kind: 'wait',
      title: 'Upper left · narrow gap',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [{ handle: 'notification' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'lower-right',
      kind: 'wait',
      title: 'Lower right · narrow gap',
      position: { x: 180, y: 220 },
      inputs: [],
      outputs: [{ handle: 'notification' }, { handle: 'approve' }, { handle: 'reject' }],
    },
  ],
  edges: [
    { id: 'narrow-down', source: 'upper-left', sourceHandle: '$branch:notification', target: 'lower-right', targetHandle: '$in' },
    { id: 'narrow-up', source: 'lower-right', sourceHandle: '$branch:notification', target: 'upper-left', targetHandle: '$in' },
    { id: 'down', source: 'upper', sourceHandle: '$branch:notification', target: 'lower', targetHandle: '$in' },
    { id: 'up', source: 'lower', sourceHandle: '$branch:notification', target: 'upper', targetHandle: '$in' },
    { id: 'self-notification', source: 'self', sourceHandle: '$branch:notification', target: 'self', targetHandle: '$in' },
    { id: 'self', source: 'self', sourceHandle: '$branch:approve', target: 'self', targetHandle: '$in' },
    { id: 'self-reject', source: 'self', sourceHandle: '$branch:reject', target: 'self', targetHandle: '$in' },
    { id: 'forward', source: 'left', sourceHandle: '$branch:approve', target: 'right', targetHandle: '$in' },
    { id: 'backward', source: 'right', sourceHandle: '$branch:approve', target: 'left', targetHandle: '$in' },
  ],
}

function BackwardConnections({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [model, setModel] = useState(backwardModel)
  const [selected, setSelected] = useState<readonly string[]>([])
  useStoryActions([
    {
      label: 'Reset samples',
      onClick: () => {
        setModel(backwardModel)
        setSelected([])
      },
    },
  ])
  return (
    <div style={{ height: 850 }}>
      <FlowCanvasView
        identity="lab:connection-paths"
        model={model}
        dark={dark}
        language={language}
        editable
        autoLayout={false}
        layoutMotion={false}
        ignoredNodeIds={[]}
        selectedNodeIds={selected}
        onSelectionChange={setSelected}
        onMoveNodes={(positions) =>
          setModel((current) => ({ ...current, nodes: current.nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })) }))
        }
        onMoveViewport={(viewport) => setModel((current) => ({ ...current, viewport }))}
        onChangeNodeContentHidden={(id, contentHidden) =>
          setModel((current) => ({ ...current, nodes: current.nodes.map((node) => (node.id === id ? { ...node, contentHidden } : node)) }))
        }
        onConnect={(edge) => setModel((current) => ({ ...current, edges: [...current.edges, { ...edge, id: `edge-${current.edges.length}` }] }))}
        onDisconnect={(edge) => setModel((current) => ({ ...current, edges: current.edges.filter((item) => item.id !== edge.id) }))}
        onAddNode={() => undefined}
        onDeleteNodes={(ids) => log('node.delete', ids)}
        onDuplicate={(ids) => log('node.duplicate', ids)}
        onCopy={(ids) => log('node.copy', ids)}
        onPaste={() => undefined}
        onIgnoreNodes={() => undefined}
      />
    </div>
  )
}
