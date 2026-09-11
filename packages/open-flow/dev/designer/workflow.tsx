import type { FlowCanvasViewAddItem, FlowCanvasViewModel, FlowCanvasViewProps } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { useIgnoredNodes } from '../../src/canvas/browser/useIgnoredNodes.ts'
import { WorkbenchCanvasActions } from '../../src/workbench/browser/runtime/editor/workbenchCanvas.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { RunControl } from '../../src/workbench/browser/runtime/runs/runControl.tsx'
import { useStoryActions } from './storyActions.tsx'

const pickerCatalog: readonly FlowCanvasViewAddItem[] = [
  {
    id: 'javascript',
    type: 'scriptlet',
    label: 'JavaScript',
    description: 'Run a script.',
    group: 'Blocks',
    inputs: [],
    outputs: [],
  },
  {
    id: 'condition',
    type: 'condition',
    label: 'Condition',
    group: 'Blocks',
    inputs: [],
    outputs: [],
  },
  {
    id: 'unavailable',
    type: 'block',
    label: 'Unavailable task',
    disabled: true,
    group: 'Blocks',
    inputs: [],
    outputs: [],
  },
  {
    id: 'mail',
    type: 'connector',
    label: 'Mail',
    group: 'Services',
    inputs: [],
    outputs: [],
    choices: [
      {
        id: 'mail.send',
        label: 'Send message',
        description: 'Send a new message.',
      },
      {
        id: 'mail.read',
        label: 'Read messages',
        description: 'Read the inbox.',
      },
    ],
  },
  {
    id: 'manual',
    type: 'trigger',
    label: 'Manual trigger',
    group: 'Triggers',
    inputs: [],
    outputs: [],
  },
]

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

const workflow: FlowCanvasViewModel = {
  viewport: workflowViewport,
  edges: [
    {
      id: 'trigger-task',
      source: 'trigger',
      sourceHandle: '$out',
      target: 'task',
      targetHandle: '$in',
    },
    {
      id: 'task-condition',
      source: 'task',
      sourceHandle: '$out',
      target: 'condition',
      targetHandle: '$in',
    },
    {
      id: 'condition-value',
      source: 'condition',
      sourceHandle: '$branch:matched',
      target: 'value',
      targetHandle: '$in',
    },
    {
      id: 'value-subflow',
      source: 'value',
      sourceHandle: '$out',
      target: 'subflow',
      targetHandle: '$in',
    },
  ],
  nodes: [
    {
      id: 'trigger',
      kind: 'trigger',
      title: 'Cron · Daily digest',
      position: workflowPositions.trigger,
      inputs: [],
      outputs: [{ handle: 'tick', jsonSchema: { type: 'object' } }],
      presentation: {
        kind: 'cron',
        schedules: [{ type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' }],
      },
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
        {
          handle: 'tick',
          jsonSchema: { type: 'object' },
          sources: [{ nodeId: 'trigger', output: 'tick' }],
        },
        {
          handle: 'url',
          jsonSchema: { type: 'string' },
          value: 'https://example.com/records',
        },
        {
          handle: 'method',
          jsonSchema: { type: 'string', enum: ['GET', 'POST', 'PUT'] },
          value: 'GET',
        },
        { group: 'Options' },
        {
          handle: 'limit',
          jsonSchema: { type: 'integer', minimum: 1, maximum: 100 },
          value: 20,
        },
        { handle: 'enabled', jsonSchema: { type: 'boolean' }, value: true },
        { handle: 'token', jsonSchema: { type: 'string' } },
      ],
      outputs: [
        {
          handle: 'records',
          jsonSchema: { type: 'array', items: { type: 'object' } },
        },
        { handle: 'count', jsonSchema: { type: 'number' } },
      ],
    },
    {
      id: 'condition',
      kind: 'condition',
      title: 'Has records',
      position: workflowPositions.condition,
      inputs: [
        {
          handle: 'count',
          jsonSchema: { type: 'number' },
          sources: [{ nodeId: 'task', output: 'count' }],
        },
      ],
      outputs: [
        { handle: 'matched', jsonSchema: { type: 'number' } },
        { handle: 'fallback', jsonSchema: { type: 'number' } },
      ],
      cases: [
        {
          expressions: [{ input: 'count', operator: '>', value: 0 }],
          output: 'matched',
          relation: 'all',
        },
      ],
      defaultOutput: 'fallback',
    },
    {
      id: 'value',
      kind: 'value',
      title: 'Value · Settings',
      position: workflowPositions.value,
      inputs: [],
      outputs: [{ handle: 'settings', jsonSchema: { type: 'object' } }],
      values: [
        {
          handle: 'settings',
          jsonSchema: { type: 'object' },
          value: { channel: 'updates', format: 'markdown', retries: 3 },
        },
      ],
    },
    {
      id: 'subflow',
      kind: 'subflow',
      title: 'Subflow · Build digest',
      reference: 'lab/build-digest',
      position: workflowPositions.subflow,
      inputs: [
        {
          handle: 'records',
          jsonSchema: { type: 'array', items: { type: 'object' } },
          sources: [{ nodeId: 'task', output: 'records' }],
        },
        {
          handle: 'settings',
          jsonSchema: { type: 'object' },
          sources: [{ nodeId: 'value', output: 'settings' }],
        },
      ],
      outputs: [{ handle: 'text', jsonSchema: { type: 'string' } }],
    },
    {
      id: 'comment',
      kind: 'comment',
      title: 'Comment · Review notes',
      position: { x: 0, y: 220 },
      content:
        '### Workflow palette\nInspect the purpose of each step and its execution dependencies.\n\n- Select a node to inspect its outline.\n- Pan and zoom to compare nodes.\n- Hover controls to inspect their feedback.',
    },
  ],
}

const states: FlowCanvasViewModel = {
  viewport: stateViewport,
  runStatus: 'running',
  edges: [],
  nodes: (
    [
      { id: 'idle', title: 'Fetch recent orders', run: { status: 'idle' } },
      {
        id: 'selected',
        title: 'Normalize order dates',
        run: { status: 'idle' },
      },
      {
        id: 'waiting',
        title: 'Review the campaign',
        run: { status: 'waiting' },
      },
      {
        id: 'running',
        title: 'Enrich customer profiles',
        run: { status: 'running', progress: 42 },
      },
      {
        id: 'success',
        title: 'Build the weekly report',
        run: { status: 'success', progress: 100, successCount: 3 },
      },
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
    inputs: [
      {
        handle: 'message',
        jsonSchema: { type: 'string' },
        value: 'Sample input',
      },
    ],
    outputs: [{ handle: 'result', jsonSchema: { type: 'string' } }],
  })),
}

function WorkflowStory({
  dark,
  language,
  log,
  model,
  initialSelectedNodeId = 'task',
  picker = false,
}: {
  readonly dark: boolean
  readonly language: UiLanguage
  readonly log: LogAction
  readonly model: FlowCanvasViewModel
  readonly initialSelectedNodeId?: string
  readonly picker?: boolean
}) {
  const i18n = useMemo(() => createI18n(language), [language])
  const triggers = model.nodes.filter((node) => node.kind === 'trigger')
  const [selectedTriggerId, setSelectedTriggerId] = useState(triggers[0]?.id ?? '')
  const [version, setVersion] = useState(0)
  const [editable, setEditable] = useState(true)
  const [addNodeRequest, setAddNodeRequest] = useState<FlowCanvasViewProps['addNodeRequest']>()
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes(String(version))
  const [selected, setSelected] = useState<readonly string[]>([initialSelectedNodeId])
  useStoryActions([
    { label: editable ? 'Switch to read-only' : 'Enable editing', onClick: () => setEditable((value) => !value) },
    {
      label: 'Reset samples',
      onClick: () => {
        setSelected([initialSelectedNodeId])
        setEditable(true)
        setVersion((value) => value + 1)
        log('samples.reset')
      },
    },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div className="workflow-story">
        <div className="workflow-canvas open-flow-workbench">
          <FlowCanvasView
            ignoredNodeIds={ignoredNodeIds}
            onIgnoreNodes={onIgnoreNodes}
            key={version}
            identity={`lab:workflow:${version}`}
            autoLayout={false}
            dark={dark}
            language={language}
            layoutMotion={false}
            editable={editable}
            model={model}
            toolbar={
              <WorkbenchCanvasActions
                blocksOpen={addNodeRequest != null}
                disabled={false}
                onOpenBlocks={() =>
                  setAddNodeRequest({
                    position: { x: 100, y: 100 },
                    onComplete: () => setAddNodeRequest(undefined),
                  })
                }
                runControl={
                  triggers.length > 0 ? (
                    <RunControl
                      disabled={false}
                      inputOpen={false}
                      inputStatus="none"
                      onInputOpenChange={(open) => log('run.inputs', open)}
                      onRun={() => log('run.request', selectedTriggerId)}
                      onSelectTrigger={setSelectedTriggerId}
                      selectedTriggerId={selectedTriggerId}
                      starting={false}
                      triggers={triggers}
                    />
                  ) : undefined
                }
              />
            }
            addItems={pickerCatalog}
            addNodeRequest={addNodeRequest}
            selectedNodeIds={selected}
            onAddNode={(item, position, connection) => {
              log('node.add', picker ? { item, position, connection: connection?.('new-node') } : item)
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
            onChangeComment={(node, value) => log('comment.change', { node, value })}
          />
        </div>
      </div>
    </I18nProvider>
  )
}

export const workflowStories: readonly FrontendStory[] = [
  {
    group: 'Theme Preview',
    id: 'workflow',
    title: 'Workflow components',
    description: 'Select nodes to compare outlines and execution states. Interactions appear in the status below.',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={workflow} />,
  },
  {
    group: 'Theme Preview',
    id: 'node-states',
    title: 'Node states',
    description: 'Select nodes to compare outlines and execution states. Interactions appear in the status below.',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={states} initialSelectedNodeId="selected" />,
  },
  {
    group: 'Workbench',
    id: 'node-picker',
    title: 'Canvas Node Picker',
    description:
      'Hover a node for 2s: unconnected ports show arrows that nudge ten times at a steady pace, then fade out and unmount. Selection alone does not trigger arrows; leaving during the delay cancels it. Once arrows appear, hovering or selection keeps the sequence alive. Leave and deselect to remove them; a connected side keeps all its ports visible without arrows. Read-only and connecting states hide arrows.',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={workflow} picker />,
  },
]
