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
    'Each connection uses only its own endpoints. Drag an upper or lower source: only its line changes. Return turns mirror within a fixed band above the destination when space allows.',
  standalone: true,
  render: (log, dark, language) => (
    <>
      <ConnectionSamples log={log} dark={dark} language={language} />
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

const alignedModel: FlowCanvasViewModel = {
  viewport: { x: 110, y: 30, zoom: 0.55 },
  nodes: [
    ...[0, 240, 480].map((y, index) => ({
      id: `aligned-${index}`,
      kind: 'wait' as const,
      title: ['Long return', 'Medium return', 'Short return'][index]!,
      position: { x: 550, y },
      inputs: [],
      outputs: [{ handle: 'pending' }],
    })),
    { id: 'destination', kind: 'wait', title: 'Shared destination', position: { x: 0, y: 1000 }, inputs: [], outputs: [{ handle: 'pending' }] },
  ],
  edges: [0, 1, 2].map((index) => ({
    id: `aligned-return-${index}`,
    source: `aligned-${index}`,
    sourceHandle: '$branch:pending',
    target: 'destination',
    targetHandle: '$in',
  })),
}

const boundaryModel: FlowCanvasViewModel = {
  viewport: { x: 130, y: 40, zoom: 0.75 },
  nodes: [
    { id: 'tight-source', kind: 'wait', title: 'Tight vertical gap', position: { x: 550, y: 0 }, inputs: [], outputs: [{ handle: 'pending' }] },
    { id: 'tight-target', kind: 'wait', title: 'Destination · narrow gap', position: { x: 0, y: 145 }, inputs: [], outputs: [{ handle: 'pending' }] },
    { id: 'overlap-source', kind: 'wait', title: 'Overlapping rows', position: { x: 550, y: 420 }, inputs: [], outputs: [{ handle: 'pending' }] },
    { id: 'overlap-target', kind: 'wait', title: 'Destination · overlapping', position: { x: 0, y: 480 }, inputs: [], outputs: [{ handle: 'pending' }] },
  ],
  edges: [
    { id: 'tight-return', source: 'tight-source', sourceHandle: '$branch:pending', target: 'tight-target', targetHandle: '$in' },
    { id: 'overlap-return', source: 'overlap-source', sourceHandle: '$branch:pending', target: 'overlap-target', targetHandle: '$in' },
  ],
}

const mixedRowsModel: FlowCanvasViewModel = {
  viewport: { x: 110, y: 30, zoom: 0.55 },
  nodes: [
    { id: 'far', kind: 'wait', title: 'Upper · long return', position: { x: 550, y: 0 }, inputs: [], outputs: [{ handle: 'pending' }] },
    { id: 'middle', kind: 'wait', title: 'Upper · medium return', position: { x: 550, y: 240 }, inputs: [], outputs: [{ handle: 'pending' }] },
    { id: 'lower', kind: 'wait', title: 'Lower return · drag independently', position: { x: 550, y: 900 }, inputs: [], outputs: [{ handle: 'pending' }] },
    { id: 'destination', kind: 'wait', title: 'Shared destination', position: { x: 0, y: 800 }, inputs: [], outputs: [{ handle: 'pending' }] },
  ],
  edges: ['far', 'middle', 'lower'].map((source) => ({
    id: `${source}-return`,
    source,
    sourceHandle: '$branch:pending',
    target: 'destination',
    targetHandle: '$in',
  })),
}

const sameRowModel: FlowCanvasViewModel = {
  viewport: { x: 100, y: 80, zoom: 0.6 },
  nodes: [
    { id: 'near', kind: 'wait', title: 'Near return', position: { x: 400, y: 0 }, inputs: [], outputs: [{ handle: 'pending' }] },
    { id: 'far', kind: 'wait', title: 'Far return', position: { x: 800, y: 0 }, inputs: [], outputs: [{ handle: 'pending' }] },
    { id: 'destination', kind: 'wait', title: 'Shared destination', position: { x: 0, y: 80 }, inputs: [], outputs: [{ handle: 'pending' }] },
  ],
  edges: ['near', 'far'].map((source) => ({ id: `${source}-return`, source, sourceHandle: '$branch:pending', target: 'destination', targetHandle: '$in' })),
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
      outputs: [{ handle: 'pending' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'left',
      kind: 'wait',
      title: 'Return target',
      position: { x: 0, y: 680 },
      inputs: [],
      outputs: [{ handle: 'pending' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'right',
      kind: 'wait',
      title: 'Return source',
      description: 'Review the result before continuing.',
      position: { x: 550, y: 580 },
      inputs: [],
      outputs: [{ handle: 'pending' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'upper',
      kind: 'wait',
      title: 'Upper · reciprocal',
      position: { x: 1220, y: 0 },
      inputs: [],
      outputs: [{ handle: 'pending' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'lower',
      kind: 'wait',
      title: 'Lower · reciprocal',
      description: 'Expand or move this card to inspect the gap.',
      position: { x: 1040, y: 340 },
      inputs: [],
      outputs: [{ handle: 'pending' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'upper-left',
      kind: 'wait',
      title: 'Upper left · narrow gap',
      position: { x: 0, y: 0 },
      inputs: [],
      outputs: [{ handle: 'pending' }, { handle: 'approve' }, { handle: 'reject' }],
    },
    {
      id: 'lower-right',
      kind: 'wait',
      title: 'Lower right · narrow gap',
      position: { x: 180, y: 220 },
      inputs: [],
      outputs: [{ handle: 'pending' }, { handle: 'approve' }, { handle: 'reject' }],
    },
  ],
  edges: [
    { id: 'narrow-down', source: 'upper-left', sourceHandle: '$branch:pending', target: 'lower-right', targetHandle: '$in' },
    { id: 'narrow-up', source: 'lower-right', sourceHandle: '$branch:pending', target: 'upper-left', targetHandle: '$in' },
    { id: 'down', source: 'upper', sourceHandle: '$branch:pending', target: 'lower', targetHandle: '$in' },
    { id: 'up', source: 'lower', sourceHandle: '$branch:pending', target: 'upper', targetHandle: '$in' },
    { id: 'self-pending', source: 'self', sourceHandle: '$branch:pending', target: 'self', targetHandle: '$in' },
    { id: 'self', source: 'self', sourceHandle: '$branch:approve', target: 'self', targetHandle: '$in' },
    { id: 'self-reject', source: 'self', sourceHandle: '$branch:reject', target: 'self', targetHandle: '$in' },
    { id: 'forward', source: 'left', sourceHandle: '$branch:approve', target: 'right', targetHandle: '$in' },
    { id: 'backward', source: 'right', sourceHandle: '$branch:approve', target: 'left', targetHandle: '$in' },
  ],
}

const connectionSamples = [
  { label: 'Aligned returns', model: alignedModel },
  { label: 'Mixed rows', model: mixedRowsModel },
  { label: 'Same row', model: sameRowModel },
  { label: 'Tight & overlapping', model: boundaryModel },
  { label: 'Backward & self', model: backwardModel },
]

function ConnectionSamples({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [model, setModel] = useState(alignedModel)
  const [selected, setSelected] = useState<readonly string[]>([])
  useStoryActions(
    connectionSamples.map(({ label, model: sample }) => ({
      label,
      onClick: () => {
        setModel(sample)
        setSelected([])
      },
    })),
  )
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
