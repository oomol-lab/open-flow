import styles from './NodeLayout.module.scss'
import type { CSSProperties } from 'react'
import type { Val } from 'value-enhancer'
import type { HandleName } from '../../../../../schema/index.ts'
import type { RFNodeId } from '../../../base/rfHelpers.ts'
import type { HandleProps } from '../../../components/handle.tsx'
import type { DesignerStore } from '../../../stores/designer/designer.store.ts'
import type { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'

import { useConnection, useNodeConnections, useStoreApi } from '@xyflow/react'
import { clsx } from 'clsx'
import { memo, useCallback, useRef } from 'react'
import { useDerived, useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { DEFAULT_POSITION } from '../../../base/designer.ts'
import { toRFHandleName } from '../../../base/rfHelpers.ts'
import { Handle } from '../../../components/handle.tsx'
import { NodeMiniMapPhase, NodeMiniMapProvider, useNodeMiniMapPhase } from '../../../components/minimap.tsx'
import { Running } from '../../../components/running.tsx'
import { NODE_MINIMAP_PHASE1_CLASSNAME, NODE_MINIMAP_PHASE2_CLASSNAME } from '../../../stores/designer/nodeMiniMap.ts'
import { SUBFLOW_VIEW_MODE } from '../../../stores/designer/subflowDesigner.store.ts'
import { DESIGNER_TYPE } from '../../../stores/designer/typings.ts'
import { DEFAULT_NODE_WIDTH, FITTING_VIEW_CLASSNAME, isManifestNodeType, isPseudoNodeType, MIN_NODE_WIDTH, NODE_TYPE } from '../../../stores/node/constants.ts'
import { NodeStore } from '../../../stores/node/node.store.ts'
import { useSubflowViewMode } from '../../SubflowDesigner/SubflowViewModeContext.ts'
import { NodeStoreContext } from '../NodeStoreContext.tsx'
import { CanvasNode } from './CanvasNode.tsx'
import { NodeBody } from './NodeBody.tsx'
import { NodeDescriptionPopup } from './NodeDescriptionPopup.tsx'
import { NodeHead } from './NodeHead.tsx'
import { NodeFloatBar, NodeHeadContextMenu, NodeSettingsPanelHost } from './NodeHeadMoreMenu.tsx'
import { NodeMinimap } from './NodeMinimap.tsx'
import { NodeOutline } from './NodeOutline.tsx'
import { NodeProgress } from './NodeProgress.tsx'
import { NodeStatusLabel } from './NodeStatusLabel.tsx'
import { NodeTopLeftLabel } from './NodeTopLeftLabel.tsx'
import { useShowNodeError } from './useShowNodeError.ts'

export interface NodeLayoutProps {
  designerStore: DesignerStore
  nodeStore: NodeStore | CommentNodeStore
  visible: boolean
}

const CARD_WIDTH = 320

export const NodeLayout: React.FC<NodeLayoutProps> = /* @__PURE__ */ memo(({ designerStore, nodeStore, visible }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)

  const branches = useVal(nodeStore.display$?.branches)
  const executionInput = useVal(nodeStore.display$?.executionInput) ?? false
  const editable = useVal(designerStore.$.editable)
  const contentWidth$ = nodeStore.uiStore.$$.contentWidth
  const { status, progress, showSettings } = nodeStore.display$ || {}
  const selected = useVal(nodeStore.$.selected)
  const skip = useVal(nodeStore.display$?.ignore)
  const showError = useShowNodeError(nodeStore)
  const isSubflowBlock = useSubflowViewMode() === SUBFLOW_VIEW_MODE.Block
  const isInBlock = designerStore.designerType === DESIGNER_TYPE.Block || isSubflowBlock
  const cardStore = !isInBlock && NodeStore.is(nodeStore) ? nodeStore : undefined
  const canvasMiniMapPhase = useNodeMiniMapPhase()
  const nodeMiniMapPhase = cardStore ? NodeMiniMapPhase.None : visible ? canvasMiniMapPhase : selected ? NodeMiniMapPhase.None : NodeMiniMapPhase.Phase2

  const handleTrack = useHandleTrack(nodeStore.rfNodeId, MIN_NODE_WIDTH, contentWidth$, containerRef, DEFAULT_NODE_WIDTH)

  // Only apply the initial settings state to fitView so later node size calculations do not block canvas dragging.
  const initialized = useVal(designerStore.$.initialized)
  const animateEntry = useRef(initialized).current
  // The initial fitView does not currently account for the settings panel width.
  const settingsOpen = useDerived(showSettings, Boolean)

  const contentWidth = useVal(contentWidth$)
  const selectedOutlineColor = showError ? 'var(--edge-error)' : undefined

  const containerStyle: CSSProperties = {
    width: cardStore ? CARD_WIDTH : Math.max(contentWidth || DEFAULT_NODE_WIDTH, MIN_NODE_WIDTH),
    ['--node-selected-border-color' as any]: selectedOutlineColor,
    ['--node-selected-shadow' as any]: showError ? 'var(--node-error-selected-shadow)' : undefined,
  }
  const card = cardStore ? (
    <CanvasNode
      nodeStore={cardStore}
      showError={showError}
      branches={branches?.map((branch) => (
        <div key={branch} className={styles.executionBranch}>
          <span>{branch}</span>
          <ExecutionHandle id={toRFHandleName(`$branch:${branch}` as HandleName)} type="output" isConnectable={editable} />
        </div>
      ))}
    />
  ) : undefined

  const t = useTranslate()

  return (
    <NodeMiniMapProvider value={nodeMiniMapPhase}>
      <NodeStoreContext.Provider value={nodeStore}>
        <div
          className={clsx(
            styles.outerContainer,
            animateEntry && styles.enter,
            !initialized && settingsOpen && styles.settingsOpen,
            !initialized && FITTING_VIEW_CLASSNAME,
            nodeMiniMapPhase >= NodeMiniMapPhase.Phase1 && NODE_MINIMAP_PHASE1_CLASSNAME,
            nodeMiniMapPhase >= NodeMiniMapPhase.Phase2 && NODE_MINIMAP_PHASE2_CLASSNAME,
          )}
        >
          <div className={clsx(styles.offsetContainer, skip && styles.skipOuter)}>
            {!cardStore && !isPseudoNodeType(nodeStore.nodeType) && !isInBlock && (
              <>
                <NodeFloatBar designerStore={designerStore} nodeStore={nodeStore} />
                <NodeSettingsPanelHost designerStore={designerStore} nodeStore={nodeStore} />
              </>
            )}
            {nodeMiniMapPhase >= NodeMiniMapPhase.Phase1 && nodeStore.nodeType == NODE_TYPE.InputNode && (
              <NodeTopLeftLabel viewport$={designerStore.$.viewport}>
                <i className="i-carbon:port-input mr-1" /> {t('inputHandleEditor.title')}
              </NodeTopLeftLabel>
            )}
            {nodeMiniMapPhase >= NodeMiniMapPhase.Phase1 && nodeStore.nodeType == NODE_TYPE.OutputNode && (
              <NodeTopLeftLabel viewport$={designerStore.$.viewport}>
                <i className="i-carbon:port-output mr-1" /> {t('outputHandleEditor.title')}
              </NodeTopLeftLabel>
            )}
            {!cardStore && !selected && status && nodeStore.display$ && (
              <NodeStatusLabel
                skip$={nodeStore.display$.ignore}
                flowStatus$={designerStore.$.runStatus}
                nodeStatus$={status}
                progress$={progress}
                successCount$={nodeStore.display$.successCount}
                viewport$={designerStore.$.viewport}
              />
            )}
            {!cardStore && status && <Running variant="gradient" status$={status} scale$={designerStore.$.scale} />}
            <NodeMinimap />
            {!cardStore && <div data-pos="w" className={`${styles.resizeHandle} ${styles.resizeHandleW}`} onPointerDown={handleTrack} />}
            <main ref={containerRef} className={clsx(styles.container, cardStore && styles.cardContainer, skip && styles.skip)} style={containerStyle}>
              <div className={styles.executionHead}>
                {card ? (
                  isPseudoNodeType(nodeStore.nodeType) ? (
                    card
                  ) : (
                    <NodeHeadContextMenu designerStore={designerStore}>{card}</NodeHeadContextMenu>
                  )
                ) : (
                  <NodeHead />
                )}
                {executionInput && <ExecutionHandle id={toRFHandleName('$in' as HandleName)} type="input" isConnectable={editable} />}
                {!isPseudoNodeType(nodeStore.nodeType) && nodeStore.nodeType != NODE_TYPE.CommentNode && branches == null && (
                  <ExecutionHandle id={toRFHandleName('$out' as HandleName)} type="output" isConnectable={editable} />
                )}
              </div>
              {!card && (
                <>
                  <NodeProgress progress$={progress} status$={status} />
                  <NodeBody />
                  <NodeOutline />
                </>
              )}
            </main>
            {!cardStore && <div data-pos="e" className={`${styles.resizeHandle} ${styles.resizeHandleE}`} onPointerDown={handleTrack} />}
          </div>
          {!cardStore && nodeStore.manifest$ && isManifestNodeType(nodeStore.nodeType) && (
            <NodeDescriptionPopup editable={editable} rawValue$={nodeStore.manifest$.description} displayValue$={nodeStore.display$.description} />
          )}
        </div>
      </NodeStoreContext.Provider>
    </NodeMiniMapProvider>
  )
})

function ExecutionHandle({ id, type, isConnectable }: Pick<HandleProps, 'id' | 'type' | 'isConnectable'>) {
  const handleType = type == 'input' ? 'target' : 'source'
  const connections = useNodeConnections({ handleType, handleId: id })
  const connecting = useConnection((connection) => connection.inProgress && connection.fromHandle.type != handleType)
  return (
    <Handle
      id={id}
      type={type}
      isConnectable={isConnectable}
      className={clsx(styles.executionHandle, connections.length > 0 && styles.connected, isConnectable && connecting && styles.connecting)}
    />
  )
}

function useHandleTrack(
  rfNodeId: RFNodeId,
  minWidth: number,
  width$: Val<number | undefined>,
  containerRef: React.RefObject<HTMLDivElement | null>,
  defaultWidth: number,
) {
  const reactFlowStore = useStoreApi()

  return useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!event.isPrimary || event.target !== event.currentTarget || (event.button != null && event.button !== 0)) {
        return
      }

      const isW = event.currentTarget.dataset.pos === 'w'
      const deltaDirection = isW ? -1 : 1

      const reactFlowState = reactFlowStore.getState()
      const node = reactFlowState.nodeLookup.get(rfNodeId)
      if (isW && !node) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const startPointerX = event.clientX

      const scale = reactFlowState.transform[2]

      const { x: startNodeX, y: startNodeY } = node?.position || DEFAULT_POSITION
      const startWidth = width$.value !== undefined ? Math.max(minWidth, width$.value) : defaultWidth

      const mask = document.createElement('div')
      mask.className = styles.mask
      if (reactFlowState.domNode) {
        reactFlowState.domNode.append(mask)
      }

      function handleTrackMove(pointerEvent: PointerEvent): void {
        if (!pointerEvent.isPrimary) {
          return
        }

        if (pointerEvent.buttons <= 0) {
          handleTrackEnd()
          return
        }

        pointerEvent.preventDefault()
        pointerEvent.stopPropagation()

        const nodeDeltaX = ((pointerEvent.clientX - startPointerX) / scale) * deltaDirection

        const width = Math.max(minWidth, startWidth + nodeDeltaX)

        width$.set(width)
        containerRef.current?.style.setProperty('width', `${width}px`)

        if (isW && node) {
          reactFlowState.triggerNodeChanges([
            {
              type: 'position',
              id: rfNodeId,
              position: {
                x: Math.min(startNodeX - nodeDeltaX, startNodeX + startWidth - minWidth),
                y: startNodeY,
              },
            },
          ])
        }
      }

      function handleTrackEnd(): void {
        mask.remove()
        window.removeEventListener('pointermove', handleTrackMove)
        window.removeEventListener('pointerup', handleTrackEnd)
        window.removeEventListener('pointercancel', handleTrackEnd)
        window.removeEventListener('blur', handleTrackEnd)
      }

      window.addEventListener('pointermove', handleTrackMove)
      window.addEventListener('pointerup', handleTrackEnd, { passive: true })
      window.addEventListener('pointercancel', handleTrackEnd, {
        passive: true,
      })
      window.addEventListener('blur', handleTrackEnd, { passive: true })
    },
    [rfNodeId, minWidth, width$, reactFlowStore, defaultWidth],
  )
}
