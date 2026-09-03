import type { ReactElement } from 'react'
import type { FlowDesignerViewInput, FlowDesignerViewOutput } from '../../../designer/browser/graph/FlowDesigner/model.ts'
import type { GroupDividerDef } from '../../../schema/index.ts'
import type { InputPort, JsonValue } from './api.ts'
import type { WorkbenchLocation, WorkbenchTheme } from './contract.ts'
import type { AddNodeOption } from './designer/addNodeOptions.ts'
import type { CodeTaskPorts } from './designer/flowChanges.ts'
import type { WorkbenchDesignerHandle } from './designer/workbenchDesigner.tsx'

import { useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { IconifyProvider } from '../../../designer/browser/icons/iconifyContext.tsx'
import { Button } from '../../../ui/browser/button.tsx'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../../../ui/browser/empty.tsx'
import { BlockLibrary, ContextPanel } from './designer/contextPanel.tsx'
import { inspectorIcon, NodeInspector } from './designer/nodeInspector.tsx'
import { WorkbenchDesigner } from './designer/workbenchDesigner.tsx'
import { Icon } from './icons.tsx'
import { NavigationStore } from './navigation.ts'
import { PublicationsView } from './publications/publicationsView.tsx'
import { RunDrawer } from './runs/runDrawer.tsx'
import { RunInputPanel } from './runs/runInputPanel.tsx'
import { RunsView } from './runs/runsView.tsx'
import { WorkspaceHeader } from './shell/workspaceHeader.tsx'
import { WorkbenchStore } from './stores/workbenchStore.ts'

type ContextPanelMode = 'blocks' | 'inspector' | 'notification' | undefined

function codeTaskPorts(
  inputs: readonly (FlowDesignerViewInput | GroupDividerDef)[],
  outputs: readonly (FlowDesignerViewOutput | GroupDividerDef)[],
): CodeTaskPorts {
  return {
    inputs: inputs.map((input) =>
      'group' in input
        ? input
        : Object.assign(
            {
              handle: input.handle,
              ...(input.description == null ? {} : { description: input.description }),
              jsonSchema: (input.jsonSchema ?? {}) as JsonValue,
              nullable: input.nullable ?? false,
            },
            input.defaultValue === undefined ? {} : { value: input.defaultValue as JsonValue },
          ),
    ),
    outputs: outputs.map((output) =>
      'group' in output
        ? output
        : Object.assign(
            { handle: output.handle, jsonSchema: (output.jsonSchema ?? {}) as JsonValue, nullable: output.nullable ?? false },
            output.description == null ? {} : { description: output.description },
          ),
    ),
  }
}

function additionalTaskInputs(inputs: readonly FlowDesignerViewInput[]): readonly InputPort[] {
  return inputs.map((input) =>
    Object.assign(
      {
        handle: input.handle,
        jsonSchema: (input.jsonSchema ?? {}) as JsonValue,
        nullable: input.nullable ?? false,
      },
      input.description == null ? {} : { description: input.description },
      input.defaultValue === undefined ? {} : { value: input.defaultValue as JsonValue },
    ),
  )
}

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
  onCloseRuns,
  onConfigureConnector,
  onToggleRuns,
  runDrawerOpen,
  runDrawerVisible,
  store,
  theme,
}: {
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
  const busy = useVal(store.$.busy)
  const designer = useVal(store.$.designer)
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
  const addingFromBlocks = useRef(false)
  const blockAddCount = useRef(0)
  const designerRef = useRef<WorkbenchDesignerHandle>(null)
  const focusInspectorOnOpen = useRef(false)
  const opener = useRef<HTMLElement>()

  useEffect(() => {
    addingFromBlocks.current = false
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

  const authoringDisabled = draft == null || (busy != null && busy != 'designer' && busy != 'run')
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
    if (addingFromBlocks.current) {
      addingFromBlocks.current = false
      return
    }
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
    addingFromBlocks.current = true
    let waitForSelection = false
    try {
      const nodeId = await designerRef.current?.addNode(option, canvasPosition)
      if (nodeId != null) {
        waitForSelection = true
        blockAddCount.current++
        setContextPanelMode(option.kind == 'connector' || option.kind == 'trigger' ? 'inspector' : 'blocks')
      }
      return nodeId
    } finally {
      if (!waitForSelection) addingFromBlocks.current = false
    }
  }
  const setNotification = async (option: AddNodeOption): Promise<string | undefined> => {
    if (selection?.kind != 'wait' || option.kind != 'connector') return
    if (!(await store.workspace.setWaitNotification(selection.id, option.connector))) return
    await store.refreshSelectedConnector()
    setContextPanelMode('inspector')
    return selection.id
  }

  const contextPanelVisible = contextPanelMode != null && target != null && (contextPanelMode == 'blocks' || revision != null)

  return (
    <div
      aria-labelledby="workspace-tab-design"
      className={`editor-grid ${contextPanelVisible ? '' : 'context-panel-closed'}`}
      id="workspace-panel-design"
      role="tabpanel"
      tabIndex={0}
    >
      <WorkbenchDesigner
        addNodeOptions={addNodeOptions}
        blocksOpen={contextPanelVisible && contextPanelMode == 'blocks'}
        disabled={authoringDisabled}
        focusNodeRequest={diagnosticFocus ?? nodeFocus}
        inspectorOpen={contextPanelVisible && contextPanelMode == 'inspector'}
        model={designer}
        onAddNode={async (option, position, connection) => {
          const nodeId = await store.addNode(option, position, connection)
          return nodeId
        }}
        onConnect={(edge) => void store.workspace.connect(edge)}
        onChangeComment={(nodeId, value) => void store.workspace.saveComment(nodeId, value)}
        onChangeCondition={(nodeId, value) => void store.workspace.saveCondition(nodeId, value)}
        onChangeNodeDescription={(nodeId, description) => void store.workspace.saveNodeDescription(nodeId, description)}
        onChangeNodeIcon={(nodeId, icon) => void store.workspace.saveNodeIcon(nodeId, icon)}
        onChangeNodeTitle={(nodeId, title) => void store.workspace.saveNodeTitle(nodeId, title)}
        onChangeInput={(nodeId, handle, value) => void store.workspace.setInputValue(nodeId, handle, value)}
        onChangeInputVariable={(nodeId, handle, name) => void store.workspace.setInputVariable(nodeId, handle, name)}
        onChangeTaskAdditionalInputs={(nodeId, inputs) => void store.workspace.saveTaskAdditionalInputs(nodeId, additionalTaskInputs(inputs))}
        onChangeTaskPorts={(nodeId, inputs, outputs) => void store.workspace.saveCodeTaskPorts(nodeId, codeTaskPorts(inputs, outputs))}
        onChangeTriggerConfig={(triggerId, name, value) => void store.workspace.saveTriggerConfig(triggerId, name, value)}
        onChangeTriggerSchedule={(triggerId, schedule) => void store.workspace.saveTriggerSchedule(triggerId, schedule)}
        onChangeWebhook={(triggerId, webhook) => void store.workspace.saveWebhook(triggerId, webhook)}
        onChangeValue={(nodeId, values) => void store.workspace.saveValue(nodeId, values)}
        onCopy={() => store.workspace.copySelectedNodes()}
        onDeleteEdge={(edge) => void store.workspace.disconnect(edge)}
        onDeleteNodes={() => void store.workspace.deleteSelectedNodes()}
        onDuplicate={(positions) => void store.workspace.duplicateSelectedNodes(positions)}
        onMoveNodes={(positions) => void store.workspace.moveNodes(positions)}
        onMoveViewport={(viewport, displayMode) => void store.workspace.moveViewport(viewport, displayMode)}
        onOpenBlocks={openBlocks}
        onOpenInspector={openInspector}
        onOpenVariables={() => void store.refreshVariableNames()}
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
              disabled={authoringDisabled}
              draggable={false}
              focusRequest={blocksFocusRequest}
              onAdd={setNotification}
              onRegisterDragOption={() => {}}
              options={[]}
              provideChoices={async (optionId, signal) =>
                (await store.connectors.provideAddNodeOptionChoices(optionId, signal))?.filter(
                  (option) => option.kind == 'connector' && option.inputs.length > 0,
                )
              }
            />
          ) : (
            revision != null && (
              <NodeInspector
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
    </div>
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
  const runDraft = async (): Promise<void> => {
    navigation.open('design')
    if ((await store.requestDraftRun()) == 'started') revealRun()
  }
  const runLive = async (): Promise<void> => {
    if ((await store.requestLiveRun()) == 'started') revealRun()
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
          onRunDraft={() => void runDraft()}
          onRunLive={() => void runLive()}
          store={store}
        />
        <RunInputPanel onStarted={revealRun} store={store.runRequests} theme={theme} />
        {view == 'design' && (workspaceLoading || draft == null) ? (
          <div aria-labelledby="workspace-tab-design" className="editor-grid context-panel-closed" id="workspace-panel-design" role="tabpanel" tabIndex={0}>
            <section aria-busy={!workspaceLoadFailed} className="canvas-panel workbench-designer">
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
