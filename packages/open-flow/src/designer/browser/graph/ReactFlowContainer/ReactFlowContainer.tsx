import darkTheme from '../../styles/dark.module.scss'
import lightTheme from '../../styles/light.module.scss'
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
import type { HandleName, NodeId } from '../../../../schema/index.ts'
import type { FlowDisplayMode } from '../../../common/flowDisplay.ts'
import type { AddNodeType } from '../../base/dragNDrop.ts'
import type { PartialConnection, RFConnection, RFHandleName, RFNodeId } from '../../base/rfHelpers.ts'
import type { HandleImpl } from '../../components/handle.tsx'
import type { IAddHandleOptions, IAddNodeMenuItem, IFromSource, InteractiveMode, RFGraph } from '../../stores/designer/designer.store.ts'
import type { NodeType } from '../../stores/node/constants.ts'
import type { NodeStore } from '../../stores/node/node.store.ts'
import type { TaskNodeStore } from '../../stores/node/taskNode.store.ts'
import type { GetPopupContainer } from './useGetPopupContainer.ts'

import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  Handle,
  NodeToolbar,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useNodes,
  useReactFlow,
  useStore,
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
import { buttonGroupVariants } from '../../../../ui/browser/button-group.tsx'
import { Button, buttonVariants } from '../../../../ui/browser/button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../../../../ui/browser/dropdown-menu.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../../../../ui/browser/popover.tsx'
import { TooltipProvider } from '../../../../ui/browser/tooltip.tsx'
import { cn } from '../../../../ui/browser/utils.ts'
import { DESIGNER_CLASSNAME, HANDLE_ROW_CLASSNAME } from '../../base/designer.ts'
import { getScriptletType, getSharedBlockPath, getTriggerType, isWithCommentType, isWithConditionType, isWithValueType } from '../../base/dragNDrop.ts'
import { makeConnection, toManifestHandleName, toManifestNodeId } from '../../base/rfHelpers.ts'
import { coalesce, toTrue } from '../../base/trivial.ts'
import { HandleContextProvider } from '../../components/handle.tsx'
import { DesignerTooltip } from '../../components/tooltip.tsx'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { FITTING_VIEW_CLASSNAME, isPseudoNodeType, NODE_TYPE } from '../../stores/node/constants.ts'
import { ThemeProvider } from '../../theme/index.ts'
import { BlockQuickPickPanel } from '../BlockQuickPickPanel.tsx'
import { EdgeDefs } from '../Edges/EdgeDefs.tsx'
import { NodePlaceholder, NodePlaceholderQueue } from '../Nodes/useNodePlaceholder.ts'
import { getPaneRect, PaneRectContext } from '../Nodes/usePaneRect.ts'
import { getAddItemId } from './addItemDrag.ts'
import { BottomRight } from './BottomRight.tsx'
import { ConnectionLine } from './ConnectingLine.tsx'
import { DisplayModeToggle } from './DisplayModeToggle.tsx'
import { HelperLines, useHelperLines } from './HelperLines/index.ts'
import { NewHandleIndicator } from './NewHandleIndicator.tsx'
import { GetPopupContainerContext, useGetStaticPopupContainer } from './useGetPopupContainer.ts'
import { getInsertBefore, getNewHandleIndicator } from './useNewHandleIndicator.ts'

// Mouse buttons.
const PAN_ON_DRAG_MOUSE = [0]
const PAN_ON_DRAG_TOUCHPAD = [1]

const GRID_GAP: [number, number] = [20, 20]

const PRO_OPTIONS = { hideAttribution: true }

const DISPLAY_MODE_TRANSITION_DURATION = 200
const DISPLAY_MODE_REFLOW_DELAY = DISPLAY_MODE_TRANSITION_DURATION + 100

const GET_SIZE = (s: ReactFlowState): Dimensions => ({
  width: s.width,
  height: s.height,
})

const isSizeEqual = (a: Dimensions, b: Dimensions) => a.width === b.width && a.height === b.height

const isRectEqual = (a: Rect, b: Rect) => isSizeEqual(a, b) && a.x === b.x && a.y === b.y

export interface ReactFlowContainerProps {
  className?: string
  dark: boolean
  i18n: I18n
  miniMapExpanded$?: Val<boolean | undefined>
  displayMode$?: Val<FlowDisplayMode>
  interactiveMode$: Val<InteractiveMode>
  editable: boolean
  nodeTypes?: NodeTypes
  edgeTypes?: EdgeTypes
  graph$: ReadonlyVal<RFGraph>
  viewport$: Val<Viewport | undefined>
  focused$?: ReadonlyVal<boolean>
  canDeleteNodes?: boolean
  showSettings$?: Val<boolean>
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
  setupValueNode?: (nodeId: NodeId, connection: Pick<RFConnection, 'target' | 'targetHandle'>) => void
  setupScriptletNode?: (nodeId: NodeId, connection: PartialConnection, handle: HandleName) => void
  onAddNode?: (
    type: AddNodeType,
    payload: string,
    position: { x: number; y: number },
    connection?: (nodeId: NodeId) => RFConnection,
  ) => Promise<NodeId | undefined>
  onDropAddItem?: (itemId: string, position: XYPosition) => Promise<string | undefined> | string | undefined
  onRelayout?: () => void
  onDisplayModeMeasured?: () => boolean | 'relayout'
  onFitView?: () => void
  onInstance?: (rf: ReactFlowInstance) => () => void
  onInit?: OnInit<RFNode<any>, RFEdge<any>>
  onPaste?: (position: XYPosition) => void
  provideAddNodeMenuItems?: (fromSource?: IFromSource) => IAddNodeMenuItem[] | undefined
  provideAsyncAddNodeMenuItems?: (fromSource: IFromSource | undefined, searchTerm: string, signal: AbortSignal) => Promise<IAddNodeMenuItem[] | undefined>
  onAddHandle?: (options: IAddHandleOptions) => void
  fitView?: boolean
  fitViewOptions?: FitViewOptions
  dottedBackground?: boolean
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
    <div
      className={clsx(props.className, 'oo-designer-root', styles.container, props.dark ? darkTheme.theme : lightTheme.theme)}
      data-theme={props.dark ? 'dark' : 'light'}
      ref={wrapperRef}
    >
      <GetPopupContainerContext.Provider value={context}>
        <I18nProvider i18n={props.i18n}>
          <TooltipProvider delay={300}>
            <ThemeProvider dark={props.dark} getPopupContainer={context.default}>
              <ReactFlowProvider>
                <HandleContextProvider Handle={Handle as HandleImpl}>
                  <EdgeDefs />
                  <ReactFlowContainerInner {...props} />
                </HandleContextProvider>
              </ReactFlowProvider>
            </ThemeProvider>
          </TooltipProvider>
        </I18nProvider>
      </GetPopupContainerContext.Provider>
    </div>
  )
}

type FlowControlsProps = Pick<
  ReactFlowContainerProps,
  'miniMapExpanded$' | 'displayMode$' | 'interactiveMode$' | 'showSettings$' | 'onRelayout' | 'onFitView' | 'dottedBackground'
> & { onBeforeFitView?: () => void }

const selector = (s: ReactFlowState) => ({
  minZoomReached: s.transform[2] <= s.minZoom,
  maxZoomReached: s.transform[2] >= s.maxZoom,
})

const FlowControls = /*#__PURE__*/ memo((props: FlowControlsProps) => {
  const t = useTranslate()
  const rf = useReactFlow()
  const { minZoomReached, maxZoomReached } = useStore(selector, shallowPlainObjectEqual)
  const nodes = useNodes()

  // The SVG background pattern needs a document-unique identifier without CSS-special characters.
  const bgId = useId().replaceAll(':', '')

  const selectedNodes = nodes.filter((node) => node.selected)
  const fitViewOptions: FitViewOptions = {
    padding: 0.15,
    duration: 150,
    maxZoom: 1,
  }

  return (
    <>
      {props.dottedBackground && <Background id={bgId} color="var(--canvas-grid)" gap={GRID_GAP} variant={BackgroundVariant.Dots} />}
      <Controls
        className={buttonGroupVariants({ orientation: 'vertical' })}
        orientation="vertical"
        showInteractive={false}
        showFitView={false}
        showZoom={false}
      >
        <ControlButton
          className={cn(buttonVariants({ size: 'icon', variant: 'outline' }), styles.btnCtrl, 'react-flow__controls-button-zoom-in')}
          data-slot="button"
          onClick={() => rf.zoomIn()}
          title={t('zoomIn')}
          aria-label={t('zoomIn')}
          disabled={maxZoomReached}
        >
          <i className="i-codicon:zoom-in" />
        </ControlButton>
        <ControlButton
          className={cn(buttonVariants({ size: 'icon', variant: 'outline' }), styles.btnCtrl, 'react-flow__controls-button-zoom-out')}
          data-slot="button"
          onClick={() => rf.zoomOut()}
          title={t('zoomOut')}
          aria-label={t('zoomOut')}
          disabled={minZoomReached}
        >
          <i className="i-codicon:zoom-out" />
        </ControlButton>
        <ControlButton
          className={cn(buttonVariants({ size: 'icon', variant: 'outline' }), styles.btnCtrl, 'react-flow__controls-button-fit-view')}
          data-slot="button"
          onClick={() => {
            props.onBeforeFitView?.()
            // Wait for the node description height before fitting the view to avoid overlap.
            setTimeout(() => {
              rf.fitView({
                ...fitViewOptions,
                nodes: selectedNodes.length === 0 ? undefined : selectedNodes,
              })
              props.onFitView?.()
            }, 100)
          }}
          title={t('fitView')}
          aria-label={t('fitView')}
        >
          <i className="i-custom:screen" />
        </ControlButton>
        {props.onRelayout && (
          <ControlButton
            className={cn(buttonVariants({ size: 'icon', variant: 'outline' }), styles.btnCtrl, 'react-flow__controls-button-optimize')}
            data-slot="button"
            onClick={() => {
              props.onRelayout?.()
              props.onBeforeFitView?.()
              // Wait for the node description height before fitting the view to avoid overlap.
              setTimeout(() => {
                rf.fitView(fitViewOptions)
              }, 100)
            }}
            title={t('optimize')}
            aria-label={t('optimize')}
          >
            <i className="i-custom:layout" />
          </ControlButton>
        )}
      </Controls>
      <BottomRight miniMapExpanded$={props.miniMapExpanded$} interactiveMode$={props.interactiveMode$} showSettings$={props.showSettings$} />
      {props.displayMode$ && <DisplayModeToggle displayMode$={props.displayMode$} />}
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

interface BlockQuickPickPanelData {
  readonly position: XYPosition
  readonly fromSource?: IFromSource
  readonly connection?: PartialConnection
}

// Isolate the inner component because React Flow updates frequently.
const ReactFlowContainerInner = (props: ReactFlowContainerProps) => {
  const rf = useReactFlow()
  const updateNodeInternals = useUpdateNodeInternals()
  const mounted = useRef(true)
  const detailModeFrame = useRef(0)

  const enterDetailMode = useCallback(
    (action?: () => void) => {
      if (!props.editable) return
      if (props.displayMode$?.value != 'overview') {
        action?.()
        return
      }
      props.displayMode$.set('detail')
      cancelAnimationFrame(detailModeFrame.current)
      detailModeFrame.current = requestAnimationFrame(() => action?.())
    },
    [props.displayMode$, props.editable],
  )

  useLayoutEffect(() => props.onInstance?.(rf), [rf, props.onInstance])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelAnimationFrame(detailModeFrame.current)
    }
  }, [])
  // https://github.com/xyflow/xyflow/issues/4263
  const [rfFocused, setRfFocused] = useState(true)

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

  const [paneContextMenu, setPaneContextMenu] = useState<XYPosition | null>(null)
  const paneContextMenuScreen = useRef<XYPosition | undefined>(undefined)

  const [blockQuickPickPanel, setBlockQuickPickPanel] = useState<BlockQuickPickPanelData | null>(null)
  const quickPickFrame = useRef(0)

  useEffect(
    () => () => {
      cancelAnimationFrame(quickPickFrame.current)
    },
    [],
  )

  useEffect(() => {
    const request = props.addNodeRequest
    if (request == null) return
    const open = () => {
      const position = request.screenPosition == null ? request.position : rf.screenToFlowPosition(request.screenPosition)
      setBlockQuickPickPanel({ position })
      request.onComplete?.()
    }
    enterDetailMode(open)
  }, [enterDetailMode, props.addNodeRequest, rf])

  useEffect(() => {
    const request = props.addItemRequest
    if (request == null) return
    enterDetailMode(() => {
      const position = request.screenPosition == null ? request.position : rf.screenToFlowPosition(request.screenPosition)
      Promise.resolve(props.onDropAddItem?.(request.itemId, position)).then(request.onComplete, (error) => {
        console.error('Failed to add node.', error)
        request.onComplete?.(undefined)
      })
    })
  }, [enterDetailMode, props.addItemRequest, props.onDropAddItem, rf])

  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (props.onAddNode && props.provideAddNodeMenuItems && !state.isValid && state.from && state.fromNode && state.fromHandle?.id && 'clientX' in event) {
        const position = rf.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        })
        if (tooShort(state.from, position)) {
          return
        }
        // Create a new handle when the drop target supports one.
        if (props.onAddHandle) {
          const element = document.elementFromPoint(event.clientX, event.clientY)
          const $section = element?.closest('[data-section]')
          const $handleRow = element?.closest(`.${HANDLE_ROW_CLASSNAME}`)
          const options = getNewHandleIndicator(
            state.fromNode.id,
            state.fromPosition,
            state.fromHandle.id,
            $section,
            $handleRow,
            getInsertBefore($section, event.clientY),
          )
          if (options) {
            props.onAddHandle(options)
            return
          }
        }
        // Otherwise open the add-node menu.
        const data: BlockQuickPickPanelData = {
          position,
          fromSource: {
            nodeId: toManifestNodeId(state.fromNode.id as RFNodeId),
            handle: toManifestHandleName(state.fromHandle.id as RFHandleName),
            side: state.fromPosition === 'left' ? 'left' : 'right',
          },
          connection:
            state.fromPosition === 'left'
              ? {
                  target: state.fromNode.id as RFNodeId,
                  targetHandle: state.fromHandle.id as RFHandleName,
                }
              : {
                  source: state.fromNode.id as RFNodeId,
                  sourceHandle: state.fromHandle.id as RFHandleName,
                },
        }
        cancelAnimationFrame(quickPickFrame.current)
        quickPickFrame.current = requestAnimationFrame(() => setBlockQuickPickPanel(data))
      }
    },
    [rf, props.onAddHandle, props.onAddNode, props.provideAddNodeMenuItems],
  )

  const editable = toTrue(props.editable)

  const interactiveMode = useVal(props.interactiveMode$)
  const isMouse = interactiveMode === 'mouse'
  const overview = useVal(props.displayMode$) == 'overview'

  const { nodes, edges: projectedEdges } = useVal(props.graph$)
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes])
  const deleteSelectedNodes = useCallback(async () => {
    if (await props.onBeforeDelete({ nodes: selectedNodes, edges: [] })) {
      props.onNodesChange(selectedNodes.map((node) => ({ type: 'remove', id: node.id })))
    }
  }, [props.onBeforeDelete, props.onNodesChange, selectedNodes])
  const edgeTopology = useMemo(
    () => JSON.stringify([overview, projectedEdges.map((edge) => [edge.id, edge.source, edge.sourceHandle, edge.target, edge.targetHandle])]),
    [overview, projectedEdges],
  )
  const [readyEdgeTopology, setReadyEdgeTopology] = useState(() => (projectedEdges.length == 0 ? edgeTopology : ''))
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReadyEdgeTopology(edgeTopology))
    return () => cancelAnimationFrame(frame)
  }, [edgeTopology])
  const edges = readyEdgeTopology == edgeTopology ? projectedEdges : []
  const nodeIdsRef = useRef<string[]>([])
  nodeIdsRef.current = nodes.map((node) => node.id)
  const displayModeMounted = useRef(false)
  const [switchingDisplayMode, setSwitchingDisplayMode] = useState(false)
  const [fittingView, setFittingView] = useState(false)
  const onBeforeFitView = useCallback(() => setFittingView(true), [])

  useEffect(() => {
    let measurementFrame = 0
    let fitTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0
    const completeLayout = () => {
      const result = props.onDisplayModeMeasured?.()
      if (result === false && attempts++ < 5) {
        measurementFrame = requestAnimationFrame(completeLayout)
      } else if (result === 'relayout') {
        onBeforeFitView()
        fitTimer = setTimeout(() => {
          rf.fitView({ padding: 0.15, duration: 150, maxZoom: 1 })
        }, DISPLAY_MODE_REFLOW_DELAY)
      }
    }
    const frame = requestAnimationFrame(() => {
      updateNodeInternals(nodeIdsRef.current)
      measurementFrame = requestAnimationFrame(completeLayout)
    })
    let transitionTimer: ReturnType<typeof setTimeout> | undefined
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (displayModeMounted.current && !reduceMotion) {
      setSwitchingDisplayMode(true)
      transitionTimer = setTimeout(() => setSwitchingDisplayMode(false), DISPLAY_MODE_TRANSITION_DURATION)
    } else {
      displayModeMounted.current = true
    }
    setEdgeContextMenu(null)
    setBlockQuickPickPanel(null)
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(measurementFrame)
      if (fitTimer) clearTimeout(fitTimer)
      if (transitionTimer) clearTimeout(transitionTimer)
    }
  }, [onBeforeFitView, overview, props.onDisplayModeMeasured, rf, updateNodeInternals])

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

  const focused = propFocused === undefined ? rfFocused : propFocused

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

  const isValidConnection: IsValidConnection<RFEdge<any>> = useCallback(
    (edge) => {
      const source = nodes.find((node) => node.id === edge.source)
      if (edge.targetHandle) {
        const target = nodes.find((node) => node.id === edge.target)
        const targetStore = target?.data?.store as NodeStore | undefined
        const inputFrom = targetStore?.display$.inputs_from?.value?.find(
          (candidate) => candidate.handle === toManifestHandleName(edge.targetHandle as RFHandleName),
        )
        const existingSources = inputFrom?.from_node ?? []
        const existingTrigger = existingSources.some((candidate) =>
          nodes.some((node) => toManifestNodeId(node.id as RFNodeId) === candidate.node_id && node.type === NODE_TYPE.TriggerNode),
        )
        if ((source?.type === NODE_TYPE.TriggerNode && existingSources.length > 0) || existingTrigger) return false
      }
      if (source?.type === NODE_TYPE.ValueNode && edge.targetHandle) {
        const target = nodes.find((node) => node.id === edge.target)
        if (target?.type === NODE_TYPE.TaskNode) {
          const nodeStore = target.data?.store as TaskNodeStore | undefined
          if (nodeStore) {
            return !nodeStore.handleHasValueNodeConnected(toManifestHandleName(edge.targetHandle as RFHandleName))
          }
        }
      }
      return props.isValidConnection?.(edge) ?? true
    },
    [nodes, props.isValidConnection],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      const itemId = getAddItemId(event.dataTransfer)
      if (itemId != '' && props.onDropAddItem != null) {
        event.preventDefault()
        const screenPosition = { x: event.clientX, y: event.clientY }
        enterDetailMode(() => props.onDropAddItem?.(itemId, rf.screenToFlowPosition(screenPosition)))
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

      enterDetailMode(() => {
        const zoom = rf.getZoom()
        const position = rf.screenToFlowPosition({
          x: screenPosition.x - 100 * zoom,
          y: screenPosition.y - 10 * zoom,
        })
        props.onAddNode?.(type, payload, position)
      })
      restoreFlowFocus(event)
    },
    [enterDetailMode, rf, props.onAddNode, props.onDropAddItem],
  )

  const queue = useMemo(() => new NodePlaceholderQueue(), [])
  useEffect(() => () => queue.dispose(), [queue])

  return (
    <NodePlaceholder.Provider value={queue}>
      <PaneRectContext.Provider value={paneRect$}>
        <ReactFlow
          className={clsx(
            styles.flow,
            DESIGNER_CLASSNAME,
            interactiveMode,
            fittingView && FITTING_VIEW_CLASSNAME,
            switchingDisplayMode && styles.switchingDisplayMode,
          )}
          style={
            {
              '--display-mode-transition-duration': `${DISPLAY_MODE_TRANSITION_DURATION}ms`,
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
          onEdgesChange={overview ? undefined : props.onEdgesChange}
          fitView={reactFlowFitView}
          fitViewOptions={props.fitViewOptions}
          viewport={viewport}
          onViewportChange={onViewportChange}
          maxZoom={3}
          minZoom={0.1}
          nodesConnectable={!overview && editable && props.onConnect != null}
          onEdgeContextMenu={overview ? undefined : (event, edge) => (event.preventDefault(), setEdgeContextMenu({ edge, event }))}
          onSelectionContextMenu={(event, selectionNodes) => (event.preventDefault(), setSelectionContextMenu({ nodes: selectionNodes, event }))}
          onPaneContextMenu={(event) => {
            event.preventDefault()
            paneContextMenuScreen.current = {
              x: event.clientX,
              y: event.clientY,
            }
            setPaneContextMenu(rf.screenToFlowPosition(paneContextMenuScreen.current))
          }}
          onConnectEnd={overview ? undefined : onConnectEnd}
          isValidConnection={isValidConnection}
          onConnect={!overview && editable ? props.onConnect : undefined}
          onDragOver={editable && (props.onAddNode != null || props.onDropAddItem != null) ? handleDragOver : undefined}
          onDrop={editable && (props.onAddNode != null || props.onDropAddItem != null) ? onDrop : undefined}
          onMoveEnd={props.onMoveEnd}
          onNodeDragStop={props.onNodeDragStop}
          onSelectionChange={props.onSelectionChange}
          onFocus={() => setRfFocused(true)}
          onBlur={() => setRfFocused(false)}
          deleteKeyCode={editable && focused && (props.canDeleteNodes ?? true) ? ['Backspace', 'Delete'] : null}
          /* React Flow can leave the Meta key active after the browser releases it. */
          zoomActivationKeyCode={null}
          zoomOnDoubleClick={false}
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
          {(props.canDeleteNodes ?? true) && <SelectionFloatBar nodes={selectedNodes} onDelete={deleteSelectedNodes} duplicateNodes={props.duplicateNodes} />}
          <FlowControls
            showSettings$={props.showSettings$}
            miniMapExpanded$={props.miniMapExpanded$}
            displayMode$={props.displayMode$}
            interactiveMode$={props.interactiveMode$}
            onBeforeFitView={onBeforeFitView}
            onRelayout={props.onRelayout}
            onFitView={props.onFitView}
            dottedBackground={props.dottedBackground}
          />
          <HelperLines horizontal={helperLineHorizontal} vertical={helperLineVertical} />
          <NewHandleIndicator zoom={viewport?.zoom} editable={!overview && props.editable} />
          {props.children}
          <ViewportPortal>
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
            {paneContextMenu && (props.onPaste || props.provideAddNodeMenuItems) && (
              <PaneContextMenu
                position={paneContextMenu}
                onClose={() => setPaneContextMenu(null)}
                onPaste={props.onPaste}
                onAddNode={
                  props.provideAddNodeMenuItems &&
                  (() => {
                    const screenPosition = paneContextMenuScreen.current
                    enterDetailMode(() =>
                      setBlockQuickPickPanel({
                        position: screenPosition == null ? paneContextMenu : rf.screenToFlowPosition(screenPosition),
                      }),
                    )
                  })
                }
              />
            )}
            {blockQuickPickPanel && props.provideAddNodeMenuItems && props.onAddNode && (
              <BlockQuickPickPanelPopover
                position={blockQuickPickPanel.position}
                fromSource={blockQuickPickPanel.fromSource}
                connection={blockQuickPickPanel.connection}
                onClose={() => setBlockQuickPickPanel(null)}
                provideItems={props.provideAddNodeMenuItems}
                provideAsyncItems={props.provideAsyncAddNodeMenuItems}
                onAddNode={props.onAddNode}
                onConnect={props.onConnect}
                waitNode={props.waitNode}
                setupValueNode={props.setupValueNode}
                setupScriptletNode={props.setupScriptletNode}
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

const DEFAULT_DUPLICATE_NODE_OFFSET: XYPosition = { x: 50, y: 50 }

function SelectionContextMenu(props: SelectionContextMenuProps) {
  const items = useSelectionItems(props)

  return <ContextMenu items={items} onClose={props.onClose} position={props.position} />
}

function SelectionFloatBar(props: Pick<SelectionContextMenuProps, 'nodes' | 'onDelete' | 'duplicateNodes'>) {
  const items = useSelectionItems(props)
  const { zoom } = useViewport()

  if (props.nodes.length < 2) return null

  return (
    <NodeToolbar className={nodeHeadStyles.floatBar} isVisible nodeId={props.nodes.map((node) => node.id)} offset={4 - 8 * zoom}>
      {items
        .filter((item) => item.key != '$delete')
        .map((item) => (
          <DesignerTooltip key={item.key} placement="top" title={item.label}>
            <Button
              aria-label={item.label}
              className={nodeHeadStyles.floatBarButton}
              disabled={item.disabled}
              onClick={item.onClick}
              size="icon"
              variant="ghost"
            >
              {item.icon}
            </Button>
          </DesignerTooltip>
        ))}
    </NodeToolbar>
  )
}

function useSelectionItems(props: Pick<SelectionContextMenuProps, 'nodes' | 'onDelete' | 'duplicateNodes'>): ContextMenuItem[] {
  const t = useTranslate()
  const nodes = useMemo(() => props.nodes.filter((node) => node.data.store && !isPseudoNodeType(node.type as NodeType)), [props.nodes])
  const hasDuplicate = nodes.every((node) => node.data.store?.duplicateNode)
  const skipState$ = useMemo(() => {
    const ignore$ = nodes.flatMap((node) => (node.data.store?.display$ ? [node.data.store.display$.ignore] : []))
    return combine(ignore$, (values): [boolean, boolean] => [values.length > 0, values.every(Boolean)])
  }, [nodes])
  const [hasSkip, skip] = useVal(skipState$)

  const duplicateNodes = useCallback(() => {
    const manifestNodeIds: NodeId[] = []
    const commentNodes: CommentNodeStore[] = []
    for (const rfNode of nodes) {
      const node = rfNode.data.store
      if (CommentNodeStore.is(node)) {
        // Delay the comment node duplication, as props.duplicateNodes will fix the selection issue first.
        commentNodes.push(node)
      } else if (node) {
        if (props.duplicateNodes) {
          manifestNodeIds.push(node.nodeId)
        } else {
          node.duplicateNode?.()
        }
      }
    }
    if (manifestNodeIds.length > 0 && props.duplicateNodes) {
      props.duplicateNodes(manifestNodeIds, DEFAULT_DUPLICATE_NODE_OFFSET)
    }
    for (const commentNode of commentNodes) {
      commentNode.duplicateNode?.()
    }
  }, [nodes, props.duplicateNodes])

  const toggleSkip = useCallback(() => {
    const newSkip = !skip
    for (const rfNode of nodes) {
      const node = rfNode.data.store
      node?.display$?.ignore.set(newSkip)
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

interface BlockQuickPickPanelPopoverProps {
  readonly position: XYPosition
  readonly fromSource?: IFromSource
  readonly connection?: PartialConnection
  readonly onClose: () => void
  readonly provideItems: ReactFlowContainerProps['provideAddNodeMenuItems']
  readonly provideAsyncItems: ReactFlowContainerProps['provideAsyncAddNodeMenuItems']
  readonly onAddNode: NonNullable<ReactFlowContainerProps['onAddNode']>
  readonly onConnect: ReactFlowContainerProps['onConnect']
  readonly waitNode?: ReactFlowContainerProps['waitNode']
  readonly setupValueNode: ReactFlowContainerProps['setupValueNode']
  readonly setupScriptletNode: ReactFlowContainerProps['setupScriptletNode']
}

function BlockQuickPickPanelPopover(props: BlockQuickPickPanelPopoverProps) {
  const getContextMenuContainer = useGetStaticPopupContainer()
  const addingNode = useRef(false)
  const items = useMemo(() => props.provideItems?.(props.fromSource) || [], [props.provideItems, props.fromSource])
  const provideAsyncItems = useMemo(() => {
    if (props.provideAsyncItems == null) return
    const provider = props.provideAsyncItems
    const fromSource = props.fromSource
    return (searchTerm: string, signal: AbortSignal) => provider(fromSource, searchTerm, signal)
  }, [props.fromSource, props.provideAsyncItems])

  // Connecting the new node to an existing node remains unsupported.
  const onClick = async (item: IAddNodeMenuItem, data?: string, handle?: HandleName) => {
    if (item.type === 'divider' || addingNode.current) return
    addingNode.current = true
    props.onClose()
    try {
      const connect =
        props.connection != null && handle != null && item.type !== 'scriptlet'
          ? (nodeId: NodeId) => makeConnection(props.connection!, nodeId, handle)
          : undefined
      const nodeId = await props.onAddNode(
        item.type,
        data ?? item.data ?? '',
        props.fromSource?.side === 'left' ? { x: props.position.x - 250, y: props.position.y } : props.position,
        connect,
      )
      if (connect == null && nodeId != null && props.connection) {
        if (handle != null) {
          if (item.type === 'scriptlet' && props.setupScriptletNode) {
            props.setupScriptletNode(nodeId, props.connection, handle)
          } else {
            await props.waitNode?.(nodeId)
            props.onConnect?.(makeConnection(props.connection, nodeId, handle))
          }
        } else if (item.type === 'value' && props.setupValueNode && 'target' in props.connection) {
          props.setupValueNode(nodeId, props.connection)
        }
      }
    } catch (error) {
      console.error('Failed to add node.', error)
    } finally {
      addingNode.current = false
    }
  }

  return (
    <Popover open onOpenChange={(open) => !open && props.onClose()}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <div
            style={{
              position: 'absolute',
              left: props.position.x,
              top: props.position.y,
            }}
          />
        }
      />
      <PopoverContent
        align="start"
        className={clsx(styles.contextMenu, styles.quickPickPopover)}
        container={getContextMenuContainer()}
        side="bottom"
        sideOffset={0}
      >
        <BlockQuickPickPanel items={items} provideAsyncItems={provideAsyncItems} onClick={onClick} hideDescription />
      </PopoverContent>
    </Popover>
  )
}

function tooShort(from: XYPosition, to: XYPosition | null): boolean {
  if (!to) return true
  const dx = to.x - from.x
  const dy = to.y - from.y
  return Math.hypot(dx, dy) < 50
}
