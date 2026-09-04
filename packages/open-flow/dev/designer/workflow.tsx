import type { FlowDesignerViewModel } from '../../src/designer/browser/graph/FlowDesigner/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { DesignerStory, LogAction } from './stories.tsx'

import { useState } from 'react'
import { FlowDesignerView } from '../../src/designer/browser/graph/FlowDesigner/FlowDesignerView.tsx'
import { Button } from '../../src/ui/browser/button.tsx'

const workflowViewport = { x: 35, y: 50, zoom: 0.65 }
const workflowPositions = {
  trigger: { x: 0, y: 0 },
  task: { x: 560, y: 0 },
  condition: { x: 1120, y: 0 },
  value: { x: 0, y: 500 },
  subflow: { x: 560, y: 640 },
}
const stateViewport = { x: 35, y: 60, zoom: 0.65 }
const statePositions = Object.fromEntries(
  ['idle', 'selected', 'waiting', 'running', 'success', 'error'].map((id, index) => [id, { x: (index % 3) * 510, y: Math.floor(index / 3) * 370 }]),
)

const workflow: FlowDesignerViewModel = {
  viewport: workflowViewport,
  variableNames: ['API_KEY', 'BASE_URL'],
  variableNamesLoaded: true,
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
      position: { x: 1120, y: 590 },
      content:
        '### Workflow palette\nCompare node headers, fields, ports and connections.\n\n- Select a node to inspect its outline.\n- Switch between detail and overview.\n- Hover controls to inspect their feedback.',
    },
  ],
}

const states: FlowDesignerViewModel = {
  viewport: stateViewport,
  runStatus: 'running',
  nodes: (
    [
      { id: 'idle', title: 'Idle', run: { status: 'idle' } },
      { id: 'selected', title: 'Selected', run: { status: 'idle' } },
      { id: 'waiting', title: 'Waiting', run: { status: 'waiting' } },
      { id: 'running', title: 'Running · 42%', run: { status: 'running', progress: 42 } },
      { id: 'success', title: 'Success · 3 executions', run: { status: 'success', progress: 100, successCount: 3 } },
      { id: 'error', title: 'Error · Invalid input', run: { status: 'error' } },
    ] as const
  ).map((node) => ({
    id: node.id,
    title: node.title,
    run: node.run,
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
  const [selected, setSelected] = useState<readonly string[]>([model == states ? 'selected' : 'task'])
  return (
    <div className="workflow-story">
      <div className="overview-toolbar open-flow-workbench">
        <span>Local samples · select, pan, zoom and switch display mode. Actions appear in the log.</span>
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
      <div className="workflow-canvas">
        <FlowDesignerView
          key={version}
          identity={`lab:${model == states ? 'states' : 'workflow'}:${version}`}
          autoLayout
          dark={dark}
          language={language}
          layoutMotion={false}
          editable
          model={model}
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
