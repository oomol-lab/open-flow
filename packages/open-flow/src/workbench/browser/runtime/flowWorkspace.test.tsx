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

vi.mock('./designer/workbenchDesigner.tsx', () => ({ WorkbenchDesigner: () => null }))

const value = <T,>(current: T): { readonly value: T } => ({ value: current })

function renderWorkspace(busy?: string, withTrigger = true) {
  const navigation = {
    $: { view: value('design') },
    open: vi.fn(),
    openFlows: vi.fn(),
    openMainFlow: vi.fn(),
  } as unknown as NavigationStore
  const store = {
    $: {
      busy: value(busy),
      diagnostics: value(undefined),
      designer: value({ nodes: withTrigger ? [{ kind: 'trigger' }] : [], viewport: { x: 0, y: 0, zoom: 1 } }),
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
    requestDraftRun: vi.fn().mockResolvedValue('started'),
    requestLiveRun: vi.fn().mockResolvedValue('started'),
    runRequests: {
      $: { submitting: value(undefined), inputRequest: value(undefined) },
      dismissInputs: vi.fn(),
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
  const editor = (main.props.children as ReactElement[])[2]!
  return { editor, navigation, store }
}

describe('FlowWorkspace run drawer', () => {
  beforeEach(() => {
    mocks.setOpen.mockReset()
    mocks.setVisible.mockReset()
    mocks.stateCall = 0
  })

  it('opens the log panel after running from the canvas', async () => {
    const { editor } = renderWorkspace()
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    designer.props.runControl.props.children[0].props.onClick()
    await Promise.resolve()
    expect(mocks.setVisible).toHaveBeenCalledWith(true)
    expect(mocks.setOpen).toHaveBeenCalledWith(true)
  })

  it('hides execution when the graph has no trigger', () => {
    const { editor } = renderWorkspace(undefined, false)
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!
    expect(designer.props.runControl).toBeUndefined()
  })

  it('keeps the Designer editable while preparing a run', () => {
    const { editor } = renderWorkspace('run')
    const view = (editor.type as (props: typeof editor.props) => ReactElement)(editor.props)
    const designer = (view.props.children as ReactElement[])[0]!

    expect(designer.props.disabled).toBe(false)
  })
})
