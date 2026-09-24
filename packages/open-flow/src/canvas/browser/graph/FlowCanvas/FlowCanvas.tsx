import type { IsValidConnection, OnMoveEnd, OnNodeDrag, OnSelectionChangeFunc, Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { CanvasStore } from '../../stores/canvas/canvas.store.ts'
import type { ReactFlowContainerProps } from '../ReactFlowContainer/ReactFlowContainer.tsx'
import type { FlowCanvasViewProps } from './model.ts'

import { useEffect } from 'react'
import { useVal } from 'use-value-enhancer'
import { NodeMiniMapProvider } from '../../components/minimap.tsx'
import { CanvasStoreProvider } from '../CanvasStoreContext.tsx'
import { EDGE_TYPES, NODE_TYPES } from '../constants.tsx'
import { fitViewOptions } from '../FlowCanvas/constants.ts'
import { InspectSelectionContext } from '../inspectSelection.tsx'
import { ReactFlowContainer } from '../ReactFlowContainer/ReactFlowContainer.tsx'

export interface FlowCanvasProps {
  onActivateSelection?: () => void
  onSelectionStart?: () => void
  onSelectionEnd?: () => void
  onInspectSelection?: () => void
  onRequestAddNode?: FlowCanvasViewProps['onRequestAddNode']
  cornerTools?: React.ReactNode
  cornerLeading?: React.ReactNode
  topLeftTools?: React.ReactNode
  bottomRightTools?: React.ReactNode
  toolbar?: React.ReactNode
  flowCanvasStore: CanvasStore
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

export const FlowCanvas: React.FC<FlowCanvasProps> = ({
  flowCanvasStore,
  onActivateSelection,
  onSelectionStart,
  onSelectionEnd,
  onInspectSelection,
  onRequestAddNode,
  cornerTools,
  cornerLeading,
  topLeftTools,
  bottomRightTools,
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
  const editable = useVal(flowCanvasStore.$.editable)
  const nodeMiniMapPhase = useVal(flowCanvasStore.$.nodeMiniMapPhase)

  useEffect(flowCanvasStore.setupForceDelete, [])

  return (
    <InspectSelectionContext.Provider value={onInspectSelection}>
      <CanvasStoreProvider value={flowCanvasStore} dark={dark}>
        <NodeMiniMapProvider value={nodeMiniMapPhase}>
          <ReactFlowContainer
            cornerTools={cornerTools}
            cornerLeading={cornerLeading}
            topLeftTools={topLeftTools}
            bottomRightTools={bottomRightTools}
            toolbar={toolbar}
            editable={editable}
            className={className}
            i18n={flowCanvasStore.i18n}
            dark={dark}
            dottedBackground
            fitView={fitView ?? !editable}
            fitViewOptions={fitViewOptions}
            layoutMotion={layoutMotion}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            miniMapExpanded$={flowCanvasStore.$$.miniMapExpanded}
            interactiveMode$={flowCanvasStore.$$.interactiveMode}
            nodes$={flowCanvasStore.$.rfNodes}
            edges$={flowCanvasStore.$.rfEdges}
            viewport$={flowCanvasStore.$$.viewport}
            onRequestAddNode={onRequestAddNode}
            addNodeRequest={addNodeRequest}
            addItemRequest={addItemRequest}
            onAddNode={flowCanvasStore.onAddNode}
            onBeforeDelete={flowCanvasStore.onBeforeDelete}
            onNodesChange={flowCanvasStore.handleNodesChange}
            onEdgesChange={flowCanvasStore.handleEdgesChange}
            onConnect={flowCanvasStore.onRFConnect}
            onMoveEnd={onMoveEnd}
            onNodeDragStop={onNodeDragStop}
            onSelectionChange={onSelectionChange}
            onActivateSelection={onActivateSelection}
            onSelectionStart={onSelectionStart}
            onSelectionEnd={onSelectionEnd}
            isValidConnection={isValidConnection}
            onDropAddItem={onDropAddItem}
            onRelayout={flowCanvasStore.onRelayout}
            onLayoutMeasured={flowCanvasStore.completeLayout}
            onInstance={flowCanvasStore.rfCommand.onRFInstance}
            onInit={flowCanvasStore.onInit}
            onCopy={flowCanvasStore.onCopy}
            onPaste={flowCanvasStore.onPaste}
            waitNode={flowCanvasStore.waitNode}
            duplicateNodes={flowCanvasStore.duplicateNodes}
          ></ReactFlowContainer>
        </NodeMiniMapProvider>
      </CanvasStoreProvider>
    </InspectSelectionContext.Provider>
  )
}
