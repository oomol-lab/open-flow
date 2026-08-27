import type { SubflowDesignerStore } from '../../stores/designer/subflowDesigner.store.ts'

import { clsx } from 'clsx'
import { memo, useEffect } from 'react'
import { useVal } from 'use-value-enhancer'
import { NodeMiniMapProvider } from '../../components/minimap.tsx'
import { SUBFLOW_VIEW_MODE } from '../../stores/designer/subflowDesigner.store.ts'
import { fitViewOptions } from '../BlockDesigner/constants.ts'
import { EDGE_TYPES, FLOW_EDGE_TYPES, NODE_TYPES } from '../constants.tsx'
import { DesignerStoreProvider } from '../DesignerStoreContext.tsx'
import { FlowSettingsContainer } from '../FlowDesigner/FlowSettingsContainer.tsx'
import { InOutNodeIndicators } from '../ReactFlowContainer/NodeIndicator.tsx'
import { ReactFlowContainer } from '../ReactFlowContainer/ReactFlowContainer.tsx'
import { SubflowToggleButton } from './SubflowToggleButton.tsx'
import { SubflowViewModeContext } from './SubflowViewModeContext.ts'

export interface SubflowDesignerProps {
  subflowDesignerStore: SubflowDesignerStore
  dark: boolean
  fitView?: boolean
  className?: string
}

export const SubflowDesigner: React.FC<SubflowDesignerProps> = (props) => {
  const nodeMiniMapPhase = useVal(props.subflowDesignerStore.$.nodeMiniMapPhase)
  const subflowViewMode = useVal(props.subflowDesignerStore.$.viewMode)
  const showFlow = subflowViewMode === SUBFLOW_VIEW_MODE.Flow

  useEffect(props.subflowDesignerStore.setupForceDelete, [])

  return (
    <DesignerStoreProvider value={props.subflowDesignerStore}>
      <NodeMiniMapProvider value={nodeMiniMapPhase}>
        <SubflowViewModeContext.Provider value={subflowViewMode}>
          {showFlow ? <FlowMode {...props} /> : <BlockMode {...props} />}
        </SubflowViewModeContext.Provider>
      </NodeMiniMapProvider>
    </DesignerStoreProvider>
  )
}

const FlowMode = /*#__PURE__*/ memo(function FlowMode({ subflowDesignerStore, dark, fitView, className }: SubflowDesignerProps) {
  const editable = useVal(subflowDesignerStore.$.editable)

  return (
    <ReactFlowContainer
      showSettings$={subflowDesignerStore.$$.showSettings}
      focused$={subflowDesignerStore.focused$}
      editable={editable}
      className={clsx(className, 'oo-subflow-on')}
      i18n={subflowDesignerStore.i18n}
      dark={dark}
      nodeTypes={NODE_TYPES}
      edgeTypes={FLOW_EDGE_TYPES}
      miniMapExpanded$={subflowDesignerStore.$$.miniMapExpanded}
      displayMode$={subflowDesignerStore.$$.displayMode}
      interactiveMode$={subflowDesignerStore.$$.interactiveMode}
      graph$={subflowDesignerStore.$.renderedRFGraph}
      viewport$={subflowDesignerStore.$$.viewport}
      onAddNode={subflowDesignerStore.onAddNode}
      onBeforeDelete={subflowDesignerStore.onBeforeDelete}
      onNodesChange={subflowDesignerStore.handleNodesChange}
      onEdgesChange={subflowDesignerStore.handleEdgesChange}
      onConnect={subflowDesignerStore.onRFConnect}
      onRelayout={subflowDesignerStore.onRelayout}
      onDisplayModeMeasured={subflowDesignerStore.completeDisplayModeLayout}
      onInstance={subflowDesignerStore.rfCommand.onRFInstance}
      fitView={fitView ?? !editable}
      fitViewOptions={fitViewOptions}
      dottedBackground
      onInit={subflowDesignerStore.onInit}
      onFitView={subflowDesignerStore.onFitView}
      onPaste={subflowDesignerStore.onPaste}
      provideAddNodeMenuItems={subflowDesignerStore.provideAddNodeMenuItems}
      provideAsyncAddNodeMenuItems={subflowDesignerStore.provideAsyncAddNodeMenuItems}
      waitNode={subflowDesignerStore.waitNode}
      setupValueNode={subflowDesignerStore.setupValueNode}
      setupScriptletNode={subflowDesignerStore.setupScriptletNode}
      onAddHandle={subflowDesignerStore.onAddHandle}
      duplicateNodes={subflowDesignerStore.duplicateNodes}
    >
      <InOutNodeIndicators />
      <SubflowToggleButton />
      <FlowSettingsContainer />
    </ReactFlowContainer>
  )
})

const BlockMode = /*#__PURE__*/ memo(function BlockMode({ subflowDesignerStore, dark, fitView, className }: SubflowDesignerProps) {
  const editable = useVal(subflowDesignerStore.$.editable)

  return (
    <ReactFlowContainer
      showSettings$={subflowDesignerStore.$$.showSettings}
      focused$={subflowDesignerStore.focused$}
      canDeleteNodes={false}
      editable={editable}
      className={clsx(className, 'oo-subflow-off')}
      i18n={subflowDesignerStore.i18n}
      dark={dark}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      interactiveMode$={subflowDesignerStore.$$.interactiveMode}
      graph$={subflowDesignerStore.$.rfGraph}
      viewport$={subflowDesignerStore.$$.nodeViewport}
      onBeforeDelete={subflowDesignerStore.onBeforeDelete}
      onNodesChange={subflowDesignerStore.handleNodesChange}
      onEdgesChange={subflowDesignerStore.handleEdgesChange}
      fitView={fitView ?? !editable}
      fitViewOptions={fitViewOptions}
      onInit={subflowDesignerStore.onInit}
      onFitView={subflowDesignerStore.onFitView}
    >
      <SubflowToggleButton />
      <FlowSettingsContainer />
    </ReactFlowContainer>
  )
})
