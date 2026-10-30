import type { FlowCanvasViewModel, FlowCanvasViewProps } from '../../src/canvas/browser/graph/FlowCanvas/model.ts'
import type { CanvasCommand, CanvasCommandSubscriber } from '../../src/canvas/common/commands.ts'
import type { UiLanguage } from '../../src/localization/common/languages.ts'
import type { Draft } from '../../src/workbench/browser/runtime/api.ts'
import type { CanvasNodePickerRequest } from '../../src/workbench/browser/runtime/editor/nodePickerPopover.tsx'
import type { PublishState } from '../../src/workbench/browser/runtime/shell/workspacePublishIsland.tsx'
import type { WorkspaceStatus } from '../../src/workbench/browser/runtime/stores/workspaceModel.ts'
import type { FrontendStory, LogAction } from './stories.tsx'

import { currentFlowModelVersion } from '@oomol-lab/open-flow/flow-change'
import { ReactFlow } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider } from 'val-i18n-react'
import { val } from 'value-enhancer'
import { downloadFlowSvg, flowToSvg } from '../../src/canvas/browser/graph/FlowCanvas/exportSvg.ts'
import { FlowCanvasView } from '../../src/canvas/browser/graph/FlowCanvas/FlowCanvasView.tsx'
import { CanvasViewControls, CanvasTopLeftControls } from '../../src/canvas/browser/graph/ReactFlowContainer/CanvasControls.tsx'
import { CornerControls } from '../../src/canvas/browser/graph/ReactFlowContainer/CornerControls.tsx'
import { GetPopupContainerContext } from '../../src/canvas/browser/graph/ReactFlowContainer/useGetPopupContainer.ts'
import { useIgnoredNodes } from '../../src/canvas/browser/useIgnoredNodes.ts'
import { WorkbenchClient } from '../../src/workbench/browser/runtime/api.ts'
import { deriveAddNodeOptions } from '../../src/workbench/browser/runtime/editor/addNodeOptions.ts'
import { CanvasNodePicker } from '../../src/workbench/browser/runtime/editor/nodePickerPopover.tsx'
import { WorkbenchCanvasActions } from '../../src/workbench/browser/runtime/editor/workbenchCanvas.tsx'
import { WorkbenchInspectorToggle } from '../../src/workbench/browser/runtime/editor/workbenchInspectorToggle.tsx'
import { createI18n } from '../../src/workbench/browser/runtime/i18n.ts'
import { providerIcon } from '../../src/workbench/browser/runtime/providerIcon.ts'
import { RunControl } from '../../src/workbench/browser/runtime/runs/runControl.tsx'
import { FlowSettingsButton } from '../../src/workbench/browser/runtime/shell/flowSettings.tsx'
import { WorkspaceNavigationIsland } from '../../src/workbench/browser/runtime/shell/workspaceNavigationIsland.tsx'
import { WorkspacePublishIsland } from '../../src/workbench/browser/runtime/shell/workspacePublishIsland.tsx'
import { WorkbenchStore } from '../../src/workbench/browser/runtime/stores/workbenchStore.ts'
import { designerGraph } from '../../src/workbench/browser/runtime/workspace.ts'
import googleSheetsIcon from './fixtures/google-sheets.ico'
import { remoteGithubArtwork, sampleSprite } from './fixtures/providerSprite.ts'
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
  content: { modelVersion: currentFlowModelVersion, modules: {}, document: { bindings: {}, graph: { edges: [], nodes: {} } } },
}

const workflowViewport = { x: 35, y: 40, zoom: 0.9 }
const longChainIds = Array.from({ length: 12 }, (_, index) => `step-${index + 1}`)
const longChain = designerGraph({
  ...pickerDraft,
  content: {
    ...pickerDraft.content,
    modules: { code: { name: 'Step', source: 'export default () => ({})', imports: [] } },
    document: {
      bindings: {},
      graph: {
        nodes: Object.fromEntries(
          [...longChainIds, 'parallel'].map((id) => [
            id,
            {
              kind: 'task',
              name: id == 'parallel' ? '4b · Parallel step' : `${id.replace('step-', '')} · Process records`,
              inputs: {},
              task: { name: 'Step', moduleId: 'code', inputs: [], outputs: [] },
            },
          ]),
        ),
        edges: [
          ...longChainIds.slice(1).map((target, index) => ({ source: longChainIds[index]!, target })),
          { source: 'step-3', target: 'parallel' },
          { source: 'parallel', target: 'step-5' },
        ],
      },
    },
  },
})
const longChainModel = { ...longChain, viewport: { x: 60, y: 40, zoom: 0.5 } }
const workflowPositions = {
  trigger: { x: 0, y: 0 },
  task: { x: 430, y: 0 },
  condition: { x: 430, y: 220 },
  value: { x: 0, y: 440 },
}
const stateViewport = { x: 45, y: 100, zoom: 0.9 }

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
      description: 'Grouped inputs, connected ports and a variable binding.',
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
        id: 'running-content',
        title: 'Summarize customer feedback',
        description:
          'Review recent customer conversations, group recurring issues, and draft a concise summary with examples and suggested follow-ups for the product team.',
        run: { status: 'running', progress: 26 },
      },
      {
        id: 'success',
        title: 'Build the weekly report',
        run: { status: 'success', progress: 100, successCount: 3 },
      },
      { id: 'error', title: 'Send the campaign', run: { status: 'error' } },
      { id: 'account', title: 'Code · Missing account', run: { status: 'idle' } },
      { id: 'deferred', title: 'Provider · Account deferred', run: { status: 'idle' } },
    ] as const
  ).map((node, index) =>
    Object.assign(node, {
      run: { ...node.run, runId: 'lab-run-042' },
      executorName: node.id == 'deferred' ? 'Connector · Gmail' : 'JavaScript',
      actionSummary:
        node.id === 'idle' || node.id === 'deferred'
          ? undefined
          : {
              count: node.id === 'selected' ? 3 : 9,
              providers: (node.id === 'selected' ? ['slack'] : ['slack', 'github', 'notion', 'google-drive', 'feishu', 'airtable']).map((id) => ({
                id,
                icon: providerIcon({ serviceId: id, serviceName: id }),
                label: id,
              })),
            },
      diagnostics: node.id == 'error' || node.id == 'account' ? 1 : undefined,
      connectionRequired: node.id == 'account',
      connectionDeferred: node.id == 'deferred',
      kind: 'task' as const,
      reference: 'lab/status',
      position: { x: (index % 3) * 400, y: Math.floor(index / 3) * 240 },
      inputs: [
        {
          handle: 'message',
          jsonSchema: { type: 'string' as const },
          value: 'Sample input',
        },
      ],
      outputs: [{ handle: 'result', jsonSchema: { type: 'string' as const } }],
    }),
  ),
}

const completedStates: FlowCanvasViewModel = {
  ...states,
  runStatus: 'idle',
  nodes: states.nodes.map((node) =>
    node.kind !== 'comment' && node.run?.status === 'running' ? { ...node, run: { ...node.run, status: 'success', progress: 100 } } : node,
  ),
}

function WorkflowStory({
  dark,
  language,
  log,
  model,
  initialSelectedNodeId = 'task',
  picker = false,
  remoteCommands = false,
  completedModel,
}: {
  readonly dark: boolean
  readonly language: UiLanguage
  readonly log: LogAction
  readonly model: FlowCanvasViewModel
  readonly initialSelectedNodeId?: string
  readonly remoteCommands?: boolean
  readonly completedModel?: FlowCanvasViewModel
  readonly picker?: boolean
}) {
  const remote = useMemo(() => {
    const listeners = new Set<(command: CanvasCommand) => void>()
    const subscribe: CanvasCommandSubscriber = (execute) => {
      listeners.add(execute)
      return () => {
        listeners.delete(execute)
      }
    }
    return {
      subscribe,
      send: (command: CanvasCommand) => {
        for (const execute of listeners) execute(command)
      },
    }
  }, [])
  const i18n = useMemo(() => createI18n(language), [language])
  const triggers = model.nodes.filter((node) => node.kind === 'trigger')
  const [selectedTriggerId, setSelectedTriggerId] = useState(triggers[0]?.id ?? '')
  const [version, setVersion] = useState(0)
  const [editable, setEditable] = useState(true)
  const [runCompleted, setRunCompleted] = useState(false)
  const [pickerRequest, setPickerRequest] = useState<CanvasNodePickerRequest>()
  const [addNodeRequest, setAddNodeRequest] = useState<FlowCanvasViewProps['addNodeRequest']>(
    picker ? { position: { x: 140, y: 80 }, onComplete: () => setAddNodeRequest(undefined) } : undefined,
  )
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes(String(version))
  const [selected, setSelected] = useState<readonly string[]>([initialSelectedNodeId])
  useStoryActions([
    ...(completedModel ? [{ label: runCompleted ? 'Restart running nodes' : 'Finish running nodes', onClick: () => setRunCompleted((value) => !value) }] : []),
    ...(remoteCommands
      ? [
          { label: 'Focus last node', onClick: () => remote.send({ type: 'focus', nodeId: model.nodes.at(-1)!.id }) },
          { label: 'Zoom 80%', onClick: () => remote.send({ type: 'zoom', zoom: 0.8 }) },
          { label: 'Pan right / up', onClick: () => remote.send({ type: 'pan', dx: 200, dy: -100 }) },
          { label: 'Fit all nodes', onClick: () => remote.send({ type: 'fit' }) },
          {
            label: 'Two consecutive pans',
            onClick: () => {
              remote.send({ type: 'pan', dx: 100, dy: 0 })
              remote.send({ type: 'pan', dx: 100, dy: 0 })
            },
          },
        ]
      : []),
    { label: editable ? 'Switch to read-only' : 'Enable editing', onClick: () => setEditable((value) => !value) },
    {
      label: 'Reset samples',
      onClick: () => {
        setSelected([initialSelectedNodeId])
        setEditable(true)
        setRunCompleted(false)
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
              options={deriveAddNodeOptions(pickerDraft, i18n.t)}
              browseOptions={async () => []}
              searchOptions={async (query) =>
                deriveAddNodeOptions(pickerDraft, i18n.t).filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
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
            subscribeCanvasCommands={remoteCommands ? remote.subscribe : undefined}
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
            model={runCompleted && completedModel ? completedModel : model}
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
    id: 'workflow-svg',
    title: 'SVG export',
    description:
      'Compare the canvas and exported SVG. Exports use individual Provider images regardless of sprite availability; check Connector icons, JavaScript and AI Agent tool lists, branches, comments and both themes. Simulate a slow export to inspect the waiting dialog.',
    standalone: true,
    render: (_log, dark, language) => <SvgExportStory dark={dark} language={language} />,
  },
  {
    group: 'Workbench',
    id: 'canvas-commands',
    title: 'Remote canvas commands',
    description:
      'Commands use the production canvas and affect only its viewport. Fit includes every node even with a selection. Remote commands should not log viewport saves; manual pan and zoom still do. Consecutive pans must accumulate. Reset samples remounts without replaying commands.',
    standalone: true,
    render: (log, dark, language) => (
      <WorkflowStory dark={dark} language={language} log={log} model={longChainModel} initialSelectedNodeId="step-1" remoteCommands />
    ),
  },
  {
    group: 'Workbench',
    id: 'wrapped-layout',
    title: 'Long workflow layout',
    description:
      'Default placement wraps after six dependency columns. Re-layout uses the current canvas width, zoom and measured node sizes. Compare at 50% and 100%, or resize the window before re-layout. Parallel steps stay together; zooming alone preserves positions. Reset samples restores default placement.',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={longChainModel} initialSelectedNodeId="step-1" />,
  },
  {
    group: 'Workbench',
    id: 'workspace-navigation-island',
    title: 'Workspace navigation island',
    description:
      'The settings button opens the production Flow settings panel. Change the title and tags, and check that the heading updates while draft status stays unchanged. Manage labels from its picker and inspect usage links. Creating or renaming a label keeps both dialogs open and retains unsaved title edits. Compare the canvas island with the ghost style used while loading or recovering a workflow. Cycle names and the draft status dot beside the title. Open the publish confirmation to inspect its content insets and separation between copy and actions in both themes. Cycle History and switch languages to inspect single-line published, empty, and loading menu labels. Open the menu with the MiniMap expanded to inspect overlapping controls. Cancel or dismiss confirmation without publishing; confirm to log one publication.publish event.',
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
      'Right-click the canvas for Add node and Paste. Add node opens the current picker; Paste logs its canvas position. Switch to read-only to inspect disabled actions and the expanded view controls, including below 900px.',
    standalone: true,
    render: (log, dark, language) => <WorkflowStory dark={dark} language={language} log={log} model={workflow} />,
  },
  {
    group: 'Theme Preview',
    id: 'node-states',
    title: 'Node states',
    description:
      'Compare compact and content-filled running nodes with the other execution states, provider stacks and account warnings. Finish and restart both running nodes to check the beam lifecycle. Compare corners, selection, themes, zoom and reduced motion.',
    standalone: true,
    render: (log, dark, language) => (
      <WorkflowStory dark={dark} language={language} log={log} model={states} completedModel={completedStates} initialSelectedNodeId="selected" />
    ),
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

function SvgExportStory({ dark, language }: { readonly dark: boolean; readonly language: UiLanguage }) {
  const [wrapped, setWrapped] = useState(false)
  const [remoteIcons, setRemoteIcons] = useState(false)
  const [taskKind, setTaskKind] = useState<'connector' | 'javascript' | 'agent'>('connector')
  const [slowExport, setSlowExport] = useState(false)
  const providerArtwork = remoteIcons
    ? providerIcon(remoteGithubArtwork)
    : providerIcon({ serviceId: 'google-sheets', serviceName: 'Google Sheets', icon: googleSheetsIcon })
  const i18n = useMemo(() => createI18n(language), [language])
  const model = useMemo(
    () =>
      wrapped
        ? longChainModel
        : {
            ...workflow,
            edges: workflow.edges.map((edge) => (edge.id == 'condition-value' ? Object.assign({}, edge, { target: 'task' }) : edge)),
            nodes: workflow.nodes.map((node) =>
              Object.assign({}, node, {
                title: node.kind == 'task' ? '汇总客户反馈并生成每周产品分析报告 & Review' : node.title,
                icon:
                  node.kind == 'task'
                    ? taskKind == 'agent'
                      ? ':carbon:machine-learning-model:'
                      : providerArtwork
                    : node.kind == 'trigger'
                      ? remoteIcons
                        ? providerArtwork
                        : providerIcon({ serviceId: 'sample', serviceName: 'Sample', iconSprite: sampleSprite, iconSpritePosition: { x: 54, y: 2 } })
                      : 'icon' in node
                        ? node.icon
                        : undefined,
                position: { x: node.position.x - 500, y: node.position.y - 180 },
                ...(node.kind == 'task'
                  ? {
                      executorName:
                        taskKind == 'agent' ? 'AI Agent' : taskKind == 'connector' ? 'Connector · ' + (remoteIcons ? 'GitHub' : 'Google Sheets') : 'JavaScript',
                      fallbackIcon:
                        taskKind == 'agent' ? ':carbon:machine-learning-model:' : taskKind == 'connector' ? ':carbon:connection-signal:' : ':carbon:code:',
                      actionSummary:
                        taskKind == 'connector'
                          ? undefined
                          : { count: 2, providers: [{ id: 'provider', icon: providerArtwork, label: remoteIcons ? 'GitHub' : 'Google Sheets' }] },
                    }
                  : {}),
              }),
            ),
          },
    [wrapped, remoteIcons, taskKind, providerArtwork],
  )
  const title = wrapped ? 'Weekly records pipeline' : 'Customer insights'
  const [source, setSource] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let active = true
    setSource(undefined)
    setError(undefined)
    void flowToSvg(model, title, language, { dark }).then(
      (value) => {
        if (active) setSource(value)
      },
      (reason) => {
        if (active) setError(String(reason))
      },
    )
    return () => {
      active = false
    }
  }, [model, title, language, dark])
  useStoryActions([
    { label: slowExport ? 'Use normal export speed' : 'Simulate slow export', onClick: () => setSlowExport((value) => !value) },
    { label: wrapped ? 'Show branches & Chinese titles' : 'Show wrapped pipeline', onClick: () => setWrapped((value) => !value) },
    { label: remoteIcons ? 'Use local provider artwork' : 'Use remote provider artwork', onClick: () => setRemoteIcons((value) => !value) },
    {
      label: taskKind == 'connector' ? 'Show JavaScript' : taskKind == 'javascript' ? 'Show AI Agent' : 'Show Connector',
      onClick: () => setTaskKind((value) => (value == 'connector' ? 'javascript' : value == 'javascript' ? 'agent' : 'connector')),
    },
  ])
  return (
    <I18nProvider i18n={i18n}>
      <div style={{ display: 'grid', gap: 24, padding: 24, justifyItems: 'start', alignItems: 'start', alignContent: 'start' }}>
        <WorkspacePublishIsland
          hasPublications={false}
          onExportSvg={async () => {
            if (slowExport) await new Promise((resolve) => setTimeout(resolve, 5000))
            await downloadFlowSvg(model, title, language, { dark })
          }}
          onOpenPublications={() => {}}
          onOpenRuns={() => {}}
          onPublish={() => {}}
          state="current"
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 24, width: '100%' }}>
          <section>
            <p>Canvas</p>
            <div style={{ height: 620 }}>
              <FlowCanvasView
                identity={`svg-comparison:${wrapped}`}
                model={model}
                dark={dark}
                language={language}
                editable={false}
                nodesDraggable={false}
                fitView
                autoLayout={false}
                layoutMotion={false}
                ignoredNodeIds={[]}
                selectedNodeIds={[]}
                onMoveNodes={() => {}}
                onMoveViewport={() => {}}
                onSelectionChange={() => {}}
              />
            </div>
          </section>
          <section>
            <p>Exported SVG</p>
            {source && (
              <img
                alt={title}
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`}
                style={{ width: '100%', height: 620, objectFit: 'contain' }}
              />
            )}
            {error && <p role="alert">{error}</p>}
          </section>
        </div>
      </div>
    </I18nProvider>
  )
}

function NavigationIslandStory({ dark, language, log }: { readonly dark: boolean; readonly language: UiLanguage; readonly log: LogAction }) {
  const i18n = useMemo(() => createI18n(language), [language])
  const [tagStore, setTagStore] = useState<WorkbenchStore>()
  const tagFlows = useVal(tagStore?.workspace.$.flows)
  useEffect(() => {
    let flow = {
      flowId: 'navigation-sample',
      name: 'nn',
      version: 1 as const,
      status: 'active' as const,
      tagIds: ['production', 'ai'],
      createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-10-30T00:00:00.000Z',
      draftRevisionId: 'draft',
      resourceReferences: { draft: null, sharedAccess: { accessRevision: 0, providerIds: [], bindings: [] } },
    }
    let tags = [
      { tagId: 'production', name: 'Production', version: 1 },
      { tagId: 'ai', name: 'AI', version: 1 },
    ]
    const client = new WorkbenchClient(async (path, init) => {
      const url = String(path).split('?')[0]
      if (url == '/v1/tags' && init?.method == 'POST') {
        const { name } = JSON.parse(String(init.body)) as { name: string }
        const tag = { tagId: `tag-${tags.length}`, name, version: 1 }
        tags = [...tags, tag]
        return Response.json(tag)
      }
      if (url?.startsWith('/v1/tags/') && init?.method != null) {
        const tagId = url.split('/')[3]!
        if (init.method == 'DELETE') {
          tags = tags.filter((tag) => tag.tagId != tagId)
          flow = { ...flow, tagIds: flow.tagIds.filter((id) => id != tagId) }
          return Response.json({ version: 1 })
        }
        const { name } = JSON.parse(String(init.body)) as { name: string }
        tags = tags.map((tag) => (tag.tagId == tagId ? Object.assign({}, tag, { name }) : tag))
        return Response.json(tags.find((tag) => tag.tagId == tagId))
      }
      if (url == '/v1/tags')
        return Response.json({ tags: tags.map((tag) => Object.assign({}, tag, { referenceCount: flow.tagIds.includes(tag.tagId) ? 1 : 0 })), version: 1 })
      if (url == `/v1/flows/${flow.flowId}` && init?.method == 'PATCH') {
        const changes = JSON.parse(String(init.body)) as { name?: string; tagIds?: string[] }
        flow = { ...flow, ...(changes.name == null ? {} : { name: changes.name }), ...(changes.tagIds == null ? {} : { tagIds: changes.tagIds }) }
        log('flow.settings', changes)
        return Response.json(flow)
      }
      if (url == `/v1/flows/${flow.flowId}/tags`) {
        const { tagIds } = JSON.parse(String(init?.body)) as { tagIds: string[] }
        flow = { ...flow, tagIds }
        log('flow.tags', tagIds)
        return Response.json(flow)
      }
      if (url == '/v1/flows') {
        const selected = new URL(String(path), 'https://lab.local').searchParams.get('tagIds')?.split(',') ?? []
        const matches = selected.length == 0 || selected.some((id) => flow.tagIds.includes(id))
        return Response.json({ flows: matches ? [{ ...flow, referenceCount: 0 }] : [], total: matches ? 1 : 0, version: 1 })
      }
      return Response.json({ message: 'Unsupported story action' }, { status: 400 })
    })
    const store = new WorkbenchStore(client, { getItem: () => null, setItem: () => {} }, undefined, i18n)
    setTagStore(store)
    void store.workspace.reloadFlows()
    return () => store.dispose()
  }, [i18n, log])
  const [shortName, setShortName] = useState(true)
  const [hasPublications, setHasPublications] = useState<boolean | undefined>(true)
  const [publishState, setPublishState] = useState<PublishState>('ready')
  const [saveStatus, setSaveStatus] = useState<WorkspaceStatus>('saved')
  const [ghost, setGhost] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const interactiveMode$ = useMemo(() => val<'mouse' | 'touchpad'>('mouse'), [])
  const miniMapExpanded$ = useMemo(() => val<boolean | undefined>(true), [])
  const stageRef = useRef<HTMLDivElement>(null)
  const popup = useMemo(() => ({ default: () => stageRef.current || document.body, static: () => stageRef.current || document.body }), [])
  const publishStates: readonly PublishState[] = ['ready', 'current', 'issues', 'busy', 'publishing']
  const nextPublishState = publishStates[(publishStates.indexOf(publishState) + 1) % publishStates.length]!
  const saveStatuses: readonly WorkspaceStatus[] = ['saved', 'saving', 'failed']
  const nextSaveStatus = saveStatuses[(saveStatuses.indexOf(saveStatus) + 1) % saveStatuses.length]!
  useStoryActions([
    { label: ghost ? 'Show canvas island' : 'Show loading and recovery ghost style', onClick: () => setGhost((current) => !current) },
    {
      label: shortName ? 'Show long name' : 'Show short name',
      onClick: () => {
        const short = !shortName
        setShortName(short)
        void tagStore?.updateFlowSettings('navigation-sample', { name: short ? 'nn' : 'Quarterly customer onboarding and account follow-up workflow' })
      },
    },
    { label: `Show ${nextSaveStatus} draft save state`, onClick: () => setSaveStatus(nextSaveStatus) },
    {
      label: `History: ${hasPublications == null ? 'loading' : hasPublications ? 'published' : 'unpublished'}`,
      onClick: () => setHasPublications((value) => (value === true ? false : value === false ? undefined : true)),
    },
    { label: `Show ${nextPublishState} publish state`, onClick: () => setPublishState(nextPublishState) },
  ])
  const navigationIsland = (
    <WorkspaceNavigationIsland
      ghost={ghost}
      saveStatus={ghost ? undefined : saveStatus}
      settings={
        tagStore != null &&
        tagFlows?.[0] != null && (
          <FlowSettingsButton store={tagStore} flow={tagFlows[0]} hrefForFlow={() => '#workflows'} onSelectFlow={(flow) => log('flow.open', flow.flowId)} />
        )
      }
      flowName={tagFlows?.[0]?.name ?? 'nn'}
      flowsHref="#workflows"
      onOpenFlows={() => log('flows.open')}
    />
  )
  return (
    <I18nProvider i18n={i18n}>
      <div className="open-flow-workbench open-flow-theme" data-theme={dark ? 'dark' : 'light'}>
        <div className="workspace" style={{ height: 260 }}>
          {ghost && <div className="workspace-navigation-placement">{navigationIsland}</div>}
          <div className="canvas-panel" ref={stageRef}>
            <GetPopupContainerContext.Provider value={popup}>
              <ReactFlow>
                {!ghost && <CanvasTopLeftControls>{navigationIsland}</CanvasTopLeftControls>}
                <CornerControls
                  before={
                    <WorkspacePublishIsland
                      onExport={() => log('flow.export')}
                      onExportSvg={async () => log('flow.exportSvg')}
                      hasPublications={hasPublications}
                      onOpenPublications={() => log('publication.history')}
                      onOpenRuns={() => log('run.history')}
                      onPublish={() => log('publication.publish')}
                      state={publishState}
                    />
                  }
                >
                  <WorkbenchInspectorToggle label="Toggle inspector" open={inspectorOpen} onToggle={() => setInspectorOpen((current) => !current)} />
                </CornerControls>
                <CanvasViewControls
                  interactiveMode$={interactiveMode$}
                  miniMapExpanded$={miniMapExpanded$}
                  maxZoomReached={false}
                  minZoomReached={false}
                  zoom={1}
                  onFitView={() => log('canvas.fit')}
                  onZoomIn={() => log('canvas.zoom', 'in')}
                  onZoomOut={() => log('canvas.zoom', 'out')}
                  onZoomReset={() => log('canvas.zoom', 'reset')}
                />
              </ReactFlow>
            </GetPopupContainerContext.Provider>
          </div>
        </div>
      </div>
    </I18nProvider>
  )
}
