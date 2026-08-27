import type { BlockDesignerStore } from '../../stores/designer/blockDesigner.store.ts'

import { useVal } from 'use-value-enhancer'
import { NodeMiniMapProvider } from '../../components/minimap.tsx'
import { EDGE_TYPES, NODE_TYPES } from '../constants.tsx'
import { DesignerStoreProvider } from '../DesignerStoreContext.tsx'
import { ReactFlowContainer } from '../ReactFlowContainer/ReactFlowContainer.tsx'
import { fitViewOptions } from './constants.ts'

export interface BlockDesignerProps {
  blockDesignerStore: BlockDesignerStore
  dark: boolean
  fitView?: boolean
  className?: string
}

export const BlockDesigner: React.FC<BlockDesignerProps> = ({ blockDesignerStore, dark, fitView, className }) => {
  const editable = useVal(blockDesignerStore.$.editable)
  const nodeMiniMapPhase = useVal(blockDesignerStore.$.nodeMiniMapPhase)

  return (
    <DesignerStoreProvider value={blockDesignerStore}>
      <NodeMiniMapProvider value={nodeMiniMapPhase}>
        <ReactFlowContainer
          focused$={blockDesignerStore.focused$}
          canDeleteNodes={false}
          editable={editable}
          className={className}
          i18n={blockDesignerStore.i18n}
          dark={dark}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          interactiveMode$={blockDesignerStore.$$.interactiveMode}
          graph$={blockDesignerStore.$.rfGraph}
          viewport$={blockDesignerStore.$$.viewport}
          onBeforeDelete={blockDesignerStore.onBeforeDelete}
          onNodesChange={blockDesignerStore.handleNodesChange}
          onEdgesChange={blockDesignerStore.handleEdgesChange}
          fitView={fitView ?? !editable}
          fitViewOptions={fitViewOptions}
          onInit={blockDesignerStore.onInit}
          onFitView={blockDesignerStore.onFitView}
          onPaste={blockDesignerStore.onPaste}
        />
      </NodeMiniMapProvider>
    </DesignerStoreProvider>
  )
}
