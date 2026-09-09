import type { FlowCanvasViewModel } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useState } from 'react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { useIgnoredNodes } from '../../src/canvas/browser/useIgnoredNodes.ts'

const longInput = 'customer_lifetime_value_across_all_completed_orders'
const longOutput = 'matched_customers_with_complete_enterprise_profiles'
const longFallback = 'customers_requiring_manual_profile_review'

const conditionModel: FlowCanvasViewModel = {
  edges: [],
  viewport: { x: 46, y: 72, zoom: 0.82 },
  nodes: [
    {
      id: 'empty',
      kind: 'condition',
      title: 'No conditions',
      position: { x: 0, y: 0 },
      inputs: [{ handle: 'value', jsonSchema: {}, value: null }],
      outputs: [],
      cases: [],
    },
    {
      id: 'single',
      kind: 'condition',
      title: 'One condition',
      position: { x: 380, y: 0 },
      inputs: [{ handle: 'count', jsonSchema: { type: 'number' }, value: 1 }],
      outputs: [{ handle: 'matched', jsonSchema: { type: 'number' } }],
      cases: [{ expressions: [{ input: 'count', operator: '>', value: 0 }], output: 'matched', relation: 'all' }],
    },
    {
      id: 'multiple',
      kind: 'condition',
      title: 'Multiple conditions',
      position: { x: 760, y: 0 },
      inputs: [{ handle: 'score', jsonSchema: { type: 'number' }, value: 75 }],
      outputs: [
        { handle: 'priority', jsonSchema: { type: 'number' } },
        { handle: 'qualified', jsonSchema: { type: 'number' } },
        { handle: 'review', jsonSchema: { type: 'number' } },
        { handle: 'fallback', jsonSchema: { type: 'number' } },
      ],
      cases: [
        { expressions: [{ input: 'score', operator: '>=', value: 90 }], output: 'priority', relation: 'all' },
        { expressions: [{ input: 'score', operator: '>=', value: 70 }], output: 'qualified', relation: 'all' },
        { expressions: [{ input: 'score', operator: '>=', value: 50 }], output: 'review', relation: 'all' },
      ],
      defaultOutput: 'fallback',
    },
    {
      id: 'long-rule',
      kind: 'condition',
      title: 'Long rule text',
      position: { x: 0, y: 310 },
      inputs: [{ handle: longInput, jsonSchema: { type: 'number' }, value: 1000000 }],
      outputs: [
        { handle: 'matched', jsonSchema: { type: 'number' } },
        { handle: 'fallback', jsonSchema: { type: 'number' } },
      ],
      cases: [{ expressions: [{ input: longInput, operator: '>=', value: 1000000 }], output: 'matched', relation: 'all' }],
      defaultOutput: 'fallback',
    },
    {
      id: 'long-output',
      kind: 'condition',
      title: 'Long output text',
      position: { x: 380, y: 310 },
      inputs: [{ handle: 'status', jsonSchema: { type: 'string' }, value: 'ready' }],
      outputs: [
        { handle: longOutput, jsonSchema: { type: 'string' } },
        { handle: 'fallback', jsonSchema: { type: 'string' } },
      ],
      cases: [{ expressions: [{ input: 'status', operator: '==', value: 'ready' }], output: longOutput, relation: 'all' }],
      defaultOutput: 'fallback',
    },
    {
      id: 'long-both',
      kind: 'condition',
      title: 'Long rule and output text',
      position: { x: 760, y: 310 },
      inputs: [{ handle: longInput, jsonSchema: { type: 'number' }, value: 1000000 }],
      outputs: [
        { handle: longOutput, jsonSchema: { type: 'number' } },
        { handle: longFallback, jsonSchema: { type: 'number' } },
      ],
      cases: [{ expressions: [{ input: longInput, operator: '>=', value: 1000000 }], output: longOutput, relation: 'all' }],
      defaultOutput: longFallback,
    },
    {
      id: 'invalid-input',
      kind: 'condition',
      diagnostics: 1,
      title: 'Invalid input',
      position: { x: 0, y: 620 },
      inputs: [{ handle: 'count', jsonSchema: { type: 'number' }, value: 'not-a-number' }],
      outputs: [{ handle: 'matched', jsonSchema: { type: 'number' } }],
      cases: [{ expressions: [{ input: 'count', operator: '>', value: 0 }], output: 'matched', relation: 'all' }],
    },
  ],
}

function ConditionStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes('condition')
  const [selected, setSelected] = useState<readonly string[]>([])
  return (
    <div className="workflow-story">
      <div className="overview-toolbar open-flow-workbench">
        <span>Condition nodes · empty, single, multiple, invalid input and overflowing branch labels.</span>
      </div>
      <div className="workflow-canvas">
        <FlowCanvasView
          ignoredNodeIds={ignoredNodeIds}
          onIgnoreNodes={onIgnoreNodes}
          identity="lab:node-cases:condition"
          autoLayout={false}
          dark={dark}
          language={language}
          layoutMotion={false}
          editable
          model={conditionModel}
          addItems={[]}
          selectedNodeIds={selected}
          onAddNode={() => undefined}
          onConnect={(edge) => log('edge.connect', edge)}
          onDisconnect={(edge) => log('edge.disconnect', edge)}
          onDeleteNodes={(ids) => log('node.delete', ids)}
          onDuplicate={(ids) => log('node.duplicate', ids)}
          onPaste={(position) => log('canvas.paste', position)}
          onMoveNodes={(positions) => log('node.move', positions)}
          onMoveViewport={(viewport) => log('canvas.move', viewport)}
          onSelectionChange={(ids, edge) => {
            setSelected(ids)
            log('selection.change', edge ?? ids)
          }}
        />
      </div>
    </div>
  )
}

export const nodeStories: readonly FrontendStory[] = [
  {
    group: 'Node Cases',
    id: 'node-condition',
    title: 'Condition',
    standalone: true,
    render: (log, dark, language) => <ConditionStory dark={dark} language={language} log={log} />,
  },
]
