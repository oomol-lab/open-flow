import type { ReactElement } from 'react'
import type { NavigationStore } from './navigation.ts'
import type { WorkbenchStore } from './stores/workbenchStore.ts'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import FlowWorkspace from './flowWorkspace.tsx'

const mocks = vi.hoisted(() => ({
  setOpen: vi.fn(),
  setVisible: vi.fn(),
  stateCall: 0,
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
  useRef: vi.fn(() => ({ current: undefined })),
  useState: vi.fn(() => (mocks.stateCall++ == 0 ? [false, mocks.setVisible] : [false, mocks.setOpen])),
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

function renderWorkspace(busy?: string, withTrigger = true, invalid = false) {
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
      designer: value({ nodes: withTrigger ? [{ id: 'start', kind: 'trigger', title: 'Start' }] : [], viewport: { x: 0, y: 0, zoom: 1 } }),
      selectedDesignerNode: value(undefined),
    },
    connectors: {
      $: {
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
    addNode: vi.fn().mockResolvedValue('new-node'),
    editDraftRunInputs: vi.fn().mockResolvedValue('input'),
    requestDraftRun: vi.fn().mockResolvedValue('started'),
    requestLiveRun: vi.fn().mockResolvedValue('started'),
    runRequests: {
      $: { submitting: value(undefined), inputRequest: value(undefined) },
      dismissInputs: vi.fn(),
      inputStatus: vi.fn(() => 'none'),
    },
    runs: { $: { externalRunId: value(undefined) } },
    triggers: {
      $: {
        connectionLoading: value(undefined),
        selectedActiveConnections: value([]),
        selectedAuthorizationPending: value(false),
        selectedConnection: value(undefined),
        selectedConnectionError: value(undefined),
      },
    },
    workspace: {
      $: {
        addNodeOptions: value([]),
        diagnosticFocus: value(undefined),
        draft: value({ revisionId: 'revision' }),
        flowId: value('flow'),
        inspectorDiagnostics: value([]),
        nodeFocus: value(undefined),
        revision: value({}),
        selectedNodeIds: value([]),
        selection: value(undefined),
        target: value({ kind: 'flow' }),
        targetName: value('Flow'),
        workspaceLoadFailed: value(false),
        workspaceLoading: value(false),
      },
    },
  } as unknown as WorkbenchStore
  const element = FlowWorkspace({
    hrefFor: () => '/',
    navigation,
    store,
    theme: 'light',
  })
  const main = element.props.children as ReactElement
  const editor = (main.props.children as ReactElement[])[1]!
  return { editor, navigation, store }
}

describe('FlowWorkspace run drawer', () => {
  beforeEach(() => {
    mocks.setOpen.mockReset()
    mocks.setVisible.mockReset()
    mocks.stateCall = 0
  })

  it.each([false, true])('runs from the canvas and opens logs despite unrelated diagnostics (invalid: %s)', async (invalid) => {
    const { editor, store } = renderWorkspace(undefined, true, invalid)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    expect(designer.props.runControl.props.disabled).toBe(false)
    designer.props.runControl.props.onRun()
    await Promise.resolve()
    expect(store.requestDraftRun).toHaveBeenCalledWith('start')
    expect(mocks.setVisible).toHaveBeenCalledWith(true)
    expect(mocks.setOpen).toHaveBeenCalledWith(true)
  })

  it.each(['new-node', undefined])('opens node details only after a successful addition: %s', async (nodeId) => {
    const { editor, store } = renderWorkspace()
    vi.mocked(store.addNode).mockResolvedValue(nodeId)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    mocks.setOpen.mockClear()
    const option = { kind: 'new-task', executor: 'llm' }
    const position = { x: 92, y: 92 }

    expect(await designer.props.onAddNode(option, position)).toBe(nodeId)
    expect(store.addNode).toHaveBeenCalledWith(option, position, undefined)
    if (nodeId == null) expect(mocks.setOpen).not.toHaveBeenCalled()
    else expect(mocks.setOpen).toHaveBeenCalledWith('inspector')
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
})
