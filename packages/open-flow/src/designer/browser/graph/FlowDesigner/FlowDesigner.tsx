import type { IsValidConnection, OnMoveEnd, OnNodeDrag, OnSelectionChangeFunc, Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { FlowDesignerStore } from '../../stores/designer/flowDesigner.store.ts'
import type { ReactFlowContainerProps } from '../ReactFlowContainer/ReactFlowContainer.tsx'
import type { FlowDesignerViewProps } from './model.ts'

import { useEffect } from 'react'
import { useVal } from 'use-value-enhancer'
import { NodeMiniMapProvider } from '../../components/minimap.tsx'
import { fitViewOptions } from '../BlockDesigner/constants.ts'
import { EDGE_TYPES, NODE_TYPES } from '../constants.tsx'
import { DesignerStoreProvider } from '../DesignerStoreContext.tsx'
import { NodeEditorPortal } from '../Nodes/components/NodeEditor.tsx'
import { ReactFlowContainer } from '../ReactFlowContainer/ReactFlowContainer.tsx'
import { CanvasContext } from './CanvasContext.ts'
import { FlowSettingsContainer } from './FlowSettingsContainer.tsx'

export interface FlowDesignerProps {
  toolbar?: React.ReactNode
  view?: Pick<FlowDesignerViewProps, 'model' | 'inspectorContainer' | 'inspectorHeaderContainer' | 'selectedNodeIds'>
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
  view,
  toolbar,
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
  const showSettings$ = flowDesignerStore.manifest$ == null || view != null ? undefined : flowDesignerStore.$$.showSettings

  useEffect(flowDesignerStore.setupForceDelete, [])

  return (
    <CanvasContext.Provider value={view}>
      <DesignerStoreProvider value={flowDesignerStore}>
        <NodeMiniMapProvider value={nodeMiniMapPhase}>
          <ReactFlowContainer
            toolbar={toolbar}
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
            edgeTypes={EDGE_TYPES}
            miniMapExpanded$={flowDesignerStore.$$.miniMapExpanded}
            interactiveMode$={flowDesignerStore.$$.interactiveMode}
            nodes$={flowDesignerStore.$.rfNodes}
            edges$={flowDesignerStore.$.rfEdges}
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
            onLayoutMeasured={flowDesignerStore.completeLayout}
            onInstance={flowDesignerStore.rfCommand.onRFInstance}
            onInit={flowDesignerStore.onInit}
            onFitView={flowDesignerStore.onFitView}
            onPaste={flowDesignerStore.onPaste}
            provideAddNodeMenuItems={flowDesignerStore.provideAddNodeMenuItems}
            provideAsyncAddNodeMenuItems={flowDesignerStore.provideAsyncAddNodeMenuItems}
            waitNode={flowDesignerStore.waitNode}
            duplicateNodes={flowDesignerStore.duplicateNodes}
          >
            <NodeEditorPortal />
            {showSettings$ != null && <FlowSettingsContainer />}
          </ReactFlowContainer>
        </NodeMiniMapProvider>
      </DesignerStoreProvider>
    </CanvasContext.Provider>
  )
}
