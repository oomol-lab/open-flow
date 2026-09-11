import type { FlowCanvasViewModel, FlowCanvasViewValueNode } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
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

const valueSamples: readonly Pick<FlowCanvasViewValueNode, 'id' | 'title' | 'values' | 'diagnostics' | 'contentHidden'>[] = [
  {
    id: 'hidden',
    title: 'Hidden content',
    contentHidden: true,
    values: [{ handle: 'message', value: 'Reveal this saved value with the toolbar.' }],
  },
  { id: 'empty', title: 'No values', values: [] },
  {
    id: 'primitives',
    title: 'String, number and boolean',
    values: [
      { handle: 'message', jsonSchema: { type: 'string' }, value: 'Hello, Open Flow' },
      { handle: 'count', jsonSchema: { type: 'number' }, value: 0 },
      { handle: 'enabled', jsonSchema: { type: 'boolean' }, value: false },
      { handle: 'environment', jsonSchema: { type: 'string' }, value: 'production' },
      { handle: 'retries', jsonSchema: { type: 'number' }, value: 3 },
    ],
  },
  {
    id: 'structured',
    title: 'Object and array',
    values: [
      { handle: 'customer', jsonSchema: { type: 'object' }, value: { name: 'Ada', preferences: { language: 'en' } } },
      { handle: 'tags', jsonSchema: { type: 'array', items: { type: 'string' } }, value: ['review', 'ready'] },
    ],
  },
  {
    id: 'nullable',
    title: 'Null and empty string',
    values: [
      { handle: 'optional', jsonSchema: { type: 'string' }, nullable: true, value: null },
      { handle: 'message', jsonSchema: { type: 'string' }, value: '' },
    ],
  },
  {
    id: 'long',
    title: 'Long field name and multiline content',
    values: [
      {
        handle: 'customer_activity_summary_for_the_current_reporting_period',
        jsonSchema: { type: 'string' },
        value: 'A detailed customer activity summary with a long line to inspect wrapping and truncation.\nOrders reviewed: 128\nStatus: Ready for review',
      },
    ],
  },
  {
    id: 'large',
    title: 'Large object and long array',
    values: [
      { handle: 'fields', value: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`field_${index}`, `Value ${index}`])) },
      { handle: 'records', value: Array.from({ length: 120 }, (_, index) => ({ id: index, active: index % 2 === 0 })) },
      { handle: 'text', value: 'A long paragraph for inspecting scrollable string details.\n'.repeat(40) },
    ],
  },
  {
    id: 'invalid',
    title: 'Invalid number',
    diagnostics: 1,
    values: [{ handle: 'count', jsonSchema: { type: 'number' }, value: 'not-a-number' }],
  },
]

const valueModel: FlowCanvasViewModel = {
  edges: [],
  viewport: { x: 46, y: 70, zoom: 0.65 },
  nodes: [
    ...valueSamples.map(
      (sample, index): FlowCanvasViewValueNode => ({
        id: sample.id,
        title: sample.title,
        values: sample.values,
        contentHidden: sample.contentHidden,
        diagnostics: sample.diagnostics,
        kind: 'value',
        inputs: [],
        outputs: sample.values,
        position: { x: (index % 3) * 380, y: Math.floor(index / 3) * 280 },
      }),
    ),
    {
      id: 'task-reference',
      kind: 'task',
      reference: 'sample',
      title: 'Task · Visual reference',
      executorName: 'JavaScript',
      inputs: [],
      outputs: [],
      position: { x: 760, y: 560 },
    },
  ],
}

function NodeContentStory({
  dark,
  language,
  log,
  initialModel = valueModel,
  initialSelection = 'primitives',
}: {
  readonly dark: boolean
  readonly language: UiLanguage
  readonly log: LogAction
  readonly initialModel?: FlowCanvasViewModel
  readonly initialSelection?: string
}) {
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes(initialSelection)
  const [selected, setSelected] = useState<readonly string[]>([initialSelection])
  const [editable, setEditable] = useState(true)
  const [model, setModel] = useState(initialModel)
  const [generation, setGeneration] = useState(0)
  useStoryActions([
    {
      label: 'Toggle all content',
      onClick: () => setModel((value) => ({ ...value, nodes: value.nodes.map((node) => ({ ...node, contentHidden: !node.contentHidden })) })),
    },
    { label: editable ? 'Switch to read-only' : 'Enable editing', onClick: () => setEditable((value) => !value) },
    {
      label: 'Reset samples',
      onClick: () => {
        setSelected([initialSelection])
        setEditable(true)
        setModel(initialModel)
        onIgnoreNodes(ignoredNodeIds, false)
        setGeneration((value) => value + 1)
      },
    },
  ])
  return (
    <div className="workflow-story">
      <div className="workflow-canvas">
        <FlowCanvasView
          key={generation}
          identity="lab:node-cases:value"
          autoLayout={false}
          layoutMotion={false}
          dark={dark}
          language={language}
          editable={editable}
          model={model}
          onChangeNodeContentHidden={(nodeId, hidden) => {
            setModel((value) => ({
              ...value,
              nodes: value.nodes.map((node) => (node.id == nodeId ? { ...node, contentHidden: hidden } : node)),
            }))
            log('node.contentHidden', { nodeId, hidden })
          }}
          addItems={[]}
          ignoredNodeIds={ignoredNodeIds}
          onIgnoreNodes={onIgnoreNodes}
          selectedNodeIds={selected}
          onSelectionChange={(ids) => {
            setSelected(ids)
            log('selection.change', ids)
          }}
          onAddNode={() => undefined}
          onConnect={(edge) => log('edge.connect', edge)}
          onDisconnect={(edge) => log('edge.disconnect', edge)}
          onDeleteNodes={(ids) => log('node.delete', ids)}
          onDuplicate={(ids) => log('node.duplicate', ids)}
          onPaste={(position) => log('canvas.paste', position)}
          onMoveNodes={(positions) => log('node.move', positions)}
          onMoveViewport={(viewport) => log('canvas.move', viewport)}
        />
      </div>
    </div>
  )
}

const contentModel: FlowCanvasViewModel = {
  edges: [{ id: 'schedule-values', source: 'schedule', sourceHandle: '$out', target: 'values', targetHandle: '$in' }],
  viewport: { x: 46, y: 76, zoom: 0.65 },
  nodes: [
    {
      id: 'schedule',
      kind: 'trigger',
      title: 'Schedule content',
      inputs: [],
      outputs: [],
      position: { x: 0, y: 0 },
      presentation: { kind: 'cron', schedules: [{ type: 'every', value: 30, unit: 'minute' }] },
    },
    {
      id: 'values',
      kind: 'value',
      title: 'Fixed values content',
      inputs: [],
      outputs: [],
      position: { x: 380, y: 0 },
      values: [{ handle: 'message', value: 'Hello, Open Flow' }],
    },
    {
      id: 'task',
      kind: 'task',
      title: 'Task content',
      inputs: [],
      outputs: [],
      position: { x: 760, y: 0 },
      reference: 'sample',
      description: 'Summarize the latest report.\nInclude findings, sources and follow-up actions.',
      tools: [{ id: 'search', label: 'Search', icon: ':lucide:search:' }],
      run: { status: 'success' },
    },
    {
      id: 'condition',
      kind: 'condition',
      title: 'Condition · not collapsible',
      description: 'Keep the branch rule visible.',
      inputs: [],
      outputs: [{ handle: 'matched' }],
      position: { x: 0, y: 280 },
      cases: [{ output: 'matched', relation: 'all', expressions: [{ input: 'count', operator: '>', value: 0 }] }],
    },
    { id: 'empty', kind: 'value', title: 'Empty · no collapse action', inputs: [], outputs: [], position: { x: 380, y: 280 }, values: [] },
    { id: 'comment', kind: 'comment', title: 'Comment content', content: 'Keep the **report** concise.', position: { x: 760, y: 280 } },
  ],
}

const zoomTitles: Readonly<Record<string, string>> = {
  schedule: 'Scheduled customer report',
  values: '汇总本周客户订单并生成待审核的分析报告',
  task: 'customer_activity_summary_for_the_current_reporting_period',
  empty: 'A long node title that truncates to a single line',
}

function NodeZoomStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes('zoom')
  const [selected, setSelected] = useState<readonly string[]>([])
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 16, height: '100%' }}>
      {[0.45, 0.26, 0.25].map((zoom) => (
        <section key={zoom} style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', minHeight: 440 }}>
          <h3>
            {Math.round(zoom * 100)}% · {zoom >= 0.45 ? 'Full content' : zoom > 0.25 ? 'Simplified title' : 'Simplified content'}
          </h3>
          <div style={{ flex: 1, position: 'relative' }}>
            <FlowCanvasView
              identity={`lab:node-zoom:${zoom}`}
              editable
              ignoredNodeIds={ignoredNodeIds}
              onIgnoreNodes={onIgnoreNodes}
              addItems={[]}
              selectedNodeIds={selected}
              onSelectionChange={setSelected}
              onAddNode={() => undefined}
              onConnect={(edge) => log('edge.connect', edge)}
              onDisconnect={(edge) => log('edge.disconnect', edge)}
              onDeleteNodes={(ids) => log('node.delete', ids)}
              onDuplicate={(ids) => log('node.duplicate', ids)}
              onPaste={(position) => log('canvas.paste', position)}
              onMoveNodes={(positions) => log('node.move', positions)}
              autoLayout={false}
              layoutMotion={false}
              dark={dark}
              language={language}
              model={{
                ...contentModel,
                viewport: { x: 24, y: 32, zoom },
                nodes: contentModel.nodes
                  .filter((node) => node.kind !== 'comment')
                  .map((node, index) =>
                    Object.assign({}, node, {
                      title: zoomTitles[node.id] ?? node.title,
                      ...(node.kind === 'condition'
                        ? {
                            title: 'Condition',
                            outputs: [{ handle: 'matched' }, { handle: 'fallback' }],
                            defaultOutput: 'fallback',
                          }
                        : {}),
                      diagnostics: node.id === 'empty' ? 1 : undefined,
                      position: { x: 0, y: [0, 150, 300, 560, 780][index]! },
                    }),
                  ),
              }}
              onMoveViewport={(viewport) => log('canvas.move', viewport)}
            />
          </div>
        </section>
      ))}
    </div>
  )
}

export const nodeStories: readonly FrontendStory[] = [
  {
    group: 'Canvas',
    id: 'node-zoom',
    title: 'Node zoom',
    description: 'Titles simplify below 45%; content hides at 25% and below. Compare single content frames and Condition strips aligned with branch ports.',
    standalone: true,
    render: (log, dark, language) => <NodeZoomStory dark={dark} language={language} log={log} />,
  },
  {
    group: 'Canvas',
    id: 'node-content',
    title: 'Node content',
    description:
      'Compare height transitions with Toggle all content or each node toolbar. Read-only, empty and Condition nodes omit the collapse action. Run status and branches remain visible.',
    standalone: true,
    render: (log, dark, language) => <NodeContentStory dark={dark} language={language} log={log} initialModel={contentModel} initialSelection="schedule" />,
  },
  {
    group: 'Fixed Values',
    id: 'node-value',
    description: 'Fixed value cards · Collapsed, empty, structured and invalid states, with a Task reference for comparing density and elevation.',
    title: 'Node States',
    standalone: true,
    render: (log, dark, language) => <NodeContentStory dark={dark} language={language} log={log} />,
  },
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
    description:
      'Condition nodes · Empty, single, multiple, invalid input and overflowing branch labels. Hover for two seconds to see connection hints; Invalid input suppresses them.',
    title: 'Node States',
    standalone: true,
    render: (log, dark, language) => <ConditionStory dark={dark} language={language} log={log} />,
  },
]
