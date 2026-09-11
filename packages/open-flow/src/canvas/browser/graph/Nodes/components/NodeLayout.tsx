import styles from './NodeLayout.module.scss'
import type { CSSProperties } from 'react'
import type { Val } from 'value-enhancer'
import type { HandleName } from '../../../../../schema/index.ts'
import type { RFNodeId } from '../../../base/rfHelpers.ts'
import type { HandleProps } from '../../../components/handle.tsx'
import type { CanvasStore } from '../../../stores/canvas/canvas.store.ts'

import { useConnection, useNodeConnections, useStoreApi } from '@xyflow/react'
import { clsx } from 'clsx'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { useTranslate } from 'val-i18n-react'
import { DEFAULT_POSITION } from '../../../base/canvas.ts'
import { toRFHandleName } from '../../../base/rfHelpers.ts'
import { Handle } from '../../../components/handle.tsx'
import { NodeMiniMapPhase, NodeMiniMapProvider, useNodeMiniMapPhase } from '../../../components/minimap.tsx'
import { NODE_MINIMAP_PHASE1_CLASSNAME, NODE_MINIMAP_PHASE2_CLASSNAME } from '../../../stores/canvas/nodeMiniMap.ts'
import { CommentNodeStore } from '../../../stores/node/commentNode.store.ts'
import { DEFAULT_NODE_WIDTH, FITTING_VIEW_CLASSNAME, MIN_NODE_WIDTH, NODE_TYPE } from '../../../stores/node/constants.ts'
import { NodeStore } from '../../../stores/node/node.store.ts'
import { conditionBranchSummary } from '../../FlowCanvas/cardContent.ts'
import { NodeStoreContext } from '../NodeStoreContext.tsx'
import { CanvasNode } from './CanvasNode.tsx'
import { CommentCard } from './CommentCard.tsx'
import { NodeFloatBar, NodeHeadContextMenu } from './NodeHeadMoreMenu.tsx'
import { NodeMinimap } from './NodeMinimap.tsx'
import { useShowNodeError } from './useShowNodeError.ts'

export interface NodeLayoutProps {
  canvasStore: CanvasStore
  nodeStore: NodeStore | CommentNodeStore
  visible: boolean
}

const CARD_WIDTH = 320

export const NodeLayout: React.FC<NodeLayoutProps> = /* @__PURE__ */ memo(({ canvasStore, nodeStore, visible }) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const t = useTranslate()
  const modelNode = useVal(NodeStore.to(nodeStore)?.content$)

  const branches =
    modelNode?.kind == 'condition' || modelNode?.kind == 'wait' ? modelNode.outputs.flatMap((port) => ('handle' in port ? [port.handle] : [])) : undefined
  const executionInput = modelNode != null && modelNode.kind != 'trigger' && modelNode.kind != 'value'
  const editable = useVal(canvasStore.$.editable)
  const contentWidth$ = nodeStore.interaction.contentWidth
  const selected = useVal(nodeStore.$.selected)
  const [hovered, setHovered] = useState(false)
  const [hintTriggered, setHintTriggered] = useState(false)
  // Only uninterrupted hover starts a hint session; selection can preserve it after the delay.
  const hintRequested = hintTriggered && (hovered || selected === true) && visible
  useEffect(() => {
    if (!hovered) return
    const timer = window.setTimeout(() => setHintTriggered(true), 2000)
    return () => window.clearTimeout(timer)
  }, [hovered])
  useEffect(() => {
    if (!hovered && !selected) setHintTriggered(false)
  }, [hovered, selected])
  const skip = useVal(NodeStore.to(nodeStore)?.ignore)
  const showError = useShowNodeError(nodeStore)
  const cardStore = NodeStore.is(nodeStore) ? nodeStore : undefined
  const canvasMiniMapPhase = useNodeMiniMapPhase()
  const nodeMiniMapPhase = cardStore ? NodeMiniMapPhase.None : visible ? canvasMiniMapPhase : selected ? NodeMiniMapPhase.None : NodeMiniMapPhase.Phase2

  const handleTrack = useHandleTrack(nodeStore.rfNodeId, MIN_NODE_WIDTH, contentWidth$, containerRef, DEFAULT_NODE_WIDTH)

  const initialized = useVal(canvasStore.$.initialized)
  const animateEntry = useRef(initialized).current

  const contentWidth = useVal(contentWidth$)
  const selectedOutlineColor = showError ? 'var(--edge-error)' : undefined
  const conditionNode = modelNode?.kind == 'condition' ? modelNode : undefined

  const containerStyle: CSSProperties = {
    width: cardStore ? CARD_WIDTH : Math.max(contentWidth || DEFAULT_NODE_WIDTH, MIN_NODE_WIDTH),
    ['--node-selected-border-color' as any]: selectedOutlineColor,
    ['--node-selected-shadow' as any]: showError ? 'var(--node-error-selected-shadow)' : undefined,
  }
  const card = cardStore ? (
    <CanvasNode
      nodeStore={cardStore}
      compact={canvasMiniMapPhase !== NodeMiniMapPhase.None}
      showError={showError}
      branches={branches?.map((branch) => {
        const summary =
          conditionNode != null ? conditionBranchSummary(conditionNode, branch, t) : modelNode?.kind == 'wait' ? t(`canvasCard.waitBranch.${branch}`) : ''
        return (
          <div key={branch} className={clsx(styles.executionBranch, styles.branchRow)}>
            {summary && (
              <span className={styles.branchRule} title={summary}>
                {summary}
              </span>
            )}
            {summary && (
              <span aria-hidden="true" className={styles.branchArrow}>
                →
              </span>
            )}
            <span className={styles.branchName}>{branch}</span>
            <ExecutionHandle id={toRFHandleName(`$branch:${branch}` as HandleName)} type="output" isConnectable={editable} hintRequested={hintRequested} />
          </div>
        )
      })}
    />
  ) : undefined

  return (
    <NodeMiniMapProvider value={nodeMiniMapPhase}>
      <NodeStoreContext.Provider value={nodeStore}>
        <div
          className={clsx(
            styles.outerContainer,
            animateEntry && styles.enter,
            !initialized && FITTING_VIEW_CLASSNAME,
            nodeMiniMapPhase >= NodeMiniMapPhase.Phase1 && NODE_MINIMAP_PHASE1_CLASSNAME,
            nodeMiniMapPhase >= NodeMiniMapPhase.Phase2 && NODE_MINIMAP_PHASE2_CLASSNAME,
          )}
        >
          <div className={clsx(styles.offsetContainer, skip && styles.skipOuter)}>
            <NodeFloatBar canvasStore={canvasStore} nodeStore={nodeStore} />
            <NodeMinimap />
            {!cardStore && <div data-pos="w" className={`${styles.resizeHandle} ${styles.resizeHandleW}`} onPointerDown={handleTrack} />}
            <main
              onPointerEnter={(event) => {
                if (event.pointerType !== 'touch') {
                  setHovered(true)
                }
              }}
              onPointerLeave={() => setHovered(false)}
              ref={containerRef}
              className={clsx(styles.container, styles.cardContainer, skip && styles.skip)}
              style={containerStyle}
            >
              <div className={styles.executionHead}>
                {card ? (
                  <NodeHeadContextMenu canvasStore={canvasStore}>{card}</NodeHeadContextMenu>
                ) : CommentNodeStore.is(nodeStore) ? (
                  <CommentCard store={nodeStore} />
                ) : null}
                {executionInput && (
                  <ExecutionHandle id={toRFHandleName('$in' as HandleName)} type="input" isConnectable={editable} hintRequested={hintRequested} />
                )}
                {nodeStore.nodeType != NODE_TYPE.CommentNode && branches == null && (
                  <ExecutionHandle id={toRFHandleName('$out' as HandleName)} type="output" isConnectable={editable} hintRequested={hintRequested} />
                )}
              </div>
            </main>
            {!cardStore && <div data-pos="e" className={`${styles.resizeHandle} ${styles.resizeHandleE}`} onPointerDown={handleTrack} />}
          </div>
        </div>
      </NodeStoreContext.Provider>
    </NodeMiniMapProvider>
  )
})

function ExecutionHandle({ id, type, isConnectable, hintRequested }: Pick<HandleProps, 'id' | 'type' | 'isConnectable'> & { hintRequested: boolean }) {
  const handleType = type == 'input' ? 'target' : 'source'
  // Any connection on this side makes all of its ports visible and suppresses hints.
  const sideConnections = useNodeConnections({ handleType })
  const connecting = useConnection((connection) => connection.inProgress && connection.fromHandle.type != handleType)
  const inProgress = useConnection((connection) => connection.inProgress)
  const canHint = isConnectable && sideConnections.length === 0 && !inProgress
  const showHint = hintRequested && canHint
  const [hintMounted, setHintMounted] = useState(false)
  const [hintFinished, setHintFinished] = useState(false)
  useEffect(() => {
    if (!showHint) {
      const timer = window.setTimeout(() => setHintMounted(false), 320)
      return () => window.clearTimeout(timer)
    }
    setHintMounted(true)
    setHintFinished(false)
    // Ten 800ms rounds, then fade while the movement continues.
    const fade = window.setTimeout(() => setHintFinished(true), 10 * 800)
    const remove = window.setTimeout(() => setHintMounted(false), 10 * 800 + 320)
    return () => {
      window.clearTimeout(fade)
      window.clearTimeout(remove)
    }
  }, [showHint])
  return (
    <Handle
      id={id}
      type={type}
      isConnectable={isConnectable}
      className={clsx(styles.executionHandle, sideConnections.length > 0 && styles.connected, isConnectable && connecting && styles.connecting)}
    >
      {canHint && hintMounted && (
        <span
          aria-hidden="true"
          className={clsx(styles.connectionHint, type === 'input' && styles.inputHint, (!showHint || hintFinished) && styles.hintLeaving)}
        >
          <i className={type === 'input' ? 'i-lucide:chevron-left' : 'i-lucide:chevron-right'} />
        </span>
      )}
    </Handle>
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
