import type { IsValidConnection, OnMoveEnd, OnNodeDrag, OnSelectionChangeFunc, Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { DesignerStore } from '../../stores/designer/designer.store.ts'
import type { ReactFlowContainerProps } from '../ReactFlowContainer/ReactFlowContainer.tsx'

import { useEffect } from 'react'
import { useVal } from 'use-value-enhancer'
import { NodeMiniMapProvider } from '../../components/minimap.tsx'
import { fitViewOptions } from '../BlockDesigner/constants.ts'
import { EDGE_TYPES, NODE_TYPES } from '../constants.tsx'
import { DesignerStoreProvider } from '../DesignerStoreContext.tsx'
import { ReactFlowContainer } from '../ReactFlowContainer/ReactFlowContainer.tsx'

export interface FlowDesignerProps {
  cornerTools?: React.ReactNode
  toolbar?: React.ReactNode
  flowDesignerStore: DesignerStore
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
  cornerTools,
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

  useEffect(flowDesignerStore.setupForceDelete, [])

  return (
    <DesignerStoreProvider value={flowDesignerStore}>
      <NodeMiniMapProvider value={nodeMiniMapPhase}>
        <ReactFlowContainer
          cornerTools={cornerTools}
          toolbar={toolbar}
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
          onPaste={flowDesignerStore.onPaste}
          provideAddNodeMenuItems={flowDesignerStore.provideAddNodeMenuItems}
          provideAsyncAddNodeMenuItems={flowDesignerStore.provideAsyncAddNodeMenuItems}
          waitNode={flowDesignerStore.waitNode}
          duplicateNodes={flowDesignerStore.duplicateNodes}
        ></ReactFlowContainer>
      </NodeMiniMapProvider>
    </DesignerStoreProvider>
  )
}
