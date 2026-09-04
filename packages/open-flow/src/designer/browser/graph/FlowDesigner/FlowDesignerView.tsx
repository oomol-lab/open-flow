import 'virtual:uno.css'
import '../../styles/root.scss'
import '../../../../ui/browser/styles.css'
import type { IsValidConnection, OnMoveEnd, OnNodeDrag, OnSelectionChangeFunc, Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { ReactElement } from 'react'
import type { RFHandleName, RFNodeId } from '../../base/rfHelpers.ts'
import type { NodeStore } from '../../stores/node/node.store.ts'
import type { FlowDesignerViewPosition, FlowDesignerViewProps, ViewCallbacks } from './model.ts'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { toManifestHandleName, toManifestNodeId } from '../../base/rfHelpers.ts'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { FlowDesignerViewAdapter, toViewEdge } from './adapter.ts'
import { FlowDesigner } from './FlowDesigner.tsx'

function callbacksFromProps(props: FlowDesignerViewProps): ViewCallbacks {
  return {
    onAddNode: props.onAddNode,
    onChangeComment: props.onChangeComment,
    onChangeCondition: props.onChangeCondition,
    onChangeNodeDescription: props.onChangeNodeDescription,
    onChangeNodeIcon: props.onChangeNodeIcon,
    onChangeNodeTitle: props.onChangeNodeTitle,
    onChangeInput: props.onChangeInput,
    onChangeInputVariable: props.onChangeInputVariable,
    onChangeTaskAdditionalInputs: props.onChangeTaskAdditionalInputs,
    onChangeTaskPorts: props.onChangeTaskPorts,
    onChangeTriggerConfig: props.onChangeTriggerConfig,
    onChangeTriggerSchedule: props.onChangeTriggerSchedule,
    onChangeWebhook: props.onChangeWebhook,
    onConnect: props.onConnect,
    onChangeValue: props.onChangeValue,
    onDeleteNodes: props.onDeleteNodes,
    onDisconnect: props.onDisconnect,
    onDuplicate: props.onDuplicate,
    onPaste: props.onPaste,
    provideAddItems: props.provideAddItems,
    onOpenVariables: props.onOpenVariables,
  }
}

export function FlowDesignerView(props: FlowDesignerViewProps): ReactElement {
  const adapter = useMemo(
    () =>
      new FlowDesignerViewAdapter(
        props.model,
        props.editable,
        props.language ?? 'en',
        props.addItems,
        callbacksFromProps(props),
        props.createSchemaEditor,
        props.autoLayout,
      ),
    [props.identity],
  )
  const previousAdapter = useRef(adapter)
  const propsRef = useRef(props)
  const selectedEdge = useRef<string>()
  propsRef.current = props

  const onMoveEnd = useCallback<OnMoveEnd>((_, viewport) => propsRef.current.onMoveViewport(viewport, adapter.store.$.displayMode.value), [adapter])
  const onNodeDragStop = useCallback<OnNodeDrag<RFNode<any>>>(
    (_, node, nodes) => {
      const moved = nodes.length > 0 ? nodes : [node]
      propsRef.current.onMoveNodes(
        Object.fromEntries(
          moved.flatMap((item) => {
            const store = item.data?.store as NodeStore | CommentNodeStore | undefined
            return store == null ? [] : [[store.nodeId, item.position]]
          }),
        ),
      )
    },
    [adapter],
  )
  const onSelectionChange = useCallback<OnSelectionChangeFunc<RFNode<any>, RFEdge<any>>>(({ edges, nodes }) => {
    const nodeIds = nodes.flatMap((node) => {
      const store = node.data?.store as NodeStore | CommentNodeStore | undefined
      return store == null ? [] : [store.nodeId]
    })
    const connection = edges[0]?.data?.store?.connection
    const edge =
      connection?.from.type == 'from_node' && connection.to.type == 'to_node'
        ? toViewEdge(connection.from.source.node_id, connection.from.source.output_handle, connection.to.target.node_id, connection.to.target.input_handle)
        : undefined
    const selected = new Set(propsRef.current.selectedNodeIds)
    const selectionChanged = nodeIds.length != selected.size || nodeIds.some((nodeId) => !selected.has(nodeId))
    const edgeChanged = selectedEdge.current != edge?.id
    selectedEdge.current = edge?.id
    if (selectionChanged || edgeChanged) propsRef.current.onSelectionChange(nodeIds, edge)
  }, [])
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
  const onDropAddItem = useCallback((itemId: string, position: FlowDesignerViewPosition) => adapter.addNode(itemId, position), [adapter])

  useEffect(() => {
    const previous = previousAdapter.current
    previousAdapter.current = adapter
    if (previous !== adapter) previous.store.dispose()
    return () => adapter.cancelPendingDisconnects()
  }, [adapter])
  useLayoutEffect(() => adapter.setCallbacks(callbacksFromProps(props)))
  useLayoutEffect(() => {
    adapter.reconcile(props.model, props.editable, props.language ?? 'en', props.addItems)
  }, [adapter, props.addItems, props.editable, props.language, props.model])
  useEffect(() => {
    if (props.focusNodeRequest != null) {
      const reducedMotion =
        typeof window != 'undefined' && typeof window.matchMedia == 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      adapter.focusNode(props.focusNodeRequest.nodeId, reducedMotion ? 0 : 150)
    }
  }, [adapter, props.focusNodeRequest])

  return (
    <FlowDesigner
      addItemRequest={props.addItemRequest}
      addNodeRequest={props.addNodeRequest}
      className={props.className}
      dark={props.dark ?? false}
      fitView={false}
      flowDesignerStore={adapter.store}
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
