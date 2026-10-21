// @vitest-environment happy-dom
import type { ComponentProps, ReactNode } from 'react'
import type { Val } from 'value-enhancer'
import type { NavigationStore } from './navigation.ts'
import type { WorkbenchStore } from './stores/workbenchStore.ts'

import { act, forwardRef } from 'react'
import { val } from 'value-enhancer'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, click } from '../../../../test/support/render.tsx'
import { WorkbenchCanvas } from './editor/workbenchCanvas.tsx'
import FlowWorkspace from './flowWorkspace.tsx'
import { RunControl } from './runs/runControl.tsx'
import { runDrawerPreferenceKey } from './runs/runDrawerPreference.ts'
import { WorkspaceDiagnosticsIsland } from './shell/workspaceDiagnosticsIsland.tsx'
import { WorkspacePublishIsland } from './shell/workspacePublishIsland.tsx'

const boundary = vi.hoisted(() => ({
  canvas: undefined as ComponentProps<typeof WorkbenchCanvas> | undefined,
  publish: undefined as ComponentProps<typeof WorkspacePublishIsland> | undefined,
  diagnostics: undefined as ComponentProps<typeof WorkspaceDiagnosticsIsland> | undefined,
  run: undefined as ComponentProps<typeof RunControl> | undefined,
}))
const preferences = new Map<string, string>()
vi.mock('./editor/workbenchCanvas.tsx', () => ({
  WorkbenchCanvas: forwardRef((_props: ComponentProps<typeof WorkbenchCanvas>, _ref) => {
    boundary.canvas = _props
    return (
      <>
        {_props.runControl}
        {_props.cornerLeading}
        {_props.bottomRightTools}
      </>
    )
  }),
}))
vi.mock('./runs/runControl.tsx', () => ({
  RunControl: (props: ComponentProps<typeof RunControl>) => {
    boundary.run = props
    return (
      <button disabled={props.disabled} onClick={props.onRun}>
        Run
      </button>
    )
  },
}))
vi.mock('./shell/workspacePublishIsland.tsx', () => ({
  WorkspacePublishIsland: (props: ComponentProps<typeof WorkspacePublishIsland>) => {
    boundary.publish = props
    return (
      <>
        <button onClick={props.onPublish}>Publish</button>
        <button onClick={props.onOpenPublications}>Publications</button>
        <button onClick={props.onOpenRuns}>History</button>
      </>
    )
  },
}))
vi.mock('./shell/workspaceDiagnosticsIsland.tsx', () => ({
  WorkspaceDiagnosticsIsland: (props: ComponentProps<typeof WorkspaceDiagnosticsIsland>) => {
    boundary.diagnostics = props
    return <button onClick={() => props.onSelectNode('start')}>Locate issue</button>
  },
}))
vi.mock('./runs/runStatusIsland.tsx', () => ({
  RunStatusIslandContainer: ({ onToggle }: { onToggle: () => void }) => <button onClick={onToggle}>Toggle logs</button>,
}))
vi.mock('./runs/runDrawer.tsx', () => ({
  RunDrawer: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <aside aria-label="Run logs">
        <button onClick={onClose}>Close logs</button>
      </aside>
    ) : null,
}))
vi.mock('./editor/editorContextPanel.tsx', () => ({ EditorContextPanel: ({ title }: { title: ReactNode }) => <aside aria-label="Inspector">{title}</aside> }))
const value = val
beforeEach(() => {
  preferences.clear()
  boundary.canvas = undefined
  boundary.run = undefined
})
function set(source: unknown, next: unknown) {
  act(() => (source as Val<unknown>).set(next))
}
function renderWorkspace(busy?: string, withTrigger = true, invalid = false, selectedNodeIds: readonly string[] = [], hasUnpublishedChanges = true) {
  const navigation = {
    $: { view: value('design') },
    open: vi.fn(),
    openFlows: vi.fn(),
    openMainFlow: vi.fn(),
  } as unknown as NavigationStore
  const store = {
    preferences: { getItem: (key: string) => preferences.get(key) ?? null, setItem: (key: string, stored: string) => preferences.set(key, stored) },
    $: {
      busy: value(busy),
      runEventNodes: value({}),
      connectorSetupPending: value(false),
      variableNames: value([]),
      variableNamesLoaded: value(false),
      variableNamesLoading: value(false),
      diagnostics: value(invalid ? { valid: false, diagnostics: [{ code: 'trigger.connection-missing' }] } : undefined),
      diagnosticItems: value(
        invalid
          ? [
              {
                diagnostic: {
                  code: 'trigger.connection-missing',
                  column: 0,
                  line: 1,
                  message: 'Missing account',
                  path: '/document/graph/nodes/start/bindingId',
                },
                location: { nodeId: 'start', section: 'account' },
                scope: 'node',
              },
            ]
          : [],
      ),
      designer: value({
        nodes: withTrigger ? [{ id: 'start', kind: 'trigger', title: 'Start', presentation: { kind: 'start', schedules: [] } }] : [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
      designerNodeById: value(new Map([['start', { kind: 'trigger', title: 'Start' }]])),
      selectedDesignerNode: value(undefined),
    },
    connectors: {
      $: {
        pickerConnections: value([]),
        actionLoading: value(undefined),
        connectionLoading: value(undefined),
        selectedAction: value(undefined),
        selectedActionError: value(undefined),
        selectedActiveConnections: value([]),
        selectedAuthorizationPending: value(false),
        selectedConnection: value(undefined),
        selectedConnectionError: value(undefined),
      },
    },
    connectorAccess: { $: value({}) },
    addNode: vi.fn().mockResolvedValue('new-node'),
    selectNodes: vi.fn(),
    editDraftRunInputs: vi.fn().mockResolvedValue('input'),
    requestDraftRun: vi.fn().mockResolvedValue('started'),
    requestLiveRun: vi.fn().mockResolvedValue('started'),
    runRequests: {
      $: { submitting: value(undefined), inputRequest: value(undefined) },
      dismissInputs: vi.fn(),
      inputStatus: vi.fn(() => 'none'),
    },
    publications: {
      $: { bindings: value({ status: 'idle', bindings: [] }) },
      loadBindings: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(true),
    },
    runs: {
      $: {
        externalRunId: value(undefined),
        cancelingRunId: value(undefined),
        eventFilter: value('all'),
        events: value([]),
        eventsExpiresAt: value(undefined),
        historyComplete: value(true),
        observationFailed: value(false),
        result: value(undefined),
        resolvingActions: value({}),
        run: value(undefined),
      },
    },
    triggers: {
      catalog: { state: value({ data: undefined, refreshing: false, error: undefined }), open: vi.fn() },
      $: {
        connectionLoading: value(undefined),
        selectedActiveConnections: value([]),
        selectedAuthorizationPending: value(false),
        selectedConnection: value(undefined),
        selectedConnectionError: value(undefined),
      },
    },
    workspace: {
      history$: value({ canUndo: false, canRedo: false, applying: false, failed: false }),
      $: {
        addNodeOptions: value([]),
        checkLoading: value(false),
        diagnosticFocus: value(undefined),
        draft: value({
          flowId: 'flow',
          revisionId: 'revision',
          content: { document: { bindings: {}, graph: { edges: [], nodes: withTrigger ? { start: { inputDefs: [], kind: 'start', name: 'Start' } } : {} } } },
        }),
        moduleEditor: value(undefined),
        flow: value({ flowId: 'flow', name: 'Example flow' }),
        flowId: value('flow'),
        live: value({ hasUnpublishedChanges }),
        inspectorDiagnostics: value([]),
        nodeFocus: value(undefined),
        revision: value({}),
        selectedNodeIds: value(selectedNodeIds),
        selection: value(undefined),
        status: value('saved'),
        targetName: value('Flow'),
        workspaceLoadFailed: value(false),
        workspaceLoadProblem: value(undefined),
        workspaceLoading: value(false),
        workspaceRepairing: value(false),
      },
      locateNode: vi.fn(),
      locateDiagnostic: vi.fn(),
      check: vi.fn(),
      repairWorkspace: vi.fn(),
    },
  } as unknown as WorkbenchStore
  const view = render(<FlowWorkspace hrefFor={() => '/'} navigation={navigation} store={store} theme="light" />)
  const button = (label: string) => [...view.container.querySelectorAll('button')].find((element) => element.textContent === label)!
  return { ...view, button, store, navigation }
}

it('keeps Run inputs across draft saves and dismisses them on workflow changes', () => {
  const { store } = renderWorkspace()
  vi.mocked(store.runRequests.dismissInputs).mockClear()
  set(store.workspace.$.draft, { ...store.workspace.$.draft.value, revisionId: 'saved' })
  expect(store.runRequests.dismissInputs).not.toHaveBeenCalled()
  set(store.workspace.$.flowId, 'other')
  expect(store.runRequests.dismissInputs).toHaveBeenCalledOnce()
})

it.each([false, true])('runs with unrelated diagnostics=%s and reveals logs without persisting a preference', async (invalid) => {
  const { button, container, store } = renderWorkspace(undefined, true, invalid)
  await click(button('Run'))
  expect(store.requestDraftRun).toHaveBeenCalledWith('start')
  expect(container.querySelector('[aria-label="Run logs"]')).not.toBeNull()
  expect(preferences.has(runDrawerPreferenceKey)).toBe(false)
})

it.each([false, true])('preserves explicit drawer preference %s during submission and external runs', async (open) => {
  preferences.set(runDrawerPreferenceKey, String(open))
  const view = renderWorkspace()
  set(view.store.runRequests.$.submitting, 'draft')
  expect(view.navigation.open).toHaveBeenCalledWith('design')
  expect(view.container.querySelector('[aria-label="Run logs"]') != null).toBe(open)
  set(view.store.runs.$.externalRunId, 'external')
  await click(view.button('Run'))
  expect(view.container.querySelector('[aria-label="Run logs"]') != null).toBe(open)
})

it.each([false, true])('persists manual drawer state %s across remounts', async (open) => {
  const first = renderWorkspace()
  await click(first.button('Toggle logs'))
  if (!open) await click(first.button('Close logs'))
  expect(preferences.get(runDrawerPreferenceKey)).toBe(String(open))
  first.unmount()
  const next = renderWorkspace()
  expect(next.container.querySelector('[aria-label="Run logs"]') != null).toBe(open)
})

it('keeps manual closing while an in-flight run completes', async () => {
  const view = renderWorkspace()
  let complete!: (result: 'started') => void
  vi.mocked(view.store.requestDraftRun).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve
    }),
  )
  await click(view.button('Run'))
  await click(view.button('Toggle logs'))
  await click(view.button('Close logs'))
  await act(async () => complete('started'))
  expect(view.container.querySelector('[aria-label="Run logs"]')).toBeNull()
})

it('reveals external runs once when no explicit preference exists', () => {
  const view = renderWorkspace()
  set(view.store.runs.$.externalRunId, 'external')
  expect(view.container.querySelector('[aria-label="Run logs"]')).not.toBeNull()
  expect(preferences.has(runDrawerPreferenceKey)).toBe(false)
})

it.each(['designer', 'run'])('keeps authoring and testing available during %s', (busy) => {
  const { button } = renderWorkspace(busy)
  expect(button('Run').disabled).toBe(false)
  expect(boundary.canvas!.disabled).toBe(false)
  expect(boundary.run!.starting).toBe(busy === 'run')
})

it('hides testing without a trigger and prefers Start to an earlier event trigger', () => {
  const view = renderWorkspace(undefined, false)
  expect(view.button('Run')).toBeUndefined()
  set(view.store.$.designer, {
    nodes: [
      { id: 'timer', kind: 'trigger', title: 'Schedule', presentation: { kind: 'cron', schedules: [] } },
      { id: 'start', kind: 'trigger', title: 'Start', presentation: { kind: 'start', schedules: [] } },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  })
  expect(boundary.run!.selectedTriggerId).toBe('start')
  act(() => boundary.run!.onSelectTrigger('timer'))
  expect(boundary.run!.selectedTriggerId).toBe('timer')
  expect(view.store.requestDraftRun).not.toHaveBeenCalled()
  expect(view.navigation.open).not.toHaveBeenCalled()
})

it('publishes and opens publication/run history while clearing Run input requests', async () => {
  const view = renderWorkspace()
  vi.mocked(view.store.runRequests.dismissInputs).mockClear()
  await click(view.button('Publish'))
  expect(view.store.publications.publish).toHaveBeenCalledOnce()
  await click(view.button('Publications'))
  expect(view.navigation.open).toHaveBeenLastCalledWith('publications')
  await click(view.button('History'))
  expect(view.navigation.open).toHaveBeenLastCalledWith('runs')
  expect(view.store.runRequests.dismissInputs).toHaveBeenCalledTimes(2)
})

it.each([
  { busy: undefined, invalid: false, changed: true, state: 'ready' },
  { busy: 'publish', invalid: false, changed: true, state: 'publishing' },
  { busy: 'run', invalid: false, changed: true, state: 'busy' },
  { busy: undefined, invalid: true, changed: true, state: 'issues' },
  { busy: undefined, invalid: false, changed: false, state: 'current' },
])('reports publication state $state and keeps history available', async ({ busy, invalid, changed, state }) => {
  const view = renderWorkspace(busy, true, invalid, [], changed)
  expect(boundary.publish!.state).toBe(state)
  await click(view.button('Publications'))
  expect(view.navigation.open).toHaveBeenCalledWith('publications')
})

it.each([undefined, 'implicit', 'selectable'])('exports SVG only with selectable connector access (%s)', (mode) => {
  const view = renderWorkspace()
  set(view.store.connectorAccess.$, { access: mode == null ? undefined : { mode } })
  expect(typeof boundary.publish!.onExportSvg === 'function').toBe(mode === 'selectable')
  set(view.store.$.designer, { nodes: [], viewport: { x: 0, y: 0, zoom: 1 } })
  expect(boundary.publish!.onExportSvg).toBeUndefined()
})

it('updates canvas annotations with draft and unsaved code state', () => {
  const view = renderWorkspace()
  expect(boundary.canvas!.annotationContext).toMatchObject({ revisionId: 'revision', syncState: 'saved' })
  set(view.store.workspace.$.moduleEditor, { status: 'dirty' })
  expect(boundary.canvas!.annotationContext).toMatchObject({ syncState: 'dirty' })
  set(view.store.workspace.$.draft, { ...view.store.workspace.$.draft.value, revisionId: 'next' })
  set(view.store.workspace.$.moduleEditor, undefined)
  expect(boundary.canvas!.annotationContext).toMatchObject({ revisionId: 'next', syncState: 'saved' })
  set(view.store.workspace.$.flowId, 'other')
  expect(boundary.canvas!.annotationContext).toBeUndefined()
})

it.each([false, true])('reveals properties only when diagnostic location succeeds (%s)', async (located) => {
  const view = renderWorkspace(undefined, true, true)
  vi.mocked(view.store.workspace.locateNode).mockReturnValue(located)
  await click(view.button('Locate issue'))
  expect(view.store.workspace.locateNode).toHaveBeenCalledWith('start')
  expect(view.container.querySelector('[aria-label="Inspector"]') != null).toBe(located)
})

it.each([
  { nodeId: 'new-node', revisionId: 'revision', loading: false, setup: false, reveal: true },
  { nodeId: undefined, revisionId: 'revision', loading: false, setup: false, reveal: false },
  { nodeId: 'start', revisionId: 'revision', loading: false, setup: false, reveal: false },
  { nodeId: 'new-node', revisionId: 'old', loading: false, setup: false, reveal: false },
  { nodeId: 'new-node', revisionId: 'revision', loading: true, setup: false, reveal: false },
  { nodeId: 'new-node', revisionId: 'revision', loading: false, setup: true, reveal: false },
])(
  'reveals newly created node errors only after current validation and account setup: $nodeId/$revisionId/$loading/$setup',
  async ({ nodeId, revisionId, loading, setup, reveal }) => {
    const view = renderWorkspace(undefined, true, true, ['new-node'])
    set(view.store.$.diagnostics, { revisionId, valid: false })
    set(view.store.$.diagnosticItems, nodeId == null ? [] : [{ location: { nodeId, section: 'node' } }])
    set(view.store.workspace.$.checkLoading, loading)
    set(view.store.$.connectorSetupPending, setup)
    await act(async () => {
      await boundary.canvas!.onAddNode({ kind: 'new-task', id: 'new-task', label: 'Task', description: '', inputs: [], outputs: [] }, { x: 92, y: 92 })
    })
    expect(view.store.addNode).toHaveBeenCalledWith(
      { kind: 'new-task', id: 'new-task', label: 'Task', description: '', inputs: [], outputs: [] },
      { x: 92, y: 92 },
      undefined,
    )
    expect(view.container.querySelector('[aria-label="Inspector"]') != null).toBe(reveal)
    expect(preferences.has('open-flow:inspector-open')).toBe(false)
  },
)

it.each(['new-node', undefined])('preserves an open inspector when node creation returns %s', async (nodeId) => {
  preferences.set('open-flow:inspector-open', 'true')
  const view = renderWorkspace()
  vi.mocked(view.store.selectNodes).mockImplementation((ids) => set(view.store.workspace.$.selectedNodeIds, ids))
  vi.mocked(view.store.addNode).mockResolvedValue(nodeId)
  expect(view.container.querySelector('[aria-label="Inspector"]')!.textContent).toBe(view.i18n.t('inspector.outline'))
  await act(async () => {
    expect(await boundary.canvas!.onAddNode({ kind: 'new-task', id: 'task', label: 'Task', description: '', inputs: [], outputs: [] }, { x: 0, y: 0 })).toBe(
      nodeId,
    )
  })
  if (nodeId == null) expect(view.store.selectNodes).not.toHaveBeenCalled()
  else expect(view.store.selectNodes).toHaveBeenCalledWith([nodeId])
  expect(view.container.querySelector('[aria-label="Inspector"]')!.textContent).toBe(view.i18n.t(nodeId == null ? 'inspector.outline' : 'inspector.title'))
})

it.each([{ selection: [] }, { selection: ['start'] }, { selection: ['new-node', 'start'] }])(
  'does not reopen the inspector for delayed errors after selection changes to %j',
  async ({ selection }) => {
    const view = renderWorkspace(undefined, true, false, ['new-node'])
    set(view.store.workspace.$.checkLoading, true)
    await act(async () => {
      await boundary.canvas!.onAddNode({ kind: 'new-task', id: 'task', label: 'Task', description: '', inputs: [], outputs: [] }, { x: 0, y: 0 })
    })
    set(view.store.workspace.$.selectedNodeIds, selection)
    set(view.store.$.diagnostics, { revisionId: 'revision', valid: false })
    set(view.store.$.diagnosticItems, [{ location: { nodeId: 'new-node', section: 'node' } }])
    set(view.store.workspace.$.checkLoading, false)
    expect(view.container.querySelector('[aria-label="Inspector"]')).toBeNull()
  },
)
