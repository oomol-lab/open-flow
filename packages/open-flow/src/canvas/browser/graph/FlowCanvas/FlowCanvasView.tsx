import 'virtual:uno.css'
import '../../styles/root.scss'
import '../../../../ui/browser/styles.css'
import '../../../../ui/browser/theme.css'
import type { IsValidConnection, OnMoveEnd, OnNodeDrag, OnSelectionChangeFunc, Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { ReactElement } from 'react'
import type { RFHandleName, RFNodeId } from '../../base/rfHelpers.ts'
import type { NodeStore } from '../../stores/node/node.store.ts'
import type { FlowCanvasViewPosition, FlowCanvasViewProps, ViewCallbacks } from './model.ts'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { toManifestHandleName, toManifestNodeId } from '../../base/rfHelpers.ts'
import { CanvasStore } from '../../stores/canvas/canvas.store.ts'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { FlowCanvas } from './FlowCanvas.tsx'
import { toViewEdge } from './model.ts'

function callbacksFromProps(props: FlowCanvasViewProps): ViewCallbacks {
  return {
    onIgnoreNodes: props.onIgnoreNodes,
    onAddNode: props.onAddNode,
    onMoveNodes: props.onMoveNodes,
    onChangeNodeContentHidden: props.onChangeNodeContentHidden,
    onChangeComment: props.onChangeComment,
    onConnect: props.onConnect,
    onDeleteNodes: props.onDeleteNodes,
    onDisconnect: props.onDisconnect,
    onDuplicate: props.onDuplicate,
    onCopy: props.onCopy,
    onPaste: props.onPaste,
    provideAddItems: props.provideAddItems,
  }
}

export function FlowCanvasView(props: FlowCanvasViewProps): ReactElement {
  const store = useMemo(
    () => new CanvasStore(props.model, props.editable, props.language ?? 'en', props.addItems, callbacksFromProps(props), props.autoLayout),
    [props.identity],
  )
  const previousStore = useRef(store)
  const propsRef = useRef(props)
  const selectedEdge = useRef<string>()
  propsRef.current = props

  const onMoveEnd = useCallback<OnMoveEnd>((_, viewport) => propsRef.current.onMoveViewport(viewport), [store])
  const onNodeDragStop = useCallback<OnNodeDrag<RFNode<any>>>(
    (_, node, nodes) => {
      const moved = nodes.length > 0 ? nodes : [node]
      propsRef.current.onMoveNodes(
        Object.fromEntries(
          moved.flatMap((item) => {
            const nodeStore = item.data?.store as NodeStore | CommentNodeStore | undefined
            return nodeStore == null ? [] : [[nodeStore.nodeId, item.position]]
          }),
        ),
      )
    },
    [store],
  )
  const onSelectionChange = useCallback<OnSelectionChangeFunc<RFNode<any>, RFEdge<any>>>(
    ({ edges, nodes }) => {
      // React Flow effects can report a snapshot from before the latest controlled selection.
      const selectedNodes = store.$.rfNodes.value.filter((node) => node.selected)
      if (nodes.length != selectedNodes.length || nodes.some((node) => !selectedNodes.some((selected) => selected.data?.store === node.data?.store))) return
      const nodeIds = nodes.flatMap((node) => {
        const nodeStore = node.data?.store as NodeStore | CommentNodeStore | undefined
        return nodeStore == null ? [] : [nodeStore.nodeId]
      })
      const connection = edges[0]?.data?.store?.connection
      const edge = connection == null ? undefined : toViewEdge(connection.source, connection.sourceHandle, connection.target, connection.targetHandle)
      const selected = new Set(propsRef.current.selectedNodeIds)
      const selectionChanged = nodeIds.length != selected.size || nodeIds.some((nodeId) => !selected.has(nodeId))
      const edgeChanged = selectedEdge.current != edge?.id
      selectedEdge.current = edge?.id
      if (selectionChanged || edgeChanged) propsRef.current.onSelectionChange(nodeIds, edge)
    },
    [store],
  )
  const isValidConnection = useCallback<IsValidConnection<RFEdge<any>>>((edge) => {
    if (edge.sourceHandle == null || edge.targetHandle == null) return true
    return (
      propsRef.current.isValidConnection?.({
        source: toManifestNodeId(edge.source as RFNodeId),
        sourceHandle: toManifestHandleName(edge.sourceHandle as RFHandleName),
        target: toManifestNodeId(edge.target as RFNodeId),
        targetHandle: toManifestHandleName(edge.targetHandle as RFHandleName),
      }) ?? true
    )
  }, [])
  const onDropAddItem = useCallback((itemId: string, position: FlowCanvasViewPosition) => store.addNode(itemId, position), [store])

  useEffect(() => {
    const previous = previousStore.current
    previousStore.current = store
    if (previous !== store) previous.dispose()
    return store.cancelPendingDeletions
  }, [store])
  useLayoutEffect(() => store.setCallbacks(callbacksFromProps(props)))
  useLayoutEffect(() => {
    store.reconcile(props.model, props.editable, props.language ?? 'en', props.addItems, props.selectedNodeIds, props.ignoredNodeIds)
  }, [store, props.addItems, props.editable, props.language, props.model, props.selectedNodeIds, props.ignoredNodeIds])
  useEffect(() => {
    if (props.focusNodeRequest != null) {
      const reducedMotion =
        typeof window != 'undefined' && typeof window.matchMedia == 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      store.focusNode(props.focusNodeRequest.nodeId, reducedMotion ? 0 : 150)
    }
  }, [store, props.focusNodeRequest])

  return (
    <FlowCanvas
      addItemsCatalog={props.addItemsCatalog}
      cornerTools={props.cornerTools}
      toolbar={props.toolbar}
      addItemRequest={props.addItemRequest}
      addNodeRequest={props.addNodeRequest}
      className={props.className}
      dark={props.dark ?? false}
      fitView={false}
      flowCanvasStore={store}
      isValidConnection={isValidConnection}
      key={props.identity}
      layoutMotion={props.layoutMotion}
      onMoveEnd={onMoveEnd}
      onNodeDragStop={onNodeDragStop}
      onDropAddItem={onDropAddItem}
      onSelectionChange={onSelectionChange}
    />
  )
}
