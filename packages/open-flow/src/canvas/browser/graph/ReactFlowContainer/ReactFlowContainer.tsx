import nodeHeadStyles from '../Nodes/components/NodeHead.module.scss'
import styles from './ReactFlowContainer.module.scss'
import './ReactFlowContainer.scss'
import type {
  Dimensions,
  EdgeTypes,
  FitViewOptions,
  IsValidConnection,
  NodeChange,
  NodeTypes,
  OnBeforeDelete,
  OnConnect,
  OnConnectEnd,
  OnEdgesChange,
  OnInit,
  OnMoveEnd,
  OnNodeDrag,
  OnNodesChange,
  OnSelectionChangeFunc,
  ReactFlowInstance,
  ReactFlowState,
  Rect,
  Edge as RFEdge,
  Node as RFNode,
  Viewport,
  XYPosition,
} from '@xyflow/react'
import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { NodeId } from '../../../../schema/index.ts'
import type { AddNodeType } from '../../base/dragNDrop.ts'
import type { RFConnection, RFHandleName, RFNodeId } from '../../base/rfHelpers.ts'
import type { HandleImpl } from '../../components/handle.tsx'
import type { InteractiveMode, RFGraph } from '../../stores/canvas/canvas.store.ts'
import type { FlowCanvasViewProps } from '../FlowCanvas/model.ts'
import type { GetPopupContainer } from './useGetPopupContainer.ts'

import {
  Background,
  BackgroundVariant,
  Handle,
  NodeToolbar,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useNodes,
  useReactFlow,
  useStore,
  useStoreApi,
  useUpdateNodeInternals,
  useViewport,
  ViewportPortal,
} from '@xyflow/react'
import { clsx } from 'clsx'
import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVal } from 'use-value-enhancer'
import { I18nProvider, useTranslate } from 'val-i18n-react'
import { combine, derive } from 'value-enhancer'
import { shallowPlainObjectEqual } from '../../../../base/common/equality.ts'
import { getAddItemId } from '../../../../canvas/browser/addItemDrag.ts'
import { Button } from '../../../../ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { IconThemeContext } from '../../../../ui/browser/icons/iconTheme.ts'
import { TooltipProvider } from '../../../../ui/browser/tooltip.tsx'
import { CANVAS_CLASSNAME } from '../../base/canvas.ts'
import { getScriptletType, getSharedBlockPath, getTriggerType, isWithCommentType, isWithConditionType, isWithValueType } from '../../base/dragNDrop.ts'
import { toManifestHandleName, toManifestNodeId } from '../../base/rfHelpers.ts'
import { coalesce, toTrue } from '../../base/trivial.ts'
import { HandleContextProvider } from '../../components/handle.tsx'
import { CanvasTooltip } from '../../components/tooltip.tsx'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { FITTING_VIEW_CLASSNAME } from '../../stores/node/constants.ts'
import { NodeStore } from '../../stores/node/node.store.ts'
import { InspectSelectionButton } from '../inspectSelection.tsx'
import { NodePlaceholder, NodePlaceholderQueue } from '../Nodes/useNodePlaceholder.ts'
import { getPaneRect, PaneRectContext } from '../Nodes/usePaneRect.ts'
import { CanvasBottomRightControls, CanvasTopLeftControls, CanvasToolbar, CanvasViewControls } from './CanvasControls.tsx'
import { ConnectionLine } from './ConnectingLine.tsx'
import { CornerControls } from './CornerControls.tsx'
import { HelperLines, useHelperLines } from './HelperLines/index.ts'
import { GetPopupContainerContext, useGetStaticPopupContainer } from './useGetPopupContainer.ts'

// Mouse buttons.
const PAN_ON_DRAG_MOUSE = [0]
const PAN_ON_DRAG_TOUCHPAD = [1]

const GRID_GAP: [number, number] = [20, 20]

function getViewportTransitionDuration() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200
}

const PRO_OPTIONS = { hideAttribution: true }

const LAYOUT_TRANSITION_DURATION = 200
const LAYOUT_REFLOW_DELAY = LAYOUT_TRANSITION_DURATION + 100

function isNodeInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, input, textarea, a, [contenteditable="true"]') != null
}

const GET_SIZE = (s: ReactFlowState): Dimensions => ({
  width: s.width,
  height: s.height,
})

const isSizeEqual = (a: Dimensions, b: Dimensions) => a.width === b.width && a.height === b.height

const isRectEqual = (a: Rect, b: Rect) => isSizeEqual(a, b) && a.x === b.x && a.y === b.y

export interface ReactFlowContainerProps {
  onActivateSelection?: () => void
  onInspectSelection?: () => void
  onSelectionStart?: () => void
  onSelectionEnd?: () => void
  onRequestAddNode?: FlowCanvasViewProps['onRequestAddNode']
  className?: string
  cornerTools?: React.ReactNode
  cornerLeading?: React.ReactNode
  topLeftTools?: React.ReactNode
  bottomRightTools?: React.ReactNode
  dark: boolean
  i18n: I18n
  miniMapExpanded$?: Val<boolean | undefined>
  interactiveMode$: Val<InteractiveMode>
  editable: boolean
  nodeTypes?: NodeTypes
  edgeTypes?: EdgeTypes
  nodes$: ReadonlyVal<RFGraph['nodes']>
  edges$: ReadonlyVal<RFGraph['edges']>
  viewport$: Val<Viewport | undefined>
  focused$?: ReadonlyVal<boolean>
  canDeleteNodes?: boolean
  onBeforeDelete: OnBeforeDelete<RFNode<any>, RFEdge<any>>
  onNodesChange: OnNodesChange<RFNode<any>>
  onEdgesChange: OnEdgesChange<RFEdge<any>>
  onConnect?: OnConnect
  onMoveEnd?: OnMoveEnd
  onNodeDragStop?: OnNodeDrag<RFNode<any>>
  onSelectionChange?: OnSelectionChangeFunc<RFNode<any>, RFEdge<any>>
  isValidConnection?: IsValidConnection<RFEdge<any>>
  addNodeRequest?: {
    readonly onComplete?: () => void
    readonly position: XYPosition
    readonly screenPosition?: XYPosition
  }
  addItemRequest?: {
    readonly itemId: string
    readonly onComplete?: (nodeId: string | undefined) => void
    readonly position: XYPosition
    readonly screenPosition?: XYPosition
  }
  duplicateNodes?: (manifestNodeIds?: NodeId[], offset?: XYPosition) => Promise<void>
  waitNode?: (nodeId: NodeId) => Promise<NodeStore | undefined>
  onAddNode?: (
    type: AddNodeType,
    payload: string,
    position: { x: number; y: number },
    connection?: (nodeId: NodeId) => RFConnection,
  ) => Promise<NodeId | undefined>
  onDropAddItem?: (itemId: string, position: XYPosition) => Promise<string | undefined> | string | undefined
  onRelayout?: () => void
  onLayoutMeasured?: () => boolean | 'relayout'
  onFitView?: () => void
  onInstance?: (rf: ReactFlowInstance) => () => void
  onInit?: OnInit<RFNode<any>, RFEdge<any>>
  onCopy?: (nodeIds: NodeId[]) => void
  onPaste?: (position?: XYPosition) => void
  fitView?: boolean
  fitViewOptions?: FitViewOptions
  layoutMotion?: boolean
  dottedBackground?: boolean
  toolbar?: React.ReactNode
  children?: React.ReactNode
}

export const ReactFlowContainer: React.FC<ReactFlowContainerProps> = (props: ReactFlowContainerProps) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  const context = useMemo((): GetPopupContainer => {
    return {
      default: () => wrapperRef.current?.querySelector('.react-flow__viewport') || wrapperRef.current || document.body,
      static: () => wrapperRef.current || document.body,
    }
  }, [])

  return (
    <IconThemeContext.Provider value={props.dark ? 'dark' : 'light'}>
      <div
        className={clsx(props.className, 'open-flow-canvas-root', styles.container, 'open-flow-theme')}
        data-surface="canvas"
        data-theme={props.dark ? 'dark' : 'light'}
        ref={wrapperRef}
      >
        <GetPopupContainerContext.Provider value={context}>
          <I18nProvider i18n={props.i18n}>
            <TooltipProvider delay={300}>
              <ReactFlowProvider>
                <HandleContextProvider Handle={Handle as HandleImpl}>
                  <ReactFlowContainerInner {...props} />
                </HandleContextProvider>
              </ReactFlowProvider>
            </TooltipProvider>
          </I18nProvider>
        </GetPopupContainerContext.Provider>
      </div>
    </IconThemeContext.Provider>
  )
}

type FlowControlsProps = Pick<
  ReactFlowContainerProps,
  | 'cornerTools'
  | 'cornerLeading'
  | 'topLeftTools'
  | 'bottomRightTools'
  | 'toolbar'
  | 'miniMapExpanded$'
  | 'interactiveMode$'
  | 'onRelayout'
  | 'onFitView'
  | 'dottedBackground'
  | 'layoutMotion'
> & { onBeforeFitView?: () => void }

const selector = (s: ReactFlowState) => ({
  minZoomReached: s.transform[2] <= s.minZoom,
  maxZoomReached: s.transform[2] >= s.maxZoom,
  zoom: s.transform[2],
})

const FlowControls = /*#__PURE__*/ memo((props: FlowControlsProps) => {
  const rf = useReactFlow()
  const { minZoomReached, maxZoomReached, zoom } = useStore(selector, shallowPlainObjectEqual)
  const nodes = useNodes()

  // The SVG background pattern needs a document-unique identifier without CSS-special characters.
  const bgId = useId().replaceAll(':', '')

  const selectedNodes = nodes.filter((node) => node.selected)
  const fitViewOptions: FitViewOptions = {
    padding: 0.15,
    duration: props.layoutMotion === false ? 0 : 150,
    maxZoom: 1,
  }
  const relayout =
    props.onRelayout == null
      ? undefined
      : () => {
          props.onRelayout?.()
          props.onBeforeFitView?.()
          // Wait for the node description height before fitting the view to avoid overlap.
          setTimeout(() => rf.fitView(fitViewOptions), 100)
        }

  return (
    <>
      {props.dottedBackground && <Background id={bgId} color="var(--canvas-grid)" gap={GRID_GAP} size={2} variant={BackgroundVariant.Dots} />}
      <CanvasViewControls
        interactiveMode$={props.interactiveMode$}
        miniMapExpanded$={props.miniMapExpanded$}
        maxZoomReached={maxZoomReached}
        minZoomReached={minZoomReached}
        onFitView={() => {
          props.onBeforeFitView?.()
          // Wait for the node description height before fitting the view to avoid overlap.
          setTimeout(() => {
            rf.fitView({
              ...fitViewOptions,
              duration: getViewportTransitionDuration(),
              nodes: selectedNodes.length === 0 ? undefined : selectedNodes,
            })
            props.onFitView?.()
          }, 100)
        }}
        onRelayout={relayout}
        onZoomIn={() => rf.zoomIn({ duration: getViewportTransitionDuration() })}
        onZoomOut={() => rf.zoomOut({ duration: getViewportTransitionDuration() })}
        onZoomReset={() => rf.zoomTo(1, { duration: getViewportTransitionDuration() })}
        zoom={zoom}
      />
      {props.toolbar != null && <CanvasToolbar>{props.toolbar}</CanvasToolbar>}
      {props.topLeftTools != null && <CanvasTopLeftControls>{props.topLeftTools}</CanvasTopLeftControls>}
      {props.bottomRightTools != null && <CanvasBottomRightControls>{props.bottomRightTools}</CanvasBottomRightControls>}
      <CornerControls before={props.cornerLeading}>{props.cornerTools}</CornerControls>
    </>
  )
})

interface EdgeContextMenuData {
  readonly edge: RFEdge<any>
  readonly event: React.MouseEvent
}

interface SelectionContextMenuData {
  readonly nodes: RFNode<any>[]
  readonly event: React.MouseEvent
}

// Isolate the inner component because React Flow updates frequently.
const ReactFlowContainerInner = (props: ReactFlowContainerProps) => {
  const flowState = useStoreApi()
  const selecting = useRef(false)
  const selectionEnd = useRef(props.onSelectionEnd)
  selectionEnd.current = props.onSelectionEnd
  const endSelection = useCallback(() => {
    if (!selecting.current) return
    selecting.current = false
    flowState.setState({ userSelectionActive: false, userSelectionRect: null })
    selectionEnd.current?.()
  }, [flowState])
  useEffect(() => {
    const keyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && selecting.current) {
        event.preventDefault()
        event.stopPropagation()
        endSelection()
      }
    }
    window.addEventListener('blur', endSelection)
    window.addEventListener('pointercancel', endSelection)
    window.addEventListener('pointerup', endSelection)
    window.addEventListener('keydown', keyDown, true)
    return () => {
      window.removeEventListener('blur', endSelection)
      window.removeEventListener('pointercancel', endSelection)
      window.removeEventListener('pointerup', endSelection)
      window.removeEventListener('keydown', keyDown, true)
    }
  }, [endSelection])
  const rf = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const mounted = useRef(true)
  const editCanvas = useCallback(
    (action?: () => void) => {
      if (props.editable) action?.()
    },
    [props.editable],
  )

  useLayoutEffect(() => props.onInstance?.(rf), [rf, props.onInstance])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [helperLineHorizontal, helperLineVertical, onBeforeApplyNodesChanges] = useHelperLines()

  const [edgeContextMenu, setEdgeContextMenu] = useState<EdgeContextMenuData | null>(null)

  const edgeContextMenuPosition = useMemo(
    () =>
      edgeContextMenu &&
      rf.screenToFlowPosition({
        x: edgeContextMenu.event.clientX,
        y: edgeContextMenu.event.clientY,
      }),
    [edgeContextMenu, rf],
  )

  const [paneContextMenu, setPaneContextMenu] = useState<{ position: XYPosition; screenPosition: XYPosition } | null>(null)

  const [selectionContextMenu, setSelectionContextMenu] = useState<SelectionContextMenuData | null>(null)

  const selectionContextMenuPosition = useMemo(
    () =>
      selectionContextMenu &&
      rf.screenToFlowPosition({
        x: selectionContextMenu.event.clientX,
        y: selectionContextMenu.event.clientY,
      }),
    [selectionContextMenu, rf],
  )

  useEffect(() => {
    const request = props.addNodeRequest
    if (request == null) return
    editCanvas(() => {
      const screenPosition = request.screenPosition ?? rf.flowToScreenPosition(request.position)
      props.onRequestAddNode?.({ position: rf.screenToFlowPosition(screenPosition), screenPosition })
      request.onComplete?.()
    })
  }, [editCanvas, props.addNodeRequest, props.onRequestAddNode, rf])

  useEffect(() => {
    const request = props.addItemRequest
    if (request == null) return
    editCanvas(() => {
      const position = request.screenPosition == null ? request.position : rf.screenToFlowPosition(request.screenPosition)
      Promise.resolve(props.onDropAddItem?.(request.itemId, position)).then(request.onComplete, (error) => {
        console.error('Failed to add node.', error)
        request.onComplete?.(undefined)
      })
    })
  }, [editCanvas, props.addItemRequest, props.onDropAddItem, rf])

  const pickerFrame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(pickerFrame.current), [])

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (!props.editable || !props.onRequestAddNode || state.isValid || state.toNode || !state.from || !state.fromNode || !state.fromHandle?.id) return
      const pointer = 'clientX' in event ? event : event.changedTouches[0]
      if (!pointer) return
      const screenPosition = { x: pointer.clientX, y: pointer.clientY }
      const position = rf.screenToFlowPosition(screenPosition)
      if (tooShort(state.from, position)) return
      const nodeId = toManifestNodeId(state.fromNode.id as RFNodeId)
      const handle = toManifestHandleName(state.fromHandle.id as RFHandleName)
      const connectionSide = state.fromHandle.type == 'target' ? 'left' : 'right'
      cancelAnimationFrame(pickerFrame.current)
      // Open after the release event so it cannot dismiss the new popover.
      pickerFrame.current = requestAnimationFrame(() =>
        props.onRequestAddNode?.({
          position: connectionSide == 'left' ? { x: position.x - 250, y: position.y } : position,
          screenPosition,
          connectionSide,
          connection:
            connectionSide == 'left'
              ? (source) => ({ source, sourceHandle: '$out', target: nodeId, targetHandle: handle })
              : (target) => ({ source: nodeId, sourceHandle: handle, target, targetHandle: '$in' }),
        }),
      )
    },
    [rf, props.editable, props.onRequestAddNode],
  )

  const editable = toTrue(props.editable)

  const interactiveMode = useVal(props.interactiveMode$)
  const isMouse = interactiveMode === 'mouse'

  const nodes = useVal(props.nodes$)
  // React Flow waits for each edge's endpoint measurements before rendering it.
  const edges = useVal(props.edges$)
  const selectionInProgress = useStore((state) => state.userSelectionActive)
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes])
  const deleteSelectedNodes = useCallback(async () => {
    if (await props.onBeforeDelete({ nodes: selectedNodes, edges: [] })) {
      props.onNodesChange(selectedNodes.map((node) => ({ type: 'remove', id: node.id })))
    }
  }, [props.onBeforeDelete, props.onNodesChange, selectedNodes])
  const nodeIdsRef = useRef<string[]>([])
  nodeIdsRef.current = nodes.map((node) => node.id)
  const layoutMounted = useRef(false)
  const [movingLayout, setMovingLayout] = useState(false)
  const [fittingView, setFittingView] = useState(false)
  const [layoutReady, setLayoutReady] = useState(props.layoutMotion !== false || props.onLayoutMeasured == null)
  const onBeforeFitView = useCallback(() => setFittingView(true), [])

  useLayoutEffect(() => {
    setLayoutReady(props.layoutMotion !== false || props.onLayoutMeasured == null)
  }, [props.layoutMotion, props.onLayoutMeasured])

  useEffect(() => {
    let active = true
    let measurementFrame = 0
    let readyFrame = 0
    let fitTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const completeLayout = () => {
      const result = props.onLayoutMeasured?.()
      if (result === false && attempts++ < 5) {
        measurementFrame = requestAnimationFrame(completeLayout)
      } else if (result === 'relayout') {
        onBeforeFitView()
        fitTimer = setTimeout(
          async () => {
            await rf.fitView({ padding: 0.15, duration: props.layoutMotion === false ? 0 : 150, maxZoom: 1 })
            if (!active) return
            readyFrame = requestAnimationFrame(() => setLayoutReady(true))
          },
          props.layoutMotion === false ? 0 : LAYOUT_REFLOW_DELAY,
        )
      } else {
        setLayoutReady(true)
      }
    }
    const frame = requestAnimationFrame(() => {
      updateNodeInternals(nodeIdsRef.current)
      measurementFrame = requestAnimationFrame(completeLayout)
    })
    let transitionTimer: ReturnType<typeof setTimeout> | undefined
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (layoutMounted.current && props.layoutMotion !== false && !reduceMotion) {
      setMovingLayout(true)
      transitionTimer = setTimeout(() => setMovingLayout(false), LAYOUT_TRANSITION_DURATION)
    } else {
      layoutMounted.current = true
    }
    setEdgeContextMenu(null)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      cancelAnimationFrame(measurementFrame)
      cancelAnimationFrame(readyFrame)
      if (fitTimer) clearTimeout(fitTimer)
      if (transitionTimer) clearTimeout(transitionTimer)
    }
  }, [onBeforeFitView, props.layoutMotion, props.onLayoutMeasured, rf, updateNodeInternals])

  const viewport = useVal(props.viewport$)
  const nonEmptyViewport = useRef(viewport)
  nonEmptyViewport.current = viewport || nonEmptyViewport.current
  const reactFlowFitView = props.fitView || viewport == null
  const onViewportChange = useCallback(
    (nextViewport: Viewport) => {
      const current = props.viewport$.value
      if (current == null || current.x != nextViewport.x || current.y != nextViewport.y || current.zoom != nextViewport.zoom) {
        props.viewport$.set(nextViewport)
      }
    },
    [props.viewport$],
  )
  const onInit = useCallback<OnInit<RFNode<any>, RFEdge<any>>>(
    (instance) => {
      if (mounted.current) props.onInit?.(instance)
    },
    [props.onInit],
  )

  const paneSize = useStore(GET_SIZE, isSizeEqual)
  const paneRect$ = useMemo(
    () =>
      derive(props.viewport$, (nextViewport) => getPaneRect(nextViewport || nonEmptyViewport.current, paneSize), {
        equal: isRectEqual,
      }),
    [props.viewport$, paneSize],
  )

  const propFocused = useVal(props.focused$)

  useEffect(() => {
    if (fittingView) {
      // Keep the class until measurement and fitView have completed.
      const timer = setTimeout(() => setFittingView(false), 200)
      return () => clearTimeout(timer)
    }
  }, [fittingView])

  const onNodesChange = useCallback(
    (changes: NodeChange[]): void => {
      onBeforeApplyNodesChanges(changes, nodes)
      props.onNodesChange(changes)
    },
    [onBeforeApplyNodesChanges, props.onNodesChange, nodes],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const itemId = getAddItemId(event.dataTransfer)
      if (itemId != '' && props.onDropAddItem != null) {
        event.preventDefault()
        const screenPosition = { x: event.clientX, y: event.clientY }
        editCanvas(() => props.onDropAddItem?.(itemId, rf.screenToFlowPosition(screenPosition)))
        restoreFlowFocus(event)
        return
      }
      if (!props.onAddNode) return
      let type: AddNodeType | undefined
      let payload: string | undefined

      if ((payload = getSharedBlockPath(event.dataTransfer))) {
        type = 'block'
      } else if ((payload = getScriptletType(event.dataTransfer))) {
        type = 'scriptlet'
      } else if (isWithValueType(event.dataTransfer)) {
        type = 'value'
      } else if (isWithConditionType(event.dataTransfer)) {
        type = 'condition'
      } else if (isWithCommentType(event.dataTransfer)) {
        type = 'comment'
      } else if ((payload = getTriggerType(event.dataTransfer))) {
        type = 'trigger'
      } else {
        return
      }

      event.preventDefault()

      const screenPosition = { x: event.clientX, y: event.clientY }

      editCanvas(() => {
        const zoom = rf.getZoom()
        const position = rf.screenToFlowPosition({
          x: screenPosition.x - 100 * zoom,
          y: screenPosition.y - 10 * zoom,
        })
        props.onAddNode?.(type, payload, position)
      })
      restoreFlowFocus(event)
    },
    [editCanvas, rf, props.onAddNode, props.onDropAddItem],
  )

  const queue = useMemo(() => new NodePlaceholderQueue(), [])
  useEffect(() => () => queue.dispose(), [queue])

  return (
    <NodePlaceholder.Provider value={queue}>
      <PaneRectContext.Provider value={paneRect$}>
        <ReactFlow
          onKeyDown={(event) => {
            if ((event.key === 'Enter' || event.key === ' ') && event.target instanceof Element && event.target.matches('.react-flow__node')) {
              props.onActivateSelection?.()
            }
            if (!editable || event.defaultPrevented || event.nativeEvent.isComposing) return
            if (!(event.target instanceof Element) || !event.currentTarget.contains(event.target)) return
            if (
              event.target.closest(
                'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], [role="alertdialog"], .nokey',
              )
            )
              return
            // Handle each press in the canvas scope. Toggling React Flow's global
            // delete listener on blur can miss keyup when the focused node is removed.
            if (event.key === 'Backspace' || event.key === 'Delete') {
              if (propFocused === false || props.canDeleteNodes === false || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
                return
              event.preventDefault()
              event.stopPropagation()
              const state = flowState.getState()
              void rf.deleteElements({
                nodes: state.nodes.filter((node) => node.selected),
                edges: state.edges.filter((edge) => edge.selected),
              })
              flowState.setState({ nodesSelectionActive: false })
              return
            }
            if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
            const nodeIds = selectedNodes.flatMap((node) => (node.data.store ? [node.data.store.nodeId] : []))
            const key = event.key.toLowerCase()
            const action =
              key === 'c' && nodeIds.length > 0 && props.onCopy
                ? () => props.onCopy!(nodeIds)
                : key === 'v' && props.onPaste
                  ? () => props.onPaste!()
                  : key === 'd' && nodeIds.length > 0 && props.duplicateNodes
                    ? () => props.duplicateNodes!(nodeIds)
                    : undefined
            if (!action) return
            event.preventDefault()
            event.stopPropagation()
            action()
          }}
          className={clsx(
            styles.flow,
            CANVAS_CLASSNAME,
            interactiveMode,
            fittingView && FITTING_VIEW_CLASSNAME,
            !layoutReady && styles.layoutPending,
            movingLayout && styles.movingLayout,
          )}
          style={
            {
              '--layout-transition-duration': `${props.layoutMotion === false ? 0 : LAYOUT_TRANSITION_DURATION}ms`,
            } as React.CSSProperties
          }
          colorMode={props.dark ? 'dark' : 'light'}
          tabIndex={-1}
          proOptions={PRO_OPTIONS}
          nodeTypes={props.nodeTypes}
          edgeTypes={props.edgeTypes}
          nodes={nodes}
          edges={edges}
          onBeforeDelete={props.onBeforeDelete}
          onNodesChange={onNodesChange}
          onEdgesChange={props.onEdgesChange}
          fitView={reactFlowFitView}
          fitViewOptions={props.fitViewOptions}
          viewport={viewport}
          onViewportChange={onViewportChange}
          maxZoom={3}
          minZoom={0.1}
          nodesConnectable={editable && props.onConnect != null}
          onEdgeContextMenu={(event, edge) => (event.preventDefault(), setEdgeContextMenu({ edge, event }))}
          onSelectionContextMenu={(event, selectionNodes) => (event.preventDefault(), setSelectionContextMenu({ nodes: selectionNodes, event }))}
          onPaneContextMenu={(event) => {
            event.preventDefault()
            const screenPosition = { x: event.clientX, y: event.clientY }
            setPaneContextMenu({ position: rf.screenToFlowPosition(screenPosition), screenPosition })
          }}
          onConnectEnd={onConnectEnd}
          isValidConnection={props.isValidConnection}
          onConnect={editable ? props.onConnect : undefined}
          onDragOver={editable && (props.onAddNode != null || props.onDropAddItem != null) ? handleDragOver : undefined}
          onDrop={editable && (props.onAddNode != null || props.onDropAddItem != null) ? onDrop : undefined}
          onMoveEnd={props.onMoveEnd}
          onNodeDragStop={props.onNodeDragStop}
          onSelectionChange={props.onSelectionChange}
          onSelectionStart={() => {
            selecting.current = true
            props.onSelectionStart?.()
          }}
          onSelectionEnd={endSelection}
          onNodeClick={(event) => {
            if (isNodeInteractiveTarget(event.target)) return
            props.onActivateSelection?.()
          }}
          onNodeDoubleClick={(event) => {
            if (isNodeInteractiveTarget(event.target)) return
            props.onInspectSelection?.()
          }}
          deleteKeyCode={null}
          /* React Flow can leave the Meta key active after the browser releases it. */
          zoomActivationKeyCode={null}
          zoomOnDoubleClick={false}
          /* Keep clicks valid until the default 1px drag threshold is exceeded. */
          nodeClickDistance={1}
          selectionMode={SelectionMode.Partial}
          panOnDrag={isMouse ? PAN_ON_DRAG_MOUSE : PAN_ON_DRAG_TOUCHPAD}
          panOnScroll={!isMouse}
          zoomOnScroll={isMouse}
          selectionKeyCode={toTrue(isMouse) && 'Shift'}
          selectionOnDrag={!isMouse}
          connectOnClick={false}
          onInit={onInit}
          connectionLineComponent={ConnectionLine}
          aria-readonly={!editable}
        >
          {(props.canDeleteNodes ?? true) && !selectionInProgress && (
            <SelectionFloatBar editable={!!editable} nodes={selectedNodes} onDelete={deleteSelectedNodes} duplicateNodes={props.duplicateNodes} />
          )}
          <FlowControls
            cornerTools={props.cornerTools}
            cornerLeading={props.cornerLeading}
            topLeftTools={props.topLeftTools}
            bottomRightTools={props.bottomRightTools}
            toolbar={props.toolbar}
            miniMapExpanded$={props.miniMapExpanded$}
            interactiveMode$={props.interactiveMode$}
            layoutMotion={props.layoutMotion}
            onBeforeFitView={onBeforeFitView}
            onRelayout={props.onRelayout}
            onFitView={props.onFitView}
            dottedBackground={props.dottedBackground}
          />
          <HelperLines horizontal={helperLineHorizontal} vertical={helperLineVertical} />
          {props.children}
          <ViewportPortal>
            {paneContextMenu && (props.onPaste || props.onRequestAddNode) && (
              <PaneContextMenu
                position={paneContextMenu.position}
                onClose={() => setPaneContextMenu(null)}
                onPaste={editable ? props.onPaste : undefined}
                onAddNode={
                  editable && props.onRequestAddNode
                    ? () => {
                        const request = paneContextMenu
                        cancelAnimationFrame(pickerFrame.current)
                        pickerFrame.current = requestAnimationFrame(() => editCanvas(() => props.onRequestAddNode?.(request)))
                      }
                    : undefined
                }
              />
            )}
            {edgeContextMenu && edgeContextMenuPosition && (
              <EdgeContextMenu
                position={edgeContextMenuPosition}
                edge={edgeContextMenu.edge}
                onClose={() => setEdgeContextMenu(null)}
                onDelete={() => props.onEdgesChange([{ type: 'remove', id: edgeContextMenu.edge.id }])}
              />
            )}
            {(props.canDeleteNodes ?? true) && selectionContextMenu && selectionContextMenuPosition && (
              <SelectionContextMenu
                position={selectionContextMenuPosition}
                nodes={selectionContextMenu.nodes}
                onClose={() => setSelectionContextMenu(null)}
                onDelete={async () => {
                  if (
                    await props.onBeforeDelete({
                      nodes: selectionContextMenu.nodes,
                      edges: [],
                    })
                  ) {
                    props.onNodesChange(
                      selectionContextMenu.nodes.map((node) => ({
                        type: 'remove',
                        id: node.id,
                      })),
                    )
                  }
                }}
                duplicateNodes={props.duplicateNodes}
              />
            )}
          </ViewportPortal>
        </ReactFlow>
      </PaneRectContext.Provider>
    </NodePlaceholder.Provider>
  )
}

const handleDragOver = (event: React.DragEvent) => {
  // Indicate that dropping is allowed.
  event.preventDefault()
}

function restoreFlowFocus(event: React.DragEvent): void {
  // Drag and drop can move focus to the dragged element or document body.
  // Restore focus to React Flow so shortcuts such as Delete continue to work.
  let parent = event.target as Partial<HTMLElement> | undefined | null
  while (parent && !parent.classList?.contains(styles.flow)) parent = parent.parentElement
  parent?.focus?.()
}

interface PaneContextMenuProps {
  readonly position: XYPosition
  readonly onClose: () => void
  readonly onPaste?: (position: XYPosition) => void
  readonly onAddNode?: () => void
}

function PaneContextMenu(props: PaneContextMenuProps) {
  const t = useTranslate()

  return (
    <ContextMenu
      items={[
        {
          label: t('contextMenu.addNode'),
          key: '$addNode',
          icon: <i className="i-codicon:add" />,
          disabled: !props.onAddNode,
          onClick: props.onAddNode,
        },
        {
          label: t('contextMenu.paste'),
          key: '$paste',
          icon: <i className="i-carbon:paste" />,
          disabled: !props.onPaste,
          onClick: () => props.onPaste?.(props.position),
        },
      ]}
      onClose={props.onClose}
      position={props.position}
    />
  )
}

interface EdgeContextMenuProps {
  readonly position: XYPosition
  readonly edge: RFEdge<any>
  readonly onClose: () => void
  readonly onDelete: () => void
}

interface ContextMenuItem {
  readonly disabled?: boolean
  readonly icon?: React.ReactNode
  readonly key: string
  readonly label: string
  readonly onClick?: () => void
}

interface ContextMenuProps {
  readonly items: ContextMenuItem[]
  readonly onClose: () => void
  readonly position: XYPosition
}

function ContextMenu({ items, onClose, position }: ContextMenuProps) {
  const getContextMenuContainer = useGetStaticPopupContainer()

  return (
    <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger nativeButton={false} render={<div style={{ position: 'absolute', left: position.x, top: position.y }} />} />
      <DropdownMenuContent align="start" className={styles.contextMenu} container={getContextMenuContainer()} side="bottom" sideOffset={0}>
        <DropdownMenuGroup>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.key}
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.()
                onClose()
              }}
              variant={item.key === '$delete' ? 'destructive' : 'default'}
            >
              {item.icon}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EdgeContextMenu(props: EdgeContextMenuProps) {
  const t = useTranslate()

  return (
    <ContextMenu
      items={[
        {
          label: t('nodeActions.delete'),
          key: '$delete',
          icon: <i className="i-codicon:trash" />,
          onClick: props.onDelete,
        },
      ]}
      onClose={props.onClose}
      position={props.position}
    />
  )
}

interface SelectionContextMenuProps {
  readonly position: XYPosition
  readonly nodes: RFNode<{ store: NodeStore | CommentNodeStore | null }>[]
  readonly onClose: () => void
  readonly onDelete: () => void
  readonly duplicateNodes?: (manifestNodeIds?: NodeId[], offset?: XYPosition) => void
}

function SelectionContextMenu(props: SelectionContextMenuProps) {
  const items = useSelectionItems(props)

  return <ContextMenu items={items} onClose={props.onClose} position={props.position} />
}

function SelectionFloatBar(props: Pick<SelectionContextMenuProps, 'nodes' | 'onDelete' | 'duplicateNodes'> & { readonly editable: boolean }) {
  const items = useSelectionItems(props)
  const { zoom } = useViewport()

  if (props.nodes.length < 2) return null

  return (
    <NodeToolbar data-tooltip-toolbar className={nodeHeadStyles.floatBar} isVisible nodeId={props.nodes.map((node) => node.id)} offset={12 - 8 * zoom}>
      <InspectSelectionButton className={nodeHeadStyles.floatBarButton} />
      {items
        .filter((item) => props.editable || (item.key !== '$delete' && item.key !== '$duplicate'))
        .map((item) => (
          <CanvasTooltip key={item.key} placement="top" title={item.key === '$delete' ? `${item.label} (Backspace / Delete)` : item.label}>
            <Button
              aria-label={item.label}
              className={nodeHeadStyles.floatBarButton}
              data-danger={item.key === '$delete' || undefined}
              disabled={item.disabled}
              onClick={item.onClick}
              size="icon"
              variant="ghost"
            >
              {item.icon}
            </Button>
          </CanvasTooltip>
        ))}
    </NodeToolbar>
  )
}

function useSelectionItems(props: Pick<SelectionContextMenuProps, 'nodes' | 'onDelete' | 'duplicateNodes'>): ContextMenuItem[] {
  const t = useTranslate()
  const nodes = useMemo(() => props.nodes.filter((node) => node.data.store), [props.nodes])
  const hasDuplicate = nodes.some((node) => node.data.store?.duplicateNode)
  const skipState$ = useMemo(() => {
    const ignore$ = nodes.flatMap((node) => (NodeStore.is(node.data.store) ? [node.data.store.ignore] : []))
    return combine(ignore$, (values): [boolean, boolean] => [values.length > 0, values.every(Boolean)])
  }, [nodes])
  const [hasSkip, skip] = useVal(skipState$)

  const duplicateNodes = useCallback(() => {
    if (props.duplicateNodes) {
      props.duplicateNodes(nodes.map((node) => node.data.store!.nodeId))
    } else {
      for (const node of nodes) node.data.store?.duplicateNode?.()
    }
  }, [nodes, props.duplicateNodes])

  const toggleSkip = useCallback(() => {
    const newSkip = !skip
    for (const rfNode of nodes) {
      const node = rfNode.data.store
      NodeStore.to(node)?.setIgnored(newSkip)
    }
  }, [nodes, skip])

  return coalesce<ContextMenuItem>([
    toTrue(hasDuplicate) && {
      label: t('nodeActions.duplicate'),
      key: '$duplicate',
      icon: <i className="i-codicon:copy" />,
      onClick: duplicateNodes,
    },
    toTrue(hasSkip) && {
      label: skip ? t('nodeActions.skipDisableAll') : t('nodeActions.skipEnableAll'),
      key: '$skip',
      icon: <i className={skip ? 'i-carbon:view-off' : 'i-carbon:view'} />,
      onClick: toggleSkip,
    },
    {
      label: t('nodeActions.delete'),
      key: '$delete',
      icon: <i className="i-codicon:trash" />,
      onClick: props.onDelete,
    },
  ])
}

function tooShort(from: XYPosition, to: XYPosition | null): boolean {
  if (!to) return true
  const dx = to.x - from.x
  const dy = to.y - from.y
  return Math.hypot(dx, dy) < 50
}
