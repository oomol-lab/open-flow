import type { ReactElement } from 'react'
import type { NavigationStore } from './navigation.ts'
import type { WorkbenchStore } from './stores/workbenchStore.ts'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import FlowWorkspace, { FlowEditor } from './flowWorkspace.tsx'

const mocks = vi.hoisted(() => ({
  setOpen: vi.fn(),
  setRunDrawerOpen: vi.fn(),
  stateCall: 0,
  stateValues: new Map<number, unknown>(),
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useRef: vi.fn(() => ({ current: undefined })),
  useState: vi.fn((initial: unknown) => {
    const call = mocks.stateCall++
    const value = mocks.stateValues.has(call) ? mocks.stateValues.get(call) : typeof initial == 'function' ? initial() : initial
    return [value, call == 0 ? mocks.setRunDrawerOpen : mocks.setOpen]
  }),
}))

vi.mock('use-value-enhancer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('use-value-enhancer')>()),
  useVal: (value: { readonly value: unknown }) => value.value,
}))

vi.mock('val-i18n-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('val-i18n-react')>()),
  useTranslate: () => (key: string) => key,
}))

vi.mock('./editor/workbenchCanvas.tsx', () => ({ WorkbenchCanvas: () => null }))

const value = <T,>(current: T): { readonly value: T } => ({ value: current })

function renderWorkspace(busy?: string, withTrigger = true, invalid = false, selectedNodeIds: readonly string[] = [], hasUnpublishedChanges = true) {
  const navigation = {
    $: { view: value('design') },
    open: vi.fn(),
    openFlows: vi.fn(),
    openMainFlow: vi.fn(),
  } as unknown as NavigationStore
  const store = {
    $: {
      busy: value(busy),
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
      designer: value({ nodes: withTrigger ? [{ id: 'start', kind: 'trigger', title: 'Start' }] : [], viewport: { x: 0, y: 0, zoom: 1 } }),
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
    publications: { publish: vi.fn().mockResolvedValue(true) },
    runs: { $: { externalRunId: value(undefined) } },
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
        draft: value({ revisionId: 'revision' }),
        flow: value({ flowId: 'flow', name: 'Example flow' }),
        flowId: value('flow'),
        live: value({ hasUnpublishedChanges }),
        inspectorDiagnostics: value([]),
        nodeFocus: value(undefined),
        revision: value({}),
        selectedNodeIds: value(selectedNodeIds),
        selection: value(undefined),
        status: value('saved'),
        target: value({ kind: 'flow' }),
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
  const element = FlowWorkspace({
    hrefFor: () => '/',
    navigation,
    store,
    theme: 'light',
  })
  const main = element.props.children as ReactElement
  const editor = (main.props.children as ReactElement[]).find((child) => child.type == FlowEditor)!
  return { editor, navigation, store }
}

describe('FlowWorkspace run drawer', () => {
  beforeEach(() => {
    mocks.setOpen.mockReset()
    mocks.setRunDrawerOpen.mockReset()
    mocks.stateCall = 0
    mocks.stateValues.clear()
  })

  it.each([false, true])('runs from the canvas and opens logs despite unrelated diagnostics (invalid: %s)', async (invalid) => {
    const { editor, store } = renderWorkspace(undefined, true, invalid)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    expect(designer.props.runControl.props.disabled).toBe(false)
    designer.props.runControl.props.onRun()
    await Promise.resolve()
    expect(store.requestDraftRun).toHaveBeenCalledWith('start')
    expect(mocks.setRunDrawerOpen).toHaveBeenCalledWith(true)
  })

  it('keeps the test button enabled while ordinary edits save', () => {
    const { editor } = renderWorkspace('designer')
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    expect(designer.props.runControl.props.disabled).toBe(false)
    expect(designer.props.runControl.props.starting).toBe(false)
  })

  it.each(['new-node', undefined])('preserves inspector state when adding a node: %s', async (nodeId) => {
    const { editor, store } = renderWorkspace()
    vi.mocked(store.addNode).mockResolvedValue(nodeId)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    mocks.setOpen.mockClear()
    const option = { kind: 'new-task', executor: 'llm' }
    const position = { x: 92, y: 92 }

    expect(await designer.props.onAddNode(option, position)).toBe(nodeId)
    expect(store.addNode).toHaveBeenCalledWith(option, position, undefined)
    expect(mocks.setOpen).not.toHaveBeenCalled()
  })

  it('switches an open inspector to the added node properties', async () => {
    mocks.stateValues.set(3, true)
    mocks.stateValues.set(4, 'outline')
    const { editor, store } = renderWorkspace()
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    const option = { kind: 'new-task', executor: 'llm' }
    const position = { x: 92, y: 92 }

    mocks.setOpen.mockClear()
    expect(await designer.props.onAddNode(option, position)).toBe('new-node')

    expect(store.selectNodes).toHaveBeenCalledWith(['new-node'])
    expect(mocks.setOpen).toHaveBeenCalledWith('properties')
  })

  it('hides execution when the graph has no trigger', () => {
    const { editor } = renderWorkspace(undefined, false)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    expect(designer.props.runControl).toBeUndefined()
  })

  it('switches the test trigger without navigating or starting a run', () => {
    const { editor, navigation, store } = renderWorkspace()
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!

    designer.props.runControl.props.onSelectTrigger('another-trigger')

    expect(store.runRequests.dismissInputs).toHaveBeenCalledOnce()
    expect(store.requestDraftRun).not.toHaveBeenCalled()
    expect(navigation.open).not.toHaveBeenCalled()
  })

  it('keeps the Designer editable while preparing a run', () => {
    const { editor } = renderWorkspace('run')
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!

    expect(designer.props.disabled).toBe(false)
  })

  it('publishes from the corner island and opens publication or run history from its menu', () => {
    const { editor, navigation, store } = renderWorkspace()
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    const publishIsland = designer.props.cornerLeading.props.children[1]

    expect(publishIsland.props.state).toBe('ready')
    publishIsland.props.onPublish()
    expect(store.publications.publish).toHaveBeenCalledOnce()

    publishIsland.props.onOpenPublications()
    expect(store.runRequests.dismissInputs).toHaveBeenCalledOnce()
    expect(navigation.open).toHaveBeenCalledWith('publications')

    publishIsland.props.onOpenRuns()
    expect(store.runRequests.dismissInputs).toHaveBeenCalledTimes(2)
    expect(navigation.open).toHaveBeenCalledWith('runs')
  })

  it('keeps publication history available when publishing is blocked', () => {
    const { editor, navigation } = renderWorkspace(undefined, true, true)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    const publishIsland = designer.props.cornerLeading.props.children[1]

    expect(publishIsland.props.state).toBe('issues')
    publishIsland.props.onOpenPublications()
    expect(navigation.open).toHaveBeenCalledWith('publications')
  })

  it.each([false, true])('opens node properties when locating an issue with the sidebar open: %s', (open) => {
    mocks.stateValues.set(3, open)
    mocks.stateValues.set(4, 'outline')
    const { editor, store } = renderWorkspace(undefined, true, true)
    vi.mocked(store.workspace.locateNode).mockReturnValue(true)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    const [issues, publish] = designer.props.cornerLeading.props.children

    expect(issues.props.items).toHaveLength(1)
    expect(publish.props.state).toBe('issues')
    issues.props.onSelectNode('start')
    expect(store.workspace.locateNode).toHaveBeenCalledWith('start')
    expect(mocks.setOpen).toHaveBeenCalledWith(true)
    expect(mocks.setOpen).toHaveBeenCalledWith('properties')
    expect(mocks.setOpen).toHaveBeenCalledWith(false)
  })

  it('keeps the sidebar and issues unchanged when the diagnostic node cannot be located', () => {
    const { editor, store } = renderWorkspace(undefined, true, true)
    vi.mocked(store.workspace.locateNode).mockReturnValue(false)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    const issues = designer.props.cornerLeading.props.children[0]
    mocks.setOpen.mockClear()

    issues.props.onSelectNode('missing')

    expect(store.workspace.locateNode).toHaveBeenCalledWith('missing')
    expect(mocks.setOpen).not.toHaveBeenCalled()
  })

  it.each([
    ['publish', 'publishing'],
    ['run', 'busy'],
  ])('identifies why publishing is unavailable during %s', (busy, state) => {
    const { editor } = renderWorkspace(busy)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!

    expect(designer.props.cornerLeading.props.children[1].props.state).toBe(state)
  })

  it('marks an unchanged draft as current', () => {
    const { editor } = renderWorkspace(undefined, true, false, [], false)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!

    expect(designer.props.cornerLeading.props.children[1].props.state).toBe('current')
  })

  it.each([
    { page: 'outline', selectedNodeIds: [] },
    { page: 'properties', selectedNodeIds: ['start', 'task'] },
  ])('focuses a node selected from the $page node list', ({ page, selectedNodeIds }) => {
    mocks.stateValues.set(3, true)
    mocks.stateValues.set(4, page)
    const { editor, store } = renderWorkspace(undefined, true, false, selectedNodeIds)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const contextPanel = (view.props.children as ReactElement[])[1]!
    const panelChildren = contextPanel.props.children as ReactElement[]
    const nodeList = page == 'outline' ? panelChildren[0]!.props.children.props.children : panelChildren[1]!

    nodeList.props.onSelect('start')

    expect(store.selectNodes).toHaveBeenCalledWith(['start'])
    expect(store.workspace.locateNode).toHaveBeenCalledWith('start', { preserveSelection: true })
  })

  it.each([
    { page: 'outline', selectedNodeIds: [] },
    { page: 'properties', selectedNodeIds: ['start', 'task'] },
  ])('keeps the $page node list open when locating a node', ({ page, selectedNodeIds }) => {
    mocks.stateValues.set(3, true)
    mocks.stateValues.set(4, page)
    const { editor, store } = renderWorkspace(undefined, true, false, selectedNodeIds)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const contextPanel = (view.props.children as ReactElement[])[1]!
    const panelChildren = contextPanel.props.children as ReactElement[]
    const nodeList = page == 'outline' ? panelChildren[0]!.props.children.props.children : panelChildren[1]!

    nodeList.props.onFocusNode('start')

    expect(store.selectNodes).not.toHaveBeenCalled()
    expect(store.workspace.locateNode).toHaveBeenCalledWith('start', { preserveSelection: true })
  })
})
