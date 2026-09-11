import type { ReactElement } from 'react'
import type { WorkbenchLocation, WorkbenchTheme } from './contract.ts'
import type { AddNodeOption } from './editor/addNodeOptions.ts'
import type { WorkbenchCanvasHandle } from './editor/workbenchCanvas.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { NodeActions } from '../../../canvas/browser/nodeActions.tsx'
import { useIgnoredNodes } from '../../../canvas/browser/useIgnoredNodes.ts'
import { nodeNameIssue } from '../../../flow/common/change.ts'
import { Button } from '../../../ui/browser/button.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../ui/browser/empty.tsx'
import { IconifyProvider } from '../../../ui/browser/icons/iconifyContext.tsx'
import { CanvasHistoryScope } from './editor/canvasHistoryScope.tsx'
import { CommentInspector } from './editor/commentInspector.tsx'
import { BlockLibrary, ContextPanel } from './editor/contextPanel.tsx'
import { NodeHeading } from './editor/nodeHeading.tsx'
import { inspectorIcon, NodeInspector } from './editor/nodeInspector.tsx'
import { WorkbenchCanvas } from './editor/workbenchCanvas.tsx'
import { Icon } from './icons.tsx'
import { NavigationStore } from './navigation.ts'
import { PublicationsView } from './publications/publicationsView.tsx'
import { RunControl } from './runs/runControl.tsx'
import { RunDrawer } from './runs/runDrawer.tsx'
import { RunInputPanel } from './runs/runInputPanel.tsx'
import { RunResults } from './runs/runResults.tsx'
import { RunsView } from './runs/runsView.tsx'
import { WorkspaceHeader } from './shell/workspaceHeader.tsx'
import { WorkbenchStore } from './stores/workbenchStore.ts'

type ContextPanelMode = 'blocks' | 'inspector' | 'notification' | undefined

function RunDrawerContainer({
  onClose,
  onConfigureConnector,
  onToggle,
  open,
  store,
  visible,
}: {
  readonly onClose: () => void
  readonly onConfigureConnector?: (() => void) | undefined
  readonly onToggle: () => void
  readonly open: boolean
  readonly store: WorkbenchStore
  readonly visible: boolean
}): ReactElement | null {
  const cancelingRunId = useVal(store.runs.$.cancelingRunId)
  const eventFilter = useVal(store.runs.$.eventFilter)
  const events = useVal(store.runs.$.events)
  const eventsExpiresAt = useVal(store.runs.$.eventsExpiresAt)
  const eventNodes = useVal(store.$.runEventNodes)
  const historyComplete = useVal(store.runs.$.historyComplete)
  const observationFailed = useVal(store.runs.$.observationFailed)
  const result = useVal(store.runs.$.result)
  const resolvingAction = useVal(store.runs.$.resolvingAction)
  const run = useVal(store.runs.$.run)
  const submitting = useVal(store.runRequests.$.submitting)
  return (
    <RunDrawer
      tools={run == null ? undefined : <RunResults key={run.runId} runId={run.runId} client={store.results} />}
      cancelDisabled={cancelingRunId != null}
      canceling={cancelingRunId == run?.runId}
      eventFilter={eventFilter}
      eventNodes={eventNodes}
      events={events}
      eventsExpiresAt={eventsExpiresAt}
      historyComplete={historyComplete}
      onCancel={() => void store.runs.cancel()}
      onClose={onClose}
      onConfigureConnector={onConfigureConnector}
      onEventFilterChange={(filter) => store.runs.setEventFilter(filter)}
      onLocateEvent={(sequence) => store.locateRunEvent(sequence)}
      onLocateWait={() => {
        if (store.locateRunWait()) onClose()
      }}
      onResolve={(action) => void store.runs.resolve(action)}
      onRetryObservation={() => store.runs.retryObservation()}
      onToggle={onToggle}
      observationFailed={observationFailed}
      open={open}
      result={result}
      resolvingAction={resolvingAction}
      run={run}
      submitting={submitting != null}
      visible={visible}
    />
  )
}

function Editor({
  onRun,
  onRunStarted,
  onCloseRuns,
  onConfigureConnector,
  onToggleRuns,
  runDrawerOpen,
  runDrawerVisible,
  store,
  theme,
}: {
  readonly onRun: (triggerId?: string) => void
  readonly onRunStarted: () => void
  readonly onCloseRuns: () => void
  readonly onConfigureConnector?: (() => void) | undefined
  readonly onToggleRuns: () => void
  readonly runDrawerOpen: boolean
  readonly runDrawerVisible: boolean
  readonly store: WorkbenchStore
  readonly theme: WorkbenchTheme
}): ReactElement {
  const t = useTranslate()
  const addNodeOptions = useVal(store.workspace.$.addNodeOptions)
  const [startId, setStartId] = useState<string>()
  const runInputRequest = useVal(store.runRequests.$.inputRequest)
  const busy = useVal(store.$.busy)
  const history = useVal(store.workspace.history$)
  const designer = useVal(store.$.designer)
  const variableNames = useVal(store.$.variableNames)
  const variableNamesLoaded = useVal(store.$.variableNamesLoaded)
  const variableNamesLoading = useVal(store.$.variableNamesLoading)
  const triggers = designer.nodes.filter((node) => node.kind == 'trigger')
  const selectedTrigger = triggers.find((node) => node.id == startId) ?? triggers[0]
  const diagnosticFocus = useVal(store.workspace.$.diagnosticFocus)
  const draft = useVal(store.workspace.$.draft)
  const inspectorDiagnostics = useVal(store.workspace.$.inspectorDiagnostics)
  const nodeFocus = useVal(store.workspace.$.nodeFocus)
  const flowId = useVal(store.workspace.$.flowId)
  const revision = useVal(store.workspace.$.revision)
  const selectedDesignerNode = useVal(store.$.selectedDesignerNode)
  const selection = useVal(store.workspace.$.selection)
  const selectedNodeIds = useVal(store.workspace.$.selectedNodeIds)
  const target = useVal(store.workspace.$.target)
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes(`${flowId}:${target?.kind}:${target?.kind == 'subflow' ? target.id : ''}`)
  const targetName = useVal(store.workspace.$.targetName)
  const connectorAction = useVal(store.connectors.$.selectedAction)
  const connectorActionError = useVal(store.connectors.$.selectedActionError)
  const connectorActionLoading = useVal(store.connectors.$.actionLoading)
  const connectorAuthorizationPending = useVal(store.connectors.$.selectedAuthorizationPending)
  const connectorConnection = useVal(store.connectors.$.selectedConnection)
  const connectorConnectionError = useVal(store.connectors.$.selectedConnectionError)
  const connectorConnectionLoading = useVal(store.connectors.$.connectionLoading)
  const activeConnectorConnections = useVal(store.connectors.$.selectedActiveConnections)
  const triggerAuthorizationPending = useVal(store.triggers.$.selectedAuthorizationPending)
  const triggerConnection = useVal(store.triggers.$.selectedConnection)
  const triggerConnectionError = useVal(store.triggers.$.selectedConnectionError)
  const triggerConnectionLoading = useVal(store.triggers.$.connectionLoading)
  const triggerActiveConnections = useVal(store.triggers.$.selectedActiveConnections)
  const [contextPanelMode, setContextPanelMode] = useState<ContextPanelMode>()
  const [blocksFocusRequest, setBlocksFocusRequest] = useState(0)
  const blockAddCount = useRef(0)
  const designerRef = useRef<WorkbenchCanvasHandle>(null)
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent): void => {
      if (!store.workspace.hasUnsavedCode) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [store])

  const focusInspectorOnOpen = useRef(false)
  const opener = useRef<HTMLElement>()

  useEffect(() => {
    setStartId(undefined)
    blockAddCount.current = 0
    focusInspectorOnOpen.current = false
    opener.current = undefined
    setContextPanelMode(undefined)
  }, [flowId, target?.kind == 'subflow' ? target.id : undefined, target?.kind])

  useEffect(() => {
    if (diagnosticFocus == null) return
    focusInspectorOnOpen.current = false
    opener.current = undefined
    setContextPanelMode('inspector')
  }, [diagnosticFocus])

  useEffect(() => {
    if (selectedDesignerNode?.kind == 'trigger') setStartId(selectedDesignerNode.id)
  }, [selectedDesignerNode])

  const authoringDisabled = draft == null || history.applying || history.failed || (busy != null && busy != 'designer' && busy != 'run')
  const closeContextPanel = (focusTarget = opener.current): void => {
    setContextPanelMode(undefined)
    focusInspectorOnOpen.current = false
    opener.current = undefined
    globalThis.setTimeout(() => {
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true })
      else designerRef.current?.focusCanvas()
    }, 0)
  }
  const openBlocks = (button?: HTMLButtonElement): void => {
    opener.current = button
    focusInspectorOnOpen.current = false
    setContextPanelMode('blocks')
    setBlocksFocusRequest((request) => request + 1)
  }
  const openInspector = (): void => {
    opener.current = undefined
    focusInspectorOnOpen.current = false
    setContextPanelMode('inspector')
  }
  const openNotification = (button: HTMLButtonElement): void => {
    opener.current = button
    focusInspectorOnOpen.current = false
    setContextPanelMode('notification')
    setBlocksFocusRequest((request) => request + 1)
  }
  const toggleInspector = (button: HTMLButtonElement): void => {
    if (contextPanelMode == 'inspector') {
      closeContextPanel(button)
      return
    }
    opener.current = button
    focusInspectorOnOpen.current = true
    setContextPanelMode('inspector')
  }
  const addFromBlocks = async (option: AddNodeOption): Promise<string | undefined> => {
    const offset = blockAddCount.current * 32
    const canvasPosition = { x: 92 + offset, y: 92 + offset }
    const nodeId = await designerRef.current?.addNode(option, canvasPosition)
    if (nodeId != null) blockAddCount.current++
    return nodeId
  }

  const setNotification = async (option: AddNodeOption): Promise<string | undefined> => {
    if (selection?.kind != 'wait' || option.kind != 'connector') return
    if (!(await store.workspace.setWaitNotification(selection.id, option.connector))) return
    await store.refreshSelectedConnector()
    setContextPanelMode('inspector')
    return selection.id
  }

  const contextPanelVisible = contextPanelMode != null && target != null && (contextPanelMode == 'blocks' || revision != null)

  const historyControls = {
    state: history,
    onUndo: () => void store.workspace.undo(),
    onRedo: () => void store.workspace.redo(),
    onRetry: () => void store.workspace.retryHistorySync(),
  }

  return (
    <CanvasHistoryScope
      history={historyControls}
      disabled={authoringDisabled || target == null}
      aria-labelledby="workspace-tab-design"
      className={`editor-grid ${contextPanelVisible ? '' : 'context-panel-closed'}`}
      id="workspace-panel-design"
      role="tabpanel"
      tabIndex={0}
    >
      <WorkbenchCanvas
        history={historyControls}
        ignoredNodeIds={ignoredNodeIds}
        onIgnoreNodes={onIgnoreNodes}
        runControl={
          target?.kind == 'flow' && draft != null && selectedTrigger != null ? (
            <RunControl
              disabled={busy != null && busy != 'run' && busy != 'designer'}
              inputContent={<RunInputPanel onStarted={onRunStarted} store={store.runRequests} theme={theme} />}
              inputOpen={runInputRequest?.triggerId == selectedTrigger.id}
              inputStatus={store.runRequests.inputStatus(draft.flowId, draft, selectedTrigger.id)}
              onInputOpenChange={(open) => {
                if (open) void store.editDraftRunInputs(selectedTrigger.id)
                else store.runRequests.dismissInputs()
              }}
              onRun={() => onRun(selectedTrigger.id)}
              onSelectTrigger={(triggerId) => {
                store.runRequests.dismissInputs()
                setStartId(triggerId)
              }}
              selectedTriggerId={selectedTrigger.id}
              starting={busy == 'run'}
              triggers={triggers}
            />
          ) : undefined
        }
        addNodeOptions={addNodeOptions}
        blocksOpen={contextPanelVisible && contextPanelMode == 'blocks'}
        disabled={authoringDisabled}
        focusNodeRequest={diagnosticFocus ?? nodeFocus}
        inspectorOpen={contextPanelVisible && contextPanelMode == 'inspector'}
        model={designer}
        onAddNode={async (option, position, connection) => {
          const nodeId = await store.addNode(option, position, connection)
          if (nodeId != null) openInspector()
          return nodeId
        }}
        onConnect={(edge) => void store.workspace.connect(edge)}
        onChangeNodeContentHidden={(nodeId, hidden) => void store.workspace.saveNodeContentHidden(nodeId, hidden)}
        onChangeComment={(nodeId, value) => void store.workspace.saveComment(nodeId, value)}
        onCopy={() => store.workspace.copySelectedNodes()}
        onDeleteEdge={(edge) => void store.workspace.disconnect(edge)}
        onDeleteNodes={() => void store.workspace.deleteSelectedNodes()}
        onDuplicate={(positions, offset) => void store.workspace.duplicateSelectedNodes(positions, offset)}
        onMoveNodes={(positions) => void store.workspace.moveNodes(positions)}
        onMoveViewport={(viewport) => void store.workspace.moveViewport(viewport)}
        onOpenBlocks={openBlocks}
        onOpenInspector={openInspector}
        onPaste={() => void store.workspace.pasteNodes()}
        provideAddNodeOptions={store.provideAddNodeOptions}
        onSelectNodes={(nodeIds) => store.selectNodes(nodeIds)}
        onToggleInspector={toggleInspector}
        ref={designerRef}
        selectedNodeIds={selectedNodeIds}
        target={target}
        theme={theme}
      />
      {contextPanelVisible && (
        <ContextPanel
          heading={
            contextPanelMode === 'inspector' && selection != null ? (
              <NodeHeading
                key={selection.id}
                title={selection.node.name ?? selectedDesignerNode?.title ?? ''}
                icon={selectedDesignerNode != null && 'icon' in selectedDesignerNode ? selectedDesignerNode.icon : undefined}
                disabled={authoringDisabled}
                fallback={<Icon name={inspectorIcon(selection, target)} />}
                onRename={(name) => {
                  void store.workspace.saveNodeTitle(selection.id, name)
                }}
                onIconChange={(icon) => {
                  void store.workspace.saveNodeIcon(selection.id, icon)
                }}
                validate={(name) => {
                  if (revision == null || target == null) return
                  const graph = revision.graph(target)
                  if (graph == null) return
                  const issue = nodeNameIssue(graph, selection.id, name)
                  return issue == null ? undefined : t(`inspector.node.${issue === 'empty' ? 'nameEmpty' : 'nameDuplicate'}`)
                }}
              />
            ) : undefined
          }
          actions={
            contextPanelMode == 'inspector' && selectedDesignerNode != null && selectedDesignerNode.kind != 'comment' ? (
              <NodeActions
                ignored={ignoredNodeIds.includes(selectedDesignerNode.id)}
                onIgnore={(ignored) => onIgnoreNodes([selectedDesignerNode.id], ignored)}
                onDuplicate={selectedDesignerNode.kind == 'trigger' ? undefined : () => void store.workspace.duplicateSelectedNodes()}
                onDelete={authoringDisabled ? undefined : () => void store.workspace.deleteSelectedNodes()}
              />
            ) : undefined
          }
          focusOnOpen={contextPanelMode == 'inspector' && focusInspectorOnOpen.current}
          icon={contextPanelMode == 'blocks' ? 'plus' : contextPanelMode == 'notification' ? 'connection' : inspectorIcon(selection, target)}
          onClose={() => (contextPanelMode == 'notification' ? setContextPanelMode('inspector') : closeContextPanel())}
          theme={theme}
          title={
            contextPanelMode == 'blocks'
              ? t('contextPanel.blocks')
              : contextPanelMode == 'notification'
                ? t('inspector.wait.chooseNotificationTitle')
                : (selectedDesignerNode?.title ?? targetName ?? t('inspector.title'))
          }
        >
          {contextPanelMode == 'blocks' ? (
            <BlockLibrary
              browseOptions={store.browseAddNodeOptions}
              searchOptions={store.provideAddNodeOptions}
              disabled={authoringDisabled}
              focusRequest={blocksFocusRequest}
              onAdd={addFromBlocks}
              onRegisterDragOption={(option) => designerRef.current?.registerAddNodeOption(option)}
              options={addNodeOptions}
              provideChoices={store.provideAddNodeOptionChoices}
            />
          ) : contextPanelMode == 'notification' ? (
            <BlockLibrary
              browseOptions={store.connectors.browseAddNodeOptions}
              searchOptions={async (query, signal) =>
                (await store.connectors.provideAddNodeOptions(query, signal))?.filter((option) => option.kind == 'connector' && option.inputs.length > 0)
              }
              disabled={authoringDisabled}
              draggable={false}
              focusRequest={blocksFocusRequest}
              onAdd={setNotification}
              options={[]}
              provideChoices={async (optionId, signal) =>
                (await store.connectors.provideAddNodeOptionChoices(optionId, signal))?.filter(
                  (option) => option.kind == 'connector' && option.inputs.length > 0,
                )
              }
            />
          ) : selectedDesignerNode?.kind == 'comment' ? (
            <CommentInspector
              key={selectedDesignerNode.id}
              title={selectedDesignerNode.title}
              content={selectedDesignerNode.content ?? ''}
              disabled={authoringDisabled}
              dark={theme == 'dark'}
              onSave={(comment) => void store.workspace.saveComment(selectedDesignerNode.id, comment)}
              onDuplicate={() => void store.workspace.duplicateSelectedNodes()}
              onDelete={() => void store.workspace.deleteSelectedNodes()}
            />
          ) : (
            revision != null && (
              <NodeInspector
                variables={{
                  enabled: store.variablesEnabled,
                  names: variableNames,
                  loaded: variableNamesLoaded,
                  loading: variableNamesLoading,
                  onOpen: () => {
                    void store.refreshVariableNames()
                  },
                }}
                connectorAction={connectorAction}
                connectorActionError={connectorActionError}
                connectorAuthorizationPending={connectorAuthorizationPending}
                connectorConnection={connectorConnection}
                connectorConnectionError={connectorConnectionError}
                activeConnectorConnections={activeConnectorConnections}
                connectors={store.connectors}
                connectorLoading={connectorActionLoading != null || connectorConnectionLoading != null}
                diagnostics={inspectorDiagnostics}
                focus={diagnosticFocus}
                disabled={authoringDisabled}
                onChooseWaitNotification={openNotification}
                revision={revision}
                selection={selection}
                store={store.workspace}
                target={target}
                theme={theme}
                triggerActiveConnections={triggerActiveConnections}
                triggerAuthorizationPending={triggerAuthorizationPending}
                triggerConnection={triggerConnection}
                triggerConnectionError={triggerConnectionError}
                triggerConnectionLoading={triggerConnectionLoading != null}
                triggers={store.triggers}
              />
            )
          )}
        </ContextPanel>
      )}
      <RunDrawerContainer
        onClose={onCloseRuns}
        onConfigureConnector={onConfigureConnector}
        onToggle={onToggleRuns}
        open={runDrawerOpen}
        store={store}
        visible={runDrawerVisible}
      />
    </CanvasHistoryScope>
  )
}

export default function FlowWorkspace({
  hostAction,
  hostTitle,
  hrefFor,
  navigation,
  onConfigureConnector,
  onHostAction,
  store,
  theme,
}: {
  readonly hostAction?: string | undefined
  readonly hostTitle?: string | undefined
  readonly hrefFor: (location: WorkbenchLocation) => string
  readonly navigation: NavigationStore
  readonly onConfigureConnector?: (() => void) | undefined
  readonly onHostAction?: (() => void) | undefined
  readonly store: WorkbenchStore
  readonly theme: WorkbenchTheme
}): ReactElement {
  const t = useTranslate()
  const [runDrawerVisible, setRunDrawerVisible] = useState(false)
  const [runDrawerOpen, setRunDrawerOpen] = useState(false)
  const handledExternalRun = useRef<string>()
  const view = useVal(navigation.$.view)
  const draft = useVal(store.workspace.$.draft)
  const flowId = useVal(store.workspace.$.flowId)
  const workspaceLoadFailed = useVal(store.workspace.$.workspaceLoadFailed)
  const workspaceLoading = useVal(store.workspace.$.workspaceLoading)
  const submitting = useVal(store.runRequests.$.submitting)
  const externalRunId = useVal(store.runs.$.externalRunId)
  const draftReady = draft != null

  useEffect(() => {
    if (view == 'runs' && flowId != null) void store.runs.load(flowId)
  }, [flowId, store, view])

  useEffect(() => {
    if (view == 'publications' && flowId != null) void store.publications.load(flowId)
  }, [flowId, store, view])

  useEffect(() => store.runRequests.dismissInputs(), [draft?.revisionId, flowId, store])

  useEffect(() => {
    if (submitting == null || !draftReady) return
    navigation.open('design')
    setRunDrawerVisible(true)
    setRunDrawerOpen(false)
  }, [draftReady, navigation, submitting])

  useEffect(() => {
    if (externalRunId == null || handledExternalRun.current == externalRunId) return
    handledExternalRun.current = externalRunId
    if (view != 'design') return
    setRunDrawerVisible(true)
    setRunDrawerOpen(false)
  }, [externalRunId, view])

  const revealRun = (open = true): void => {
    if (store.workspace.$.draft.value == null) {
      navigation.open('runs')
    } else {
      navigation.open('design')
      setRunDrawerVisible(true)
      setRunDrawerOpen(open)
    }
  }
  const run = async (triggerId?: string): Promise<void> => {
    navigation.open('design')
    if ((await store.requestDraftRun(triggerId)) == 'started') revealRun()
  }
  const locateRunEvent = (sequence: number): void => {
    if (store.locateRunEvent(sequence)) revealRun()
  }

  return (
    <IconifyProvider>
      <main className="workspace">
        <WorkspaceHeader
          activeView={view}
          flowHref={hrefFor({ flowId: flowId!, view: 'design' })}
          flowsHref={hrefFor({ view: 'design' })}
          hostAction={hostAction}
          hostTitle={hostTitle}
          onOpenDesign={() => navigation.open('design')}
          onOpenFlow={() => navigation.openMainFlow()}
          onOpenFlows={() => void navigation.openFlows()}
          onOpenPublications={() => {
            store.runRequests.dismissInputs()
            navigation.open('publications')
          }}
          onOpenRuns={() => {
            store.runRequests.dismissInputs()
            navigation.open('runs')
          }}
          onHostAction={onHostAction}
          store={store}
        />
        {view == 'design' && (workspaceLoading || draft == null) ? (
          <div aria-labelledby="workspace-tab-design" className="editor-grid context-panel-closed" id="workspace-panel-design" role="tabpanel" tabIndex={0}>
            <section aria-busy={!workspaceLoadFailed} className="canvas-panel workbench-canvas">
              {workspaceLoadFailed ? (
                <Empty className="h-full rounded-none border-0" role="alert">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Icon name="alert" size={20} />
                    </EmptyMedia>
                    <EmptyTitle>{t('workspace.loadFailed')}</EmptyTitle>
                    <EmptyDescription>{t('workspace.loadFailedDescription')}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button onClick={() => flowId != null && void store.selectFlow(flowId)} variant="outline">
                      {t('empty.retry')}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <Empty className="h-full rounded-none border-0">
                  <EmptyHeader>
                    <EmptyTitle>{t('workspace.status.loading')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              )}
            </section>
          </div>
        ) : view == 'design' ? (
          <Editor
            onRun={(triggerId) => void run(triggerId)}
            onRunStarted={revealRun}
            onCloseRuns={() => setRunDrawerVisible(false)}
            onConfigureConnector={onConfigureConnector}
            onToggleRuns={() => setRunDrawerOpen(!runDrawerOpen)}
            runDrawerOpen={runDrawerOpen}
            runDrawerVisible={runDrawerVisible}
            store={store}
            theme={theme}
          />
        ) : view == 'runs' ? (
          <RunsView onConfigureConnector={onConfigureConnector} onLocateEvent={locateRunEvent} store={store} />
        ) : (
          <PublicationsView store={store} />
        )}
      </main>
    </IconifyProvider>
  )
}
