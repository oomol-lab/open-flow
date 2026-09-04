import type { IsValidConnection, OnMoveEnd, OnNodeDrag, OnSelectionChangeFunc, Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { FlowDesignerStore } from '../../stores/designer/flowDesigner.store.ts'
import type { ReactFlowContainerProps } from '../ReactFlowContainer/ReactFlowContainer.tsx'

import { useEffect } from 'react'
import { useVal } from 'use-value-enhancer'
import { NodeMiniMapProvider } from '../../components/minimap.tsx'
import { fitViewOptions } from '../BlockDesigner/constants.ts'
import { FLOW_EDGE_TYPES, NODE_TYPES } from '../constants.tsx'
import { DesignerStoreProvider } from '../DesignerStoreContext.tsx'
import { ReactFlowContainer } from '../ReactFlowContainer/ReactFlowContainer.tsx'
import { FlowSettingsContainer } from './FlowSettingsContainer.tsx'

export interface FlowDesignerProps {
  flowDesignerStore: FlowDesignerStore
  dark: boolean
  fitView?: boolean
  layoutMotion?: boolean
  className?: string
  addNodeRequest?: ReactFlowContainerProps['addNodeRequest']
  addItemRequest?: ReactFlowContainerProps['addItemRequest']
  onMoveEnd?: OnMoveEnd
  onNodeDragStop?: OnNodeDrag<RFNode<any>>
  onSelectionChange?: OnSelectionChangeFunc<RFNode<any>, RFEdge<any>>
  isValidConnection?: IsValidConnection<RFEdge<any>>
  onDropAddItem?: ReactFlowContainerProps['onDropAddItem']
}

export const FlowDesigner: React.FC<FlowDesignerProps> = ({
  flowDesignerStore,
  dark,
  fitView,
  layoutMotion,
  className,
  addNodeRequest,
  addItemRequest,
  onMoveEnd,
  onNodeDragStop,
  onSelectionChange,
  isValidConnection,
  onDropAddItem,
}) => {
  const editable = useVal(flowDesignerStore.$.editable)
  const nodeMiniMapPhase = useVal(flowDesignerStore.$.nodeMiniMapPhase)
  const showSettings$ = flowDesignerStore.manifest$ == null ? undefined : flowDesignerStore.$$.showSettings

  useEffect(flowDesignerStore.setupForceDelete, [])

  return (
    <DesignerStoreProvider value={flowDesignerStore}>
      <NodeMiniMapProvider value={nodeMiniMapPhase}>
        <ReactFlowContainer
          showSettings$={showSettings$}
          focused$={flowDesignerStore.focused$}
          editable={editable}
          className={className}
          i18n={flowDesignerStore.i18n}
          dark={dark}
          dottedBackground
          fitView={fitView ?? !editable}
          fitViewOptions={fitViewOptions}
          layoutMotion={layoutMotion}
          nodeTypes={NODE_TYPES}
          edgeTypes={FLOW_EDGE_TYPES}
          miniMapExpanded$={flowDesignerStore.$$.miniMapExpanded}
          displayMode$={flowDesignerStore.$$.displayMode}
          interactiveMode$={flowDesignerStore.$$.interactiveMode}
          nodes$={flowDesignerStore.$.rfNodes}
          edges$={flowDesignerStore.$.renderedRFEdges}
          viewport$={flowDesignerStore.$$.viewport}
          addNodeRequest={addNodeRequest}
          addItemRequest={addItemRequest}
          onAddNode={flowDesignerStore.onAddNode}
          onBeforeDelete={flowDesignerStore.onBeforeDelete}
          onNodesChange={flowDesignerStore.handleNodesChange}
          onEdgesChange={flowDesignerStore.handleEdgesChange}
          onConnect={flowDesignerStore.onRFConnect}
          onMoveEnd={onMoveEnd}
          onNodeDragStop={onNodeDragStop}
          onSelectionChange={onSelectionChange}
          isValidConnection={isValidConnection}
          onDropAddItem={onDropAddItem}
          onRelayout={flowDesignerStore.onRelayout}
          onDisplayModeMeasured={flowDesignerStore.completeDisplayModeLayout}
          onInstance={flowDesignerStore.rfCommand.onRFInstance}
          onInit={flowDesignerStore.onInit}
          onFitView={flowDesignerStore.onFitView}
          onPaste={flowDesignerStore.onPaste}
          provideAddNodeMenuItems={flowDesignerStore.provideAddNodeMenuItems}
          provideAsyncAddNodeMenuItems={flowDesignerStore.provideAsyncAddNodeMenuItems}
          waitNode={flowDesignerStore.waitNode}
          setupValueNode={flowDesignerStore.setupValueNode}
          setupScriptletNode={flowDesignerStore.setupScriptletNode}
          onAddHandle={flowDesignerStore.onAddHandle}
          duplicateNodes={flowDesignerStore.duplicateNodes}
        >
          {showSettings$ != null && <FlowSettingsContainer />}
        </ReactFlowContainer>
      </NodeMiniMapProvider>
    </DesignerStoreProvider>
  )
}
