import type { ComponentProps, ReactElement } from 'react'
import type { WorkbenchLocation, WorkbenchTheme } from './contract.ts'
import type { AddNodeOption } from './editor/addNodeOptions.ts'
import type { WorkbenchCanvasHandle } from './editor/workbenchCanvas.tsx'

import { memo, useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { useIgnoredNodes } from '../../../canvas/browser/useIgnoredNodes.ts'
import { nodeNameIssue } from '../../../flow/common/change.ts'
import { Empty, EmptyHeader, EmptyTitle } from '../../../ui/browser/empty.tsx'
import { IconifyProvider } from '../../../ui/browser/icons/iconifyContext.tsx'
import { CanvasHistoryScope } from './editor/canvasHistoryScope.tsx'
import { CommentInspector } from './editor/commentInspector.tsx'
import { EditorContextPanel } from './editor/editorContextPanel.tsx'
import { FlowNodeList } from './editor/flowNodeList.tsx'
import { inspectorIcon, NodeInspector } from './editor/nodeInspector.tsx'
import { NodePickerPopover } from './editor/nodePickerPopover.tsx'
import { useInspectorPanel } from './editor/useInspectorPanel.ts'
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
import { WorkspaceRecovery } from './shell/workspaceRecovery.tsx'
import { WorkbenchStore } from './stores/workbenchStore.ts'

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
  const resolvingActions = useVal(store.runs.$.resolvingActions)
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
      onLocateWait={(nodeId) => {
        if (store.locateRunWait(nodeId)) onClose()
      }}
      onResolve={(waitId, action, comment) => void store.runs.resolve(waitId, action, comment)}
      onRetryObservation={() => store.runs.retryObservation()}
      onToggle={onToggle}
      observationFailed={observationFailed}
      open={open}
      result={result}
      resolvingActions={resolvingActions}
      run={run}
      submitting={submitting != null}
      visible={visible}
    />
  )
}

// Keep inspector-only data updates out of the canvas render path.
const NodeInspectorContainer = memo(function NodeInspectorContainer({
  store,
  focus,
  disabled,
  revision,
  selection,
  target,
  theme,
}: Pick<ComponentProps<typeof NodeInspector>, 'focus' | 'disabled' | 'revision' | 'selection' | 'target' | 'theme'> & {
  readonly store: WorkbenchStore
}): ReactElement {
  const variableNames = useVal(store.$.variableNames)
  const variableNamesLoaded = useVal(store.$.variableNamesLoaded)
  const variableNamesLoading = useVal(store.$.variableNamesLoading)
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
  const sourceNodeIcons = useVal(store.$.sourceNodeIcons)
  return (
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
      focus={focus}
      disabled={disabled}
      revision={revision}
      selection={selection}
      sourceNodeIcons={sourceNodeIcons}
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
})

export function FlowEditor({
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
  const connections = useVal(store.connectors.$.connections)
  const triggerCatalogState = useVal(store.triggers.catalog.state)
  const [startId, setStartId] = useState<string>()
  const runInputRequest = useVal(store.runRequests.$.inputRequest)
  const busy = useVal(store.$.busy)
  const history = useVal(store.workspace.history$)
  const designer = useVal(store.$.designer)
  const triggers = designer.nodes.filter((node) => node.kind == 'trigger')
  const selectedTrigger = triggers.find((node) => node.id == startId) ?? triggers[0]
  const diagnosticFocus = useVal(store.workspace.$.diagnosticFocus)
  const draft = useVal(store.workspace.$.draft)
  const nodeFocus = useVal(store.workspace.$.nodeFocus)
  const flowId = useVal(store.workspace.$.flowId)
  const revision = useVal(store.workspace.$.revision)
  const selectedDesignerNode = useVal(store.$.selectedDesignerNode)
  const selection = useVal(store.workspace.$.selection)
  const selectedNodeIds = useVal(store.workspace.$.selectedNodeIds)
  const target = useVal(store.workspace.$.target)
  const initialAddNodeTab = target?.kind == 'flow' && triggers.length == 0 ? 'triggers' : 'nodes'
  const { ignoredNodeIds, onIgnoreNodes } = useIgnoredNodes(`${flowId}:${target?.kind}:${target?.kind == 'subflow' ? target.id : ''}`)
  const panel = useInspectorPanel({
    identity: JSON.stringify([flowId, target]),
    preferences: store.preferences,
    selectedNodeIds,
    onSelectNodes: (ids) => store.selectNodes(ids),
  })
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
    focusInspectorOnOpen.current = false
    opener.current = undefined
  }, [flowId, target?.kind == 'subflow' ? target.id : undefined, target?.kind])

  useEffect(() => {
    if (diagnosticFocus == null) return
    focusInspectorOnOpen.current = false
    opener.current = undefined
    panel.openInspector()
  }, [diagnosticFocus])

  useEffect(() => {
    if (selectedDesignerNode?.kind == 'trigger') setStartId(selectedDesignerNode.id)
  }, [selectedDesignerNode])

  const authoringDisabled = draft == null || history.applying || history.failed || (busy != null && busy != 'designer' && busy != 'run')
  const closeContextPanel = (focusTarget = opener.current): void => {
    panel.close()
    focusInspectorOnOpen.current = false
    opener.current = undefined
    globalThis.setTimeout(() => {
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true })
      else designerRef.current?.focusCanvas()
    }, 0)
  }
  const openInspector = (): void => {
    opener.current = undefined
    focusInspectorOnOpen.current = false
    panel.openInspector()
  }
  const toggleInspector = (button: HTMLButtonElement): void => {
    if (panel.open) {
      closeContextPanel(button)
      return
    }
    opener.current = button
    focusInspectorOnOpen.current = true
    panel.openInspector()
  }
  const addFromPicker = async (option: AddNodeOption): Promise<string | undefined> => {
    return designerRef.current?.addNode(option)
  }

  const selectOutlineNode = (nodeId: string): void => {
    designerRef.current?.focusCanvas()
    panel.activate([nodeId])
    store.workspace.locateNode(nodeId, { preserveSelection: true })
  }
  const focusNode = (nodeId: string): void => {
    store.workspace.locateNode(nodeId, { preserveSelection: true })
  }

  const contextPanelVisible = panel.open && target != null && revision != null
  const flowSelected = panel.page == 'outline'
  const multipleSelected = !flowSelected && selectedNodeIds.length > 1
  const singleSelected = !flowSelected && !multipleSelected
  const contextPanelIcon = target == null || flowSelected || multipleSelected ? 'flow' : inspectorIcon(selection, target)
  const contextPanelTitle = flowSelected
    ? t('inspector.outline')
    : multipleSelected
      ? t('inspector.multipleSelected', { count: selectedNodeIds.length })
      : (selectedDesignerNode?.title ?? t('inspector.title'))

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
        addNodeControl={
          <NodePickerPopover
            key={`${flowId}:${target?.kind}`}
            options={addNodeOptions}
            connections={connections}
            loadConnections={store.connectors.loadConnections}
            browseOptions={store.browseAddNodeOptions}
            searchOptions={store.provideAddNodeOptions}
            provideChoices={store.provideAddNodeOptionChoices}
            catalogFailed={triggerCatalogState.error != null}
            refreshCatalog={store.retryCatalog}
            initialTab={initialAddNodeTab}
            disabled={authoringDisabled || target == null}
            focusRequest={0}
            onAdd={addFromPicker}
            onRegisterDragOption={(option) => designerRef.current?.registerDraggedNode(option)}
            onDragEnd={() => designerRef.current?.clearDraggedNode()}
          />
        }
        nodePicker={{
          connections,
          loadConnections: store.connectors.loadConnections,
          browseOptions: store.browseAddNodeOptions,
          provideChoices: store.provideAddNodeOptionChoices,
          catalogFailed: triggerCatalogState.error != null,
          refreshCatalog: store.retryCatalog,
          initialTab: initialAddNodeTab,
        }}
        addNodeOptions={addNodeOptions}
        disabled={authoringDisabled}
        focusNodeRequest={diagnosticFocus ?? nodeFocus}
        inspectorOpen={contextPanelVisible}
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
        onOpenInspector={openInspector}
        onPaste={() => void store.workspace.pasteNodes()}
        provideAddNodeOptions={store.provideAddNodeOptions}
        onSelectNodes={panel.select}
        onActivateSelection={panel.activate}
        onSelectionStart={panel.startSelection}
        onSelectionEnd={panel.endSelection}
        onToggleInspector={toggleInspector}
        ref={designerRef}
        selectedNodeIds={panel.canvasSelection}
        target={target}
        theme={theme}
      />
      {contextPanelVisible && (
        <EditorContextPanel
          resizable
          onBack={
            !flowSelected
              ? () => {
                  panel.back()
                  designerRef.current?.focusCanvas()
                }
              : undefined
          }
          nodeId={singleSelected ? selectedDesignerNode?.id : undefined}
          nodeHeading={
            singleSelected && selection != null
              ? {
                  titleReadOnly: selection.kind === 'trigger' && selection.trigger.kind === 'manual',
                  title: selection.node.name ?? selectedDesignerNode?.title ?? '',
                  icon: selectedDesignerNode != null && 'icon' in selectedDesignerNode ? selectedDesignerNode.icon : undefined,
                  disabled: authoringDisabled,
                  fallback: <Icon name={inspectorIcon(selection, target)} />,
                  onRename: (name) => {
                    void store.workspace.saveNodeTitle(selection.id, name)
                  },
                  onIconChange: (icon) => {
                    void store.workspace.saveNodeIcon(selection.id, icon)
                  },
                  validate: (name) => {
                    if (revision == null || target == null) return
                    const graph = revision.graph(target)
                    if (graph == null) return
                    const issue = nodeNameIssue(graph, selection.id, name)
                    return issue == null ? undefined : t(`inspector.node.${issue === 'empty' ? 'nameEmpty' : 'nameDuplicate'}`)
                  },
                }
              : singleSelected && selectedDesignerNode?.kind === 'comment'
                ? {
                    title: selectedDesignerNode.title,
                    disabled: authoringDisabled,
                    fallback: <i aria-hidden="true" className="i-codicon:note" />,
                    validate: () => undefined,
                    onRename: (title) => {
                      void store.workspace.saveComment(selectedDesignerNode.id, { title, content: selectedDesignerNode.content ?? '' })
                    },
                  }
                : undefined
          }
          focusOnOpen={focusInspectorOnOpen.current}
          icon={contextPanelIcon}
          onClose={() => closeContextPanel()}
          theme={theme}
          title={contextPanelTitle}
        >
          <div hidden={!flowSelected} className="h-full">
            <FlowNodeList key={JSON.stringify([flowId, target])} groupTriggers nodes={designer.nodes} onFocusNode={focusNode} onSelect={selectOutlineNode} />
          </div>
          {multipleSelected ? (
            <FlowNodeList nodes={designer.nodes.filter((node) => selectedNodeIds.includes(node.id))} onSelect={selectOutlineNode} onFocusNode={focusNode} />
          ) : flowSelected ? null : selectedDesignerNode?.kind == 'comment' ? (
            <CommentInspector
              key={selectedDesignerNode.id}
              title={selectedDesignerNode.title}
              content={selectedDesignerNode.content ?? ''}
              disabled={authoringDisabled}
              dark={theme == 'dark'}
              onSave={(comment) => void store.workspace.saveComment(selectedDesignerNode.id, comment)}
            />
          ) : (
            revision != null && (
              <NodeInspectorContainer
                store={store}
                focus={diagnosticFocus}
                disabled={authoringDisabled}
                revision={revision}
                selection={selection}
                target={target}
                theme={theme}
              />
            )
          )}
        </EditorContextPanel>
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
  const workspaceLoadProblem = useVal(store.workspace.$.workspaceLoadProblem)
  const workspaceLoading = useVal(store.workspace.$.workspaceLoading)
  const workspaceRepairing = useVal(store.workspace.$.workspaceRepairing)
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
                <WorkspaceRecovery
                  kind={workspaceLoadProblem?.kind ?? 'failed'}
                  message={workspaceLoadProblem?.message}
                  repairing={workspaceRepairing}
                  onRepair={() => void store.workspace.repairWorkspace()}
                  onRetry={() => flowId != null && void store.selectFlow(flowId)}
                />
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
          <FlowEditor
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
          <RunsView
            onConfigureConnector={onConfigureConnector}
            onLocateEvent={locateRunEvent}
            onLocateWait={(nodeId) => {
              if (store.locateRunWait(nodeId)) navigation.open('design')
            }}
            store={store}
          />
        ) : (
          <PublicationsView store={store} />
        )}
      </main>
    </IconifyProvider>
  )
}
