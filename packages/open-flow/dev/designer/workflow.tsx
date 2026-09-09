import type {
  FlowDesignerViewAddItem,
  FlowDesignerViewModel,
  FlowDesignerViewNode,
  FlowDesignerViewProps,
} from '../../src/designer/browser/graph/FlowDesigner/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { Group, InputPort, JsonValue } from '../../src/workbench/browser/runtime/api.ts'
import type { NodeInputField } from '../../src/workbench/browser/runtime/designer/nodeInputs.tsx'
import type { DesignerStory, LogAction } from './stories.tsx'

import { useMemo, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { NodeActions } from '../../src/canvas/browser/nodeActions.tsx'
import { useIgnoredNodes } from '../../src/canvas/browser/useIgnoredNodes.ts'
import { FlowDesignerView } from '../../src/designer/browser/graph/FlowDesigner/FlowDesignerView.tsx'
import { Button } from '../../src/ui/browser/button.tsx'
import { CommentInspector } from '../../src/workbench/browser/runtime/designer/commentInspector.tsx'
import { NodeDescription } from '../../src/workbench/browser/runtime/designer/nodeDescription.tsx'
import { NodeInputs } from '../../src/workbench/browser/runtime/designer/nodeInputs.tsx'
import { PortDefinitionEditor } from '../../src/workbench/browser/runtime/designer/portDefinitionEditor.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'

const pickerCatalog: readonly FlowDesignerViewAddItem[] = [
  { id: 'javascript', type: 'scriptlet', label: 'JavaScript', description: 'Run a script.', group: 'Blocks', inputs: [], outputs: [] },
  { id: 'condition', type: 'condition', label: 'Condition', group: 'Blocks', inputs: [], outputs: [] },
  { id: 'unavailable', type: 'block', label: 'Unavailable task', disabled: true, group: 'Blocks', inputs: [], outputs: [] },
  {
    id: 'mail',
    type: 'connector',
    label: 'Mail',
    group: 'Services',
    inputs: [],
    outputs: [],
    choices: [
      { id: 'mail.send', label: 'Send message', description: 'Send a new message.' },
      { id: 'mail.read', label: 'Read messages', description: 'Read the inbox.' },
    ],
  },
  { id: 'manual', type: 'trigger', label: 'Manual trigger', group: 'Triggers', inputs: [], outputs: [] },
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

const workflow: FlowDesignerViewModel = {
  viewport: workflowViewport,
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
        { handle: 'token', jsonSchema: { type: 'string' } },
      ],
      outputs: [
        { handle: 'records', jsonSchema: { type: 'array', items: { type: 'object' } } },
        { handle: 'count', jsonSchema: { type: 'number' } },
      ],
    },
    {
      id: 'condition',
      kind: 'condition',
      title: 'Has records',
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

function WorkflowInspector({ node, log }: { node: Exclude<FlowDesignerViewNode, { kind: 'comment' }>; log: LogAction }) {
  const [description, setDescription] = useState(node.description)
  const [entries, setEntries] = useState<readonly (Group | NodeInputField)[]>(() =>
    node.inputs.map((input) =>
      'group' in input
        ? input
        : {
            definition: {
              handle: input.handle,
              jsonSchema: (input.jsonSchema ?? {}) as JsonValue,
              nullable: input.nullable ?? false,
              description: input.description,
            },
            value: input.value as JsonValue | undefined,
            connected: (input.sources?.length ?? 0) > 0,
            variableName: node.id === 'task' && input.handle === 'token' ? 'API_KEY' : undefined,
          },
    ),
  )
  const [outputs, setOutputs] = useState<readonly (Group | InputPort)[]>(() =>
    node.outputs.map((output) =>
      'group' in output
        ? output
        : {
            handle: output.handle,
            jsonSchema: (output.jsonSchema ?? {}) as JsonValue,
            nullable: output.nullable ?? false,
            description: output.description,
          },
    ),
  )
  return (
    <>
      <NodeDescription
        value={description}
        disabled={false}
        onSave={(value) => {
          setDescription(value)
          log('description.change', value ?? '')
        }}
      />
      <NodeInputs
        entries={entries}
        disabled={false}
        variables={{ enabled: true, loaded: true, loading: false, names: ['API_KEY', 'BASE_URL'], onOpen: () => log('variables.open') }}
        onValue={(handle, value) => {
          setEntries((current) => current.map((entry) => ('group' in entry || entry.definition.handle !== handle ? entry : { ...entry, value })))
          log('input.change', { handle, value })
        }}
        onVariable={(handle, variableName) => {
          setEntries((current) =>
            current.map((entry) => ('group' in entry || entry.definition.handle !== handle ? entry : { ...entry, variableName, value: undefined })),
          )
          log('variable.change', { handle, variableName })
        }}
      />
      <PortDefinitionEditor
        groups
        output
        values={outputs}
        disabled={node.kind !== 'task'}
        onChange={(next) => {
          setOutputs(next)
          log('outputs.change', next)
        }}
      />
    </>
  )
}

function WorkflowStory({
  dark,
  language,
  log,
  model,
  inspectorHeader = false,
  picker = false,
}: {
  readonly dark: boolean
  readonly language: UiLanguage
  readonly log: LogAction
  readonly model: FlowDesignerViewModel
  readonly inspectorHeader?: boolean
  readonly picker?: boolean
}) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [version, setVersion] = useState(0)
  const [addNodeRequest, setAddNodeRequest] = useState<FlowDesignerViewProps['addNodeRequest']>()
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes(String(version))
  const [selected, setSelected] = useState<readonly string[]>([model == states ? 'selected' : 'task'])
  const selectedNode = model.nodes.find((node) => node.id === selected[0])
  return (
    <I18nProvider i18n={i18n}>
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
              ignoredNodeIds={ignoredNodeIds}
              onIgnoreNodes={onIgnoreNodes}
              key={version}
              identity={`lab:${model == states ? 'states' : 'workflow'}:${version}`}
              autoLayout={false}
              dark={dark}
              language={language}
              layoutMotion={false}
              editable
              model={model}
              toolbar={
                <>
                  {picker && (
                    <Button size="sm" onClick={() => setAddNodeRequest({ position: { x: 100, y: 100 }, onComplete: () => setAddNodeRequest(undefined) })}>
                      Add node
                    </Button>
                  )}
                  <Button size="sm" onClick={() => log('run.request')}>
                    Run sample
                  </Button>
                </>
              }
              addItems={picker ? pickerCatalog : []}
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
          {model != states && (
            <aside className="workflow-study-inspector open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'}>
              {inspectorHeader && selectedNode != null && selectedNode.kind != 'comment' && (
                <NodeActions
                  ignored={ignoredNodeIds.includes(selectedNode.id)}
                  onIgnore={(ignored) => onIgnoreNodes([selectedNode.id], ignored)}
                  onDuplicate={selectedNode.kind == 'trigger' ? undefined : () => log('node.duplicate', [selectedNode.id])}
                  onDelete={() => log('node.delete', [selectedNode.id])}
                />
              )}
              {selectedNode?.kind === 'comment' && (
                <CommentInspector
                  key={`${version}:${selectedNode.id}`}
                  title={selectedNode.title}
                  content={selectedNode.content ?? ''}
                  dark={dark}
                  disabled={false}
                  onSave={(value) => log('comment.change', { node: selectedNode.id, value })}
                  onDuplicate={() => log('node.duplicate', [selectedNode.id])}
                  onDelete={() => log('node.delete', [selectedNode.id])}
                />
              )}
              {selectedNode != null && selectedNode.kind !== 'comment' && (
                <WorkflowInspector key={`${version}:${selectedNode.id}`} node={selectedNode} log={log} />
              )}
            </aside>
          )}
        </div>
      </div>
    </I18nProvider>
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
  {
    group: 'Workbench',
    id: 'node-inspector',
    title: 'Node Inspector',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={workflow} inspectorHeader />,
  },
  {
    group: 'Workbench',
    id: 'node-picker',
    title: 'Canvas Node Picker',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={workflow} picker />,
  },
]
