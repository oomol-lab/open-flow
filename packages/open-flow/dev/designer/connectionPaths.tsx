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
    'Vertical connections use rounded turns; horizontal connections keep Bézier curves. Compare shared inputs, wide offsets and tight gaps. Select a source or edge and drag either endpoint to inspect the arrows.',
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

const forwardModel: FlowCanvasViewModel = {
  direction: 'vertical',
  viewport: { x: 45, y: 45, zoom: 1 },
  nodes: [
    { id: 'wide-source', title: 'Wide offset', position: { x: 520, y: 0 } },
    { id: 'wide-target', title: 'Destination', position: { x: 0, y: 160 } },
    { id: 'tight-source', title: 'Short approach', position: { x: 520, y: 340 } },
    { id: 'tight-target', title: 'Destination · tight gap', position: { x: 0, y: 440 } },
  ].map((node) => Object.assign(node, { kind: 'task' as const, reference: 'lab/task', inputs: [], outputs: [] })),
  edges: ['wide', 'tight'].map((id) => ({ id, source: `${id}-source`, sourceHandle: '$out', target: `${id}-target`, targetHandle: '$in' })),
}

const sharedInputModel: FlowCanvasViewModel = {
  direction: 'vertical',
  viewport: { x: 45, y: 45, zoom: 1 },
  nodes: [
    { id: 'left-source', title: 'Left source', position: { x: 0, y: 0 } },
    { id: 'right-source', title: 'Right source', position: { x: 520, y: 0 } },
    { id: 'shared-target', title: 'Shared input', position: { x: 260, y: 250 } },
  ].map((node) => Object.assign(node, { kind: 'task' as const, reference: 'lab/task', inputs: [], outputs: [] })),
  edges: ['left', 'right'].map((id) => ({ id, source: `${id}-source`, sourceHandle: '$out', target: 'shared-target', targetHandle: '$in' })),
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

const denseMultiLaneModel: FlowCanvasViewModel = {
  direction: 'vertical',
  viewport: { x: 60, y: 30, zoom: 0.55 },
  nodes: [
    { id: 'intake-a', title: 'Intake A', position: { x: 0, y: 0 } },
    { id: 'intake-b', title: 'Intake B', position: { x: 400, y: 0 } },
    { id: 'route-a', title: 'Route & normalize', position: { x: 180, y: 220 } },
    { id: 'blocker', title: 'Policy guard', position: { x: 560, y: 220 } },
    { id: 'enrich-a', title: 'Enrich left', position: { x: 0, y: 440 } },
    { id: 'enrich-b', title: 'Enrich center', position: { x: 400, y: 440 } },
    { id: 'audit', title: 'Audit log', position: { x: 780, y: 440 } },
    { id: 'merge', title: 'Aggregate & output', position: { x: 380, y: 660 } },
  ].map((node) => Object.assign(node, { kind: 'task' as const, reference: 'lab/task', inputs: [], outputs: [] })),
  edges: [
    ['intake-a', 'route-a'],
    ['intake-b', 'route-a'],
    ['intake-b', 'blocker'],
    ['intake-a', 'enrich-a'],
    ['intake-a', 'enrich-b'],
    ['intake-b', 'audit'],
    ['route-a', 'enrich-b'],
    ['blocker', 'audit'],
    ['enrich-a', 'merge'],
    ['enrich-b', 'merge'],
    ['audit', 'merge'],
    ['merge', 'intake-b'],
  ].map(([source, target], index) => ({
    id: `dense-${index}-${source}-${target}`,
    source: source!,
    sourceHandle: '$out',
    target: target!,
    targetHandle: '$in',
  })),
}

const executedPathModel: FlowCanvasViewModel = {
  direction: 'vertical',
  viewport: { x: 80, y: 30, zoom: 0.78 },
  nodes: [
    {
      id: 'trigger',
      kind: 'trigger',
      title: 'Manual trigger',
      position: { x: 240, y: 0 },
      inputs: [],
      outputs: [{ handle: 'input' }],
      presentation: { kind: 'manual', schedules: [] },
      run: { runId: 'run-demo', startedAt: '2026-11-24T06:00:00Z', status: 'success' },
    },
    {
      id: 'fetch',
      kind: 'task',
      reference: 'lab/fetch',
      title: 'Fetch records',
      position: { x: 240, y: 180 },
      inputs: [{ handle: 'input' }],
      outputs: [{ handle: 'records' }],
      run: {
        runId: 'run-demo',
        startedAt: '2026-11-24T06:00:01Z',
        finishedAt: '2026-11-24T06:00:02Z',
        status: 'success',
        outputs: { records: 12 },
      },
    },
    {
      id: 'branch',
      kind: 'condition',
      title: 'Check records',
      position: { x: 240, y: 370 },
      matchMode: 'first',
      defaultOutput: 'otherwise',
      cases: [
        {
          output: 'matched',
          groups: [{ expressions: [{ left: { kind: 'node', label: 'Fetch records' }, operator: 'is not empty' }] }],
        },
      ],
      inputs: [{ handle: 'records' }],
      outputs: [{ handle: 'matched' }, { handle: 'otherwise' }],
      run: {
        runId: 'run-demo',
        startedAt: '2026-11-24T06:00:02Z',
        finishedAt: '2026-11-24T06:00:02.100Z',
        status: 'success',
        releasedHandles: ['matched'],
      },
    },
    {
      id: 'deliver',
      kind: 'task',
      reference: 'lab/deliver',
      title: 'Deliver payload',
      position: { x: 40, y: 600 },
      inputs: [{ handle: 'payload' }],
      outputs: [],
      run: {
        runId: 'run-demo',
        startedAt: '2026-11-24T06:00:03Z',
        finishedAt: '2026-11-24T06:00:04Z',
        status: 'error',
        error: { message: 'Upstream rejected the request.' },
      },
    },
    {
      id: 'fallback',
      kind: 'task',
      reference: 'lab/fallback',
      title: 'Fallback notify',
      position: { x: 440, y: 600 },
      inputs: [{ handle: 'reason' }],
      outputs: [],
    },
  ],
  edges: [
    { id: 'e-trigger-fetch', source: 'trigger', sourceHandle: '$out', target: 'fetch', targetHandle: '$in' },
    { id: 'e-fetch-branch', source: 'fetch', sourceHandle: '$out', target: 'branch', targetHandle: '$in' },
    { id: 'e-branch-deliver', source: 'branch', sourceHandle: '$branch:matched', target: 'deliver', targetHandle: '$in' },
    { id: 'e-branch-fallback', source: 'branch', sourceHandle: '$branch:otherwise', target: 'fallback', targetHandle: '$in' },
  ],
}

const connectionSamples = [
  { label: 'Executed path', model: executedPathModel },
  { label: 'Shared input', model: sharedInputModel },
  { label: 'Forward connections', model: forwardModel },
  { label: 'Dense multi-lane', model: denseMultiLaneModel },
  { label: 'Aligned returns', model: alignedModel },
  { label: 'Mixed rows', model: mixedRowsModel },
  { label: 'Same row', model: sameRowModel },
  { label: 'Tight & overlapping', model: boundaryModel },
  { label: 'Backward & self', model: backwardModel },
]

function ConnectionSamples({ dark, language, log }: { dark: boolean; language: UiLanguage; log: LogAction }) {
  const [model, setModel] = useState(sharedInputModel)
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
        onChangeDirection={(direction, positions) => {
          setModel((current) => ({
            ...current,
            direction,
            nodes: current.nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
          }))
          return true
        }}
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
