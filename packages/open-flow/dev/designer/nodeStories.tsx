import type { FlowCanvasViewModel } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useState } from 'react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { useIgnoredNodes } from '../../src/canvas/browser/useIgnoredNodes.ts'
import { useStoryActions } from './storyActions.tsx'

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
      cases: [
        {
          expressions: [{ input: 'count', operator: '>', value: 0 }],
          output: 'matched',
          relation: 'all',
        },
      ],
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
        {
          expressions: [{ input: 'score', operator: '>=', value: 90 }],
          output: 'priority',
          relation: 'all',
        },
        {
          expressions: [{ input: 'score', operator: '>=', value: 70 }],
          output: 'qualified',
          relation: 'all',
        },
        {
          expressions: [{ input: 'score', operator: '>=', value: 50 }],
          output: 'review',
          relation: 'all',
        },
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
      cases: [
        {
          expressions: [{ input: longInput, operator: '>=', value: 1000000 }],
          output: 'matched',
          relation: 'all',
        },
      ],
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
      cases: [
        {
          expressions: [{ input: 'status', operator: '==', value: 'ready' }],
          output: longOutput,
          relation: 'all',
        },
      ],
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
      cases: [
        {
          expressions: [{ input: longInput, operator: '>=', value: 1000000 }],
          output: longOutput,
          relation: 'all',
        },
      ],
      defaultOutput: longFallback,
    },
    {
      id: 'invalid-input',
      kind: 'condition',
      diagnostics: 1,
      title: 'Invalid input',
      position: { x: 0, y: 620 },
      inputs: [
        {
          handle: 'count',
          jsonSchema: { type: 'number' },
          value: 'not-a-number',
        },
      ],
      outputs: [{ handle: 'matched', jsonSchema: { type: 'number' } }],
      cases: [
        {
          expressions: [{ input: 'count', operator: '>', value: 0 }],
          output: 'matched',
          relation: 'all',
        },
      ],
    },
  ],
}

function ConditionStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes('condition')
  const [selected, setSelected] = useState<readonly string[]>([])
  return (
    <div className="workflow-story">
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

const commentModel: FlowCanvasViewModel = {
  edges: [],
  viewport: { x: 32, y: 60, zoom: 0.75 },
  nodes: [
    {
      id: 'notes',
      kind: 'comment',
      title: 'Review notes',
      position: { x: 0, y: 0 },
      content:
        '### Workflow palette\nInspect each step and its execution dependencies.\n\n- Select a node to inspect it.\n- Edit its configuration in the sidebar.\n- Review the output before continuing.',
    },
    {
      id: 'long',
      kind: 'comment',
      title: 'A longer comment title with review context',
      position: { x: 400, y: 0 },
      content:
        '### Release checklist\n\n- [x] Review inputs\n- [ ] Verify output\n\nUse `report.total` for the final count.\n\n```json\n{ "status": "ready", "count": 128 }\n```\n\n[Review documentation](https://example.com)',
    },
    {
      id: 'empty',
      kind: 'comment',
      title: 'Empty note',
      position: { x: 0, y: 380 },
      content: '',
    },
    {
      id: 'formatting',
      kind: 'comment',
      title: 'Markdown formatting',
      position: { x: 800, y: 0 },
      content:
        '# Heading one\n\n## Heading two\n\n### Heading three\n\n**Strong text**, *emphasis* and ~~removed text~~.\n\n> Keep the output concise.\n\n1. Read the input\n2. Review the result\n   - Check nested details\n\n| Field | Value |\n| --- | --- |\n| Status | Ready |\n| Count | 128 |\n\n---\n\nLong token: `customer_activity_summary_for_the_current_reporting_period`',
    },
  ],
}

function CommentStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes('comment')
  const [model, setModel] = useState(commentModel)
  const [selected, setSelected] = useState<readonly string[]>(['notes'])
  const [editable, setEditable] = useState(true)
  useStoryActions([
    { label: 'Single selection', onClick: () => setSelected(['notes']) },
    { label: 'Multiple selection', onClick: () => setSelected(['notes', 'long']) },
    { label: editable ? 'Switch to read-only' : 'Enable editing', onClick: () => setEditable((value) => !value) },
    {
      label: 'Reset nodes',
      onClick: () => {
        setModel(commentModel)
        setSelected(['notes'])
      },
    },
  ])
  return (
    <div className="workflow-story">
      <div className="workflow-canvas">
        <FlowCanvasView
          ignoredNodeIds={ignoredNodeIds}
          onIgnoreNodes={onIgnoreNodes}
          onAddNode={() => undefined}
          onConnect={(edge) => log('edge.connect', edge)}
          onDisconnect={(edge) => log('edge.disconnect', edge)}
          onDeleteNodes={(ids) => {
            setModel((current) => ({
              ...current,
              nodes: current.nodes.filter((node) => !ids.includes(node.id)),
            }))
            setSelected((current) => current.filter((id) => !ids.includes(id)))
            log('node.delete', ids)
          }}
          onPaste={(position) => log('canvas.paste', position)}
          onMoveNodes={(positions) => log('node.move', positions)}
          onMoveViewport={(viewport) => log('canvas.move', viewport)}
          identity="lab:node-cases:comment"
          autoLayout={false}
          dark={dark}
          language={language}
          layoutMotion={false}
          editable={editable}
          model={model}
          addItems={[]}
          selectedNodeIds={selected}
          onSelectionChange={setSelected}
          onDuplicate={(ids) => log('node.duplicate', ids)}
          onChangeComment={(id, value) => {
            setModel((current) => ({
              ...current,
              nodes: current.nodes.map((node) => (node.id === id && node.kind === 'comment' ? { ...node, ...value } : node)),
            }))
            log('comment.change', { id, value })
          }}
        />
      </div>
    </div>
  )
}

export const nodeStories: readonly FrontendStory[] = [
  {
    group: 'Node Comment',
    id: 'node-comment',
    description: 'Comment cards · Selection, long titles, Markdown, tables and empty content. Use the source button to edit.',
    title: 'Node States',
    standalone: true,
    render: (log, dark, language) => <CommentStory dark={dark} language={language} log={log} />,
  },
  {
    group: 'Node Condition',
    id: 'node-condition',
    description: 'Condition nodes · Empty, single, multiple, invalid input and overflowing branch labels.',
    title: 'Node States',
    standalone: true,
    render: (log, dark, language) => <ConditionStory dark={dark} language={language} log={log} />,
  },
]
