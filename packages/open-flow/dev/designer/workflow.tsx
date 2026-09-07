import type { FlowDesignerViewModel } from '../../src/designer/browser/graph/FlowDesigner/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DesignerStory, LogAction } from './stories.tsx'

import { useState } from 'react'
import { FlowDesignerView } from '../../src/designer/browser/graph/FlowDesigner/FlowDesignerView.tsx'
import { Button } from '../../src/ui/browser/button.tsx'

const workflowViewport = { x: 35, y: 40, zoom: 0.9 }
const workflowPositions = {
  trigger: { x: 0, y: 0 },
  task: { x: 430, y: 0 },
  condition: { x: 430, y: 220 },
  value: { x: 0, y: 440 },
  subflow: { x: 430, y: 440 },
}
const stateViewport = { x: 45, y: 100, zoom: 0.9 }
const statePositions = Object.fromEntries(
  ['idle', 'selected', 'waiting', 'running', 'success', 'error'].map((id, index) => [id, { x: (index % 3) * 400, y: Math.floor(index / 3) * 240 }]),
)

const workflow: FlowDesignerViewModel = {
  viewport: workflowViewport,
  variableNames: ['API_KEY', 'BASE_URL'],
  variableNamesLoaded: true,
  edges: [
    { id: 'trigger-task', source: 'trigger', sourceHandle: '$out', target: 'task', targetHandle: '$in' },
    { id: 'task-condition', source: 'task', sourceHandle: '$out', target: 'condition', targetHandle: '$in' },
    { id: 'condition-value', source: 'condition', sourceHandle: '$branch:matched', target: 'value', targetHandle: '$in' },
    { id: 'value-subflow', source: 'value', sourceHandle: '$out', target: 'subflow', targetHandle: '$in' },
  ],
  nodes: [
    {
      id: 'trigger',
      kind: 'trigger',
      title: 'Cron · Daily digest',
      position: workflowPositions.trigger,
      inputs: [],
      outputs: [{ handle: 'tick', jsonSchema: { type: 'object' } }],
      presentation: { kind: 'cron', schedules: [{ type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' }] },
    },
    {
      id: 'task',
      kind: 'task',
      title: 'Task · Fetch records',
      description: 'Grouped inputs, connected ports and a Variable binding.',
      reference: 'lab/fetch-records',
      executorName: 'JavaScript',
      icon: ':carbon:code:',
      position: workflowPositions.task,
      inputs: [
        { group: 'Request' },
        { handle: 'tick', jsonSchema: { type: 'object' }, sources: [{ nodeId: 'trigger', output: 'tick' }] },
        { handle: 'url', jsonSchema: { type: 'string' }, value: 'https://example.com/records' },
        { handle: 'method', jsonSchema: { type: 'string', enum: ['GET', 'POST', 'PUT'] }, value: 'GET' },
        { group: 'Options' },
        { handle: 'limit', jsonSchema: { type: 'integer', minimum: 1, maximum: 100 }, value: 20 },
        { handle: 'enabled', jsonSchema: { type: 'boolean' }, value: true },
        { handle: 'token', jsonSchema: { type: 'string' }, variable: 'API_KEY', variableCompatible: true },
      ],
      outputs: [
        { handle: 'records', jsonSchema: { type: 'array', items: { type: 'object' } } },
        { handle: 'count', jsonSchema: { type: 'number' } },
      ],
    },
    {
      id: 'condition',
      kind: 'condition',
      title: 'Condition · Has records',
      position: workflowPositions.condition,
      inputs: [{ handle: 'count', jsonSchema: { type: 'number' }, sources: [{ nodeId: 'task', output: 'count' }] }],
      outputs: [
        { handle: 'matched', jsonSchema: { type: 'number' } },
        { handle: 'fallback', jsonSchema: { type: 'number' } },
      ],
      cases: [{ expressions: [{ input: 'count', operator: '>', value: 0 }], output: 'matched', relation: 'all' }],
      defaultOutput: 'fallback',
    },
    {
      id: 'value',
      kind: 'value',
      title: 'Value · Settings',
      position: workflowPositions.value,
      inputs: [],
      outputs: [{ handle: 'settings', jsonSchema: { type: 'object' } }],
      values: [{ handle: 'settings', jsonSchema: { type: 'object' }, value: { channel: 'updates', format: 'markdown', retries: 3 } }],
    },
    {
      id: 'subflow',
      kind: 'subflow',
      title: 'Subflow · Build digest',
      reference: 'lab/build-digest',
      position: workflowPositions.subflow,
      inputs: [
        { handle: 'records', jsonSchema: { type: 'array', items: { type: 'object' } }, sources: [{ nodeId: 'task', output: 'records' }] },
        { handle: 'settings', jsonSchema: { type: 'object' }, sources: [{ nodeId: 'value', output: 'settings' }] },
      ],
      outputs: [{ handle: 'text', jsonSchema: { type: 'string' } }],
    },
    {
      id: 'comment',
      kind: 'comment',
      title: 'Comment · Review notes',
      position: { x: 0, y: 220 },
      content:
        '### Workflow palette\nInspect the purpose of each step and its execution dependencies.\n\n- Select a node to inspect its outline.\n- Edit the selected node in the sidebar.\n- Hover controls to inspect their feedback.',
    },
  ],
}

const states: FlowDesignerViewModel = {
  viewport: stateViewport,
  runStatus: 'running',
  edges: [],
  nodes: (
    [
      { id: 'idle', title: 'Fetch recent orders', run: { status: 'idle' } },
      { id: 'selected', title: 'Normalize order dates', run: { status: 'idle' } },
      { id: 'waiting', title: 'Review the campaign', run: { status: 'waiting' } },
      { id: 'running', title: 'Enrich customer profiles', run: { status: 'running', progress: 42 } },
      { id: 'success', title: 'Build the weekly report', run: { status: 'success', progress: 100, successCount: 3 } },
      { id: 'error', title: 'Send the campaign', run: { status: 'error' } },
    ] as const
  ).map((node) => ({
    id: node.id,
    title: node.title,
    run: { ...node.run, runId: 'lab-run-042' },
    executorName: 'JavaScript',
    diagnostics: node.id == 'error' ? 1 : undefined,
    kind: 'task',
    reference: 'lab/status',
    position: statePositions[node.id],
    inputs: [{ handle: 'message', jsonSchema: { type: 'string' }, value: 'Sample input' }],
    outputs: [{ handle: 'result', jsonSchema: { type: 'string' } }],
  })),
}

function WorkflowStory({
  dark,
  language,
  log,
  model,
}: {
  readonly dark: boolean
  readonly language: UiLanguage
  readonly log: LogAction
  readonly model: FlowDesignerViewModel
}) {
  const [version, setVersion] = useState(0)
  const [inspectorContainer, setInspectorContainer] = useState<HTMLElement | null>(null)
  const [selected, setSelected] = useState<readonly string[]>([model == states ? 'selected' : 'task'])
  return (
    <div className="workflow-story">
      <div className="overview-toolbar open-flow-workbench">
        <span>Single canvas · select a step to configure it. Open results and logs from the status row.</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSelected([model == states ? 'selected' : 'task'])
            setVersion((value) => value + 1)
            log('samples.reset')
          }}
        >
          Reset samples
        </Button>
      </div>
      <div className={`workflow-study-grid ${model == states ? 'workflow-study-states' : ''}`}>
        <div className="workflow-canvas">
          <FlowDesignerView
            key={version}
            identity={`lab:${model == states ? 'states' : 'workflow'}:${version}`}
            autoLayout={false}
            dark={dark}
            language={language}
            layoutMotion={false}
            editable
            model={model}
            inspectorContainer={model == states ? undefined : inspectorContainer}
            toolbar={
              <Button size="sm" onClick={() => log('run.request')}>
                Run sample
              </Button>
            }
            addItems={[]}
            selectedNodeIds={selected}
            createSchemaEditor={() => () => undefined}
            onAddNode={(item) => {
              log('node.add', item)
              return undefined
            }}
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
            onChangeInput={(node, handle, value) => log('input.change', { node, handle, value })}
            onChangeInputVariable={(node, handle, name) => log('variable.change', { node, handle, name })}
            onChangeValue={(node, values) => log('value.change', { node, values })}
            onChangeCondition={(node, value) => log('condition.change', { node, value })}
            onChangeComment={(node, value) => log('comment.change', { node, value })}
            onChangeTriggerSchedule={(node, value) => log('schedule.change', { node, value })}
          />
        </div>
        {model != states && <aside className="workflow-study-inspector" ref={setInspectorContainer} />}
      </div>
    </div>
  )
}

export const workflowStories: readonly DesignerStory[] = [
  {
    group: 'Theme Preview',
    id: 'workflow',
    title: 'Workflow components',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={workflow} />,
  },
  {
    group: 'Theme Preview',
    id: 'node-states',
    title: 'Node states',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={states} />,
  },
]
