import type { FlowCanvasViewModel, FlowCanvasViewProps } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { Draft } from '../../src/workbench/browser/runtime/api.ts'
import type { CanvasNodePickerRequest } from '../../src/workbench/browser/runtime/editor/nodePickerPopover.tsx'
import type { PublishState } from '../../src/workbench/browser/runtime/shell/workspacePublishIsland.tsx'
import type { WorkspaceStatus } from '../../src/workbench/browser/runtime/stores/workspaceModel.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { ReactFlowProvider } from '@xyflow/react'
import { useMemo, useRef, useState } from 'react'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { CanvasInteractiveMode } from '../../src/canvas/browser/graph/ReactFlowContainer/CanvasControls.tsx'
import { CornerControls } from '../../src/canvas/browser/graph/ReactFlowContainer/CornerControls.tsx'
import { GetPopupContainerContext } from '../../src/canvas/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
import { useIgnoredNodes } from '../../src/canvas/browser/useIgnoredNodes.ts'
import { deriveAddNodeOptions } from '../../src/workbench/browser/runtime/editor/addNodeOptions.ts'
import { CanvasNodePicker } from '../../src/workbench/browser/runtime/editor/nodePickerPopover.tsx'
import { WorkbenchCanvasActions, WorkbenchInspectorToggle } from '../../src/workbench/browser/runtime/editor/workbenchCanvas.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { RunControl } from '../../src/workbench/browser/runtime/runs/runControl.tsx'
import { WorkspaceNavigationIsland } from '../../src/workbench/browser/runtime/shell/workspaceNavigationIsland.tsx'
import { WorkspacePublishIsland } from '../../src/workbench/browser/runtime/shell/workspacePublishIsland.tsx'
import { useStoryActions } from './storyActions.tsx'

const pickerDraft: Draft = {
  actorId: 'lab',
  createdAt: '2026-09-13T00:00:00.000Z',
  digest: 'lab',
  flowId: 'lab',
  modelVersion: currentFlowModelVersion,
  parentRevisionId: null,
  revisionId: 'lab',
  version: 1,
  content: { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, tasks: {}, subflows: {}, graph: { edges: [], nodes: {} } } },
}

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
      description: 'Grouped inputs, connected ports and an environment variable binding.',
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
      cases: [{ output: 'matched', groups: [{ expressions: [{ left: 'count', operator: '>', right: String(0) }] }] }],
      inputs: [],
      outputs: [{ handle: 'matched' }, { handle: 'otherwise' }],
      defaultOutput: 'otherwise' as const,
      matchMode: 'first' as const,
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
  const [pickerRequest, setPickerRequest] = useState<CanvasNodePickerRequest>()
  const [addNodeRequest, setAddNodeRequest] = useState<FlowCanvasViewProps['addNodeRequest']>(
    picker ? { position: { x: 140, y: 80 }, onComplete: () => setAddNodeRequest(undefined) } : undefined,
  )
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
          {pickerRequest && editable && (
            <CanvasNodePicker
              key={`${pickerRequest.screenPosition.x}:${pickerRequest.screenPosition.y}`}
              request={pickerRequest}
              options={deriveAddNodeOptions(pickerDraft, { kind: 'flow' }, i18n.t)}
              browseOptions={async () => []}
              searchOptions={async (query) =>
                deriveAddNodeOptions(pickerDraft, { kind: 'flow' }, i18n.t).filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
              }
              provideChoices={async () => []}
              disabled={!editable}
              focusRequest={0}
              onClose={() => setPickerRequest(undefined)}
              onAdd={async (option) => {
                log('node.add', { item: option.id, position: pickerRequest.position, connection: pickerRequest.connection?.('new-node') })
                return 'new-node'
              }}
            />
          )}
          <FlowCanvasView
            onRequestAddNode={setPickerRequest}
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
                pickerOpen={addNodeRequest != null}
                disabled={!editable}
                onOpenNodePicker={() =>
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
            onCopy={(nodeIds) => log('canvas.copy', nodeIds)}
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

const edgeColors: FlowCanvasViewModel = {
  viewport: { x: 45, y: 50, zoom: 0.8 },
  nodes: [
    { id: 'error-source', title: 'Error → idle', position: { x: 0, y: 0 }, diagnostics: 1 },
    { id: 'idle-target', title: 'Idle target', position: { x: 530, y: 0 } },
    { id: 'idle-source', title: 'Idle → error', position: { x: 0, y: 180 } },
    { id: 'error-target', title: 'Failed target', position: { x: 530, y: 250 }, run: { status: 'error' as const } },
    { id: 'selected-source', title: 'Selected → error', position: { x: 0, y: 440 } },
    { id: 'reverse-source', title: 'Error → error (reverse)', position: { x: 530, y: 440 }, diagnostics: 1 },
  ].map((node) => Object.assign(node, { kind: 'task' as const, reference: 'lab/task', inputs: [], outputs: [] })),
  edges: [
    ['error-source', 'idle-target'],
    ['idle-source', 'error-target'],
    ['selected-source', 'error-target'],
    ['reverse-source', 'error-source'],
  ].map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: '$out', targetHandle: '$in' })),
}

export const workflowStories: readonly FrontendStory[] = [
  {
    group: 'Workbench',
    id: 'workspace-navigation-island',
    title: 'Workspace navigation island',
    description: 'The navigation island sits on the canvas without a full-width header. Compare names and cycle the draft status dot beside the title.',
    standalone: true,
    render: (log, dark, language) => <NavigationIslandStory dark={dark} language={language} log={log} />,
  },
  {
    group: 'Theme Preview',
    id: 'edge-colors',
    title: 'Edge colors',
    description: 'Port colors blend along straight, curved and reverse connections. Select nodes or edges and switch themes to compare states.',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={edgeColors} initialSelectedNodeId="selected-source" />,
  },
  {
    group: 'Theme Preview',
    id: 'workflow',
    title: 'Workflow components',
    description:
      'Right-click the canvas for Add node and Paste. Add node opens the current picker; Paste logs its canvas position. Switch to read-only to inspect disabled actions.',
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
      'Right-click the canvas or drop an execution connection on empty space to open Add node near the pointer. Choose a node to log its position and connection. Compare both port directions, search, edge placement, and read-only behavior.',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={workflow} picker />,
  },
]

function NavigationIslandStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [shortName, setShortName] = useState(true)
  const [publishState, setPublishState] = useState<PublishState>('ready')
  const [saveStatus, setSaveStatus] = useState<WorkspaceStatus>('saved')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const interactiveMode$ = useMemo(() => val<'mouse' | 'touchpad'>('mouse'), [])
  const miniMapExpanded$ = useMemo(() => val<boolean | undefined>(false), [])
  const stageRef = useRef<HTMLDivElement>(null)
  const popup = useMemo(() => ({ default: () => stageRef.current || document.body, static: () => stageRef.current || document.body }), [])
  const publishStates: readonly PublishState[] = ['ready', 'current', 'issues', 'subflow', 'busy', 'publishing']
  const nextPublishState = publishStates[(publishStates.indexOf(publishState) + 1) % publishStates.length]!
  const saveStatuses: readonly WorkspaceStatus[] = ['saved', 'saving', 'failed']
  const nextSaveStatus = saveStatuses[(saveStatuses.indexOf(saveStatus) + 1) % saveStatuses.length]!
  useStoryActions([
    { label: shortName ? 'Show long name' : 'Show short name', onClick: () => setShortName((current) => !current) },
    { label: `Show ${nextSaveStatus} draft save state`, onClick: () => setSaveStatus(nextSaveStatus) },
    { label: `Show ${nextPublishState} publish state`, onClick: () => setPublishState(nextPublishState) },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'}>
        <div className="workspace" style={{ height: 180 }}>
          <div className="canvas-panel" ref={stageRef}>
            <GetPopupContainerContext.Provider value={popup}>
              <ReactFlowProvider>
                <CornerControls
                  before={
                    <WorkspacePublishIsland
                      onOpenPublications={() => log('publication.history')}
                      onOpenRuns={() => log('run.history')}
                      onPublish={() => log('publication.publish')}
                      state={publishState}
                    />
                  }
                  leading={<CanvasInteractiveMode interactiveMode$={interactiveMode$} />}
                  miniMapExpanded$={miniMapExpanded$}
                >
                  <WorkbenchInspectorToggle label="Toggle inspector" open={inspectorOpen} onToggle={() => setInspectorOpen((current) => !current)} />
                </CornerControls>
              </ReactFlowProvider>
            </GetPopupContainerContext.Provider>
          </div>
          <WorkspaceNavigationIsland
            saveStatus={saveStatus}
            flowName={shortName ? 'nn' : 'Quarterly customer onboarding and account follow-up workflow'}
            flowsHref="#workflows"
            onOpenFlows={() => log('flows.open')}
          />
        </div>
      </div>
    </I18nProvider>
  )
}
