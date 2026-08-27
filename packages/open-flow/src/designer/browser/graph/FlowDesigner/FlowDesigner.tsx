import type { IsValidConnection, OnMoveEnd, OnNodeDrag, OnSelectionChangeFunc, XYPosition, Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { FlowDesignerStore } from '../../stores/designer/flowDesigner.store.ts'

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
  className?: string
  addNodeRequest?: { readonly position: XYPosition }
  onMoveEnd?: OnMoveEnd
  onNodeDragStop?: OnNodeDrag<RFNode<any>>
  onSelectionChange?: OnSelectionChangeFunc<RFNode<any>, RFEdge<any>>
  isValidConnection?: IsValidConnection<RFEdge<any>>
  onDropAddItem?: (itemId: string, position: XYPosition) => void
}

export const FlowDesigner: React.FC<FlowDesignerProps> = ({
  flowDesignerStore,
  dark,
  fitView,
  className,
  addNodeRequest,
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
          showSettings$={flowDesignerStore.$$.showSettings}
          focused$={flowDesignerStore.focused$}
          editable={editable}
          className={className}
          i18n={flowDesignerStore.i18n}
          dark={dark}
          dottedBackground
          fitView={fitView ?? !editable}
          fitViewOptions={fitViewOptions}
          nodeTypes={NODE_TYPES}
          edgeTypes={FLOW_EDGE_TYPES}
          miniMapExpanded$={flowDesignerStore.$$.miniMapExpanded}
          displayMode$={flowDesignerStore.$$.displayMode}
          interactiveMode$={flowDesignerStore.$$.interactiveMode}
          graph$={flowDesignerStore.$.renderedRFGraph}
          viewport$={flowDesignerStore.$$.viewport}
          addNodeRequest={addNodeRequest}
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
          <FlowSettingsContainer />
        </ReactFlowContainer>
      </NodeMiniMapProvider>
    </DesignerStoreProvider>
  )
}
