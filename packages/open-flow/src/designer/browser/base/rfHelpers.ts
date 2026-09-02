import type { Edge as _Edge, Node as _Node, EdgeChange, NodeChange, Rect } from '@xyflow/react'
import type { ReadonlyVal } from 'value-enhancer'
import type { HandleName, NodeId } from '../../../schema/index.ts'
import type { EdgeId, EdgeStore } from '../stores/edge/edge.store.ts'
import type { ManifestConnection } from '../stores/edge/typings.ts'
import type { CommentNodeStore } from '../stores/node/commentNode.store.ts'
import type { NodeType } from '../stores/node/constants.ts'
import type { NodeStore } from '../stores/node/node.store.ts'
import type { ID } from './typing.ts'

import { isBoolean } from '@wopjs/cast'
import { INPUT_NODE_ID, NODE_TYPE, OUTPUT_NODE_ID } from '../stores/node/constants.ts'
import { isSameXYPosition, isSize } from './compare.ts'
import { DEFAULT_POSITION } from './designer.ts'

export type RFNode = _Node<{ store: NodeStore | CommentNodeStore }>
export type RFEdge = _Edge<{ store: EdgeStore }>

/** A node identifier with its React Flow kind prefix. */
export type RFNodeId = ID<string, RFNode>
export type RFHandleName = ID<string, RFNode>

export type RFConnection = {
  source: RFNodeId
  target: RFNodeId
  sourceHandle: RFHandleName
  targetHandle: RFHandleName
}

export type PartialConnection = Pick<RFConnection, 'source' | 'sourceHandle'> | Pick<RFConnection, 'target' | 'targetHandle'>

export function makeConnection(connection: PartialConnection, nodeId: NodeId, handle: HandleName): RFConnection {
  if ('target' in connection) {
    return {
      ...connection,
      source: toRFNodeId(nodeId),
      sourceHandle: toRFHandleName(handle),
    }
  } else {
    return {
      ...connection,
      target: toRFNodeId(nodeId),
      targetHandle: toRFHandleName(handle),
    }
  }
}

/** Converts a manifest node identifier to a React Flow identifier. */
export function toRFNodeId(nodeId: NodeId, nodeType?: NodeType): RFNodeId {
  const prefix = nodeType === NODE_TYPE.InputNode ? 'i:' : nodeType === NODE_TYPE.OutputNode ? 'o:' : nodeType === NODE_TYPE.CommentNode ? 'c:' : 'm:'
  return (prefix + nodeId) as RFNodeId
}

export type RFNodeType = `${RF_NODE_TYPE}`
export enum RF_NODE_TYPE {
  InputNode = 'input_node',
  OutputNode = 'output_node',
  CommentNode = 'comment_node',
  /** Node generated from manifest */
  ManifestNode = 'manifest_node',
}

RF_NODE_TYPE.InputNode satisfies `${NODE_TYPE.InputNode}`
RF_NODE_TYPE.OutputNode satisfies `${NODE_TYPE.OutputNode}`
RF_NODE_TYPE.CommentNode satisfies `${NODE_TYPE.CommentNode}`

export function getRFNodeType(rfNodeId: RFNodeId): RFNodeType | undefined {
  if (rfNodeId[1] === ':') {
    switch (rfNodeId[0]) {
      case 'i':
        return RF_NODE_TYPE.InputNode
      case 'o':
        return RF_NODE_TYPE.OutputNode
      case 'm':
        return RF_NODE_TYPE.ManifestNode
      case 'c':
        return RF_NODE_TYPE.CommentNode
    }
  }
}

export function toManifestNodeId(rfNodeId: RFNodeId): NodeId {
  if (rfNodeId[1] === ':') {
    switch (rfNodeId[0]) {
      case 'i':
      case 'o':
      case 'm':
      case 'c':
        return rfNodeId.slice(2) as NodeId
    }
  }
  return rfNodeId as string as NodeId
}

export function toRFHandleName(handleName: HandleName): RFHandleName {
  return `h:${handleName}` as RFHandleName
}

export type RFHandleType = `${RF_HANDLE_TYPE}`
export enum RF_HANDLE_TYPE {
  Handle = 'handle',
}

export function getRFHandleType(rfHandleName: RFHandleName): RFHandleType | undefined {
  if (rfHandleName[1] === ':') {
    switch (rfHandleName[0]) {
      case 'h':
        return RF_HANDLE_TYPE.Handle
    }
  }
}

export function toManifestHandleName(rfHandleName: RFHandleName): HandleName {
  if (rfHandleName[1] === ':') {
    if (rfHandleName[0] === 'h') {
      return rfHandleName.slice(2) as HandleName
    }
  }
  return rfHandleName as string as HandleName
}

export function applyNodeChanges<TRFNode extends RFNode = RFNode>(
  changes: NodeChange<TRFNode>[],
  nodes: ReadonlyMap<NodeId, NodeStore> | NodeStore,
  pseudoNodes: ReadonlyMap<NodeId, NodeStore> | undefined,
  commentNodes: ReadonlyMap<NodeId, CommentNodeStore> | undefined,
  editable$: ReadonlyVal<boolean | undefined>,
): Set<NodeStore | CommentNodeStore> | undefined {
  let toRemove: Set<NodeStore | CommentNodeStore> | undefined

  for (const change of changes) {
    const rfNodeId = (change as { id?: RFNodeId }).id
    if (!rfNodeId) continue
    let nodeId: NodeId
    let nodeStore: NodeStore | CommentNodeStore | undefined

    const rfNodeType = getRFNodeType(rfNodeId)
    if (rfNodeType === RF_NODE_TYPE.CommentNode) {
      nodeId = toManifestNodeId(rfNodeId)
      nodeStore = commentNodes?.get(nodeId)
    } else if (rfNodeType === RF_NODE_TYPE.InputNode && pseudoNodes?.has(INPUT_NODE_ID)) {
      nodeStore = pseudoNodes.get(INPUT_NODE_ID)!
      nodeId = nodeStore.nodeId
    } else if (rfNodeType === RF_NODE_TYPE.OutputNode && pseudoNodes?.has(OUTPUT_NODE_ID)) {
      nodeStore = pseudoNodes.get(OUTPUT_NODE_ID)!
      nodeId = nodeStore.nodeId
    } else if (rfNodeType === RF_NODE_TYPE.ManifestNode) {
      nodeId = toManifestNodeId(rfNodeId)
      if ('get' in nodes) {
        nodeStore = nodes.get(nodeId)
      } else if (nodes.nodeId === nodeId) {
        nodeStore = nodes
      } else {
        return
      }
    }

    if (!nodeStore || toRemove?.has(nodeStore)) continue

    switch (change.type) {
      case 'add': {
        console.error(new Error('Should not happen: add node change should be handled by flow store'))
        break
      }
      case 'remove': {
        if (editable$.value) {
          ;(toRemove ??= new Set()).add(nodeStore)
        }
        break
      }
      case 'select': {
        nodeStore.$$.selected.set(change.selected)
        break
      }
      case 'position': {
        const current = nodeStore.$.rfNode.value
        const position = change.position ?? current.position ?? DEFAULT_POSITION
        if (!isSameXYPosition(current.position, position) || current.dragging !== change.dragging) {
          nodeStore.$$.rfNode.set({ ...current, position, dragging: change.dragging })
        }
        break
      }
      case 'dimensions': {
        const current = nodeStore.$.rfNode.value
        const update = { ...current }
        if (isSize(change.dimensions)) {
          update.measured = change.dimensions
          if (change.setAttributes) {
            update.width = change.dimensions.width
            update.height = change.dimensions.height
          }
        }

        if (isBoolean(change.resizing)) {
          update.resizing = change.resizing
        }

        if (
          current.measured?.width != update.measured?.width ||
          current.measured?.height != update.measured?.height ||
          current.width != update.width ||
          current.height != update.height ||
          current.resizing != update.resizing
        ) {
          nodeStore.$$.rfNode.set(update)
        }
        break
      }
      case 'replace': {
        if (editable$.value) {
          nodeStore.$$.rfNode.set(change.item)
        }
        break
      }
      default: {
        console.error(new Error('Unknown node change type'), change)
        break
      }
    }
  }

  return toRemove
}

export function applyEdgeChanges<TRFEdge extends RFEdge = RFEdge>(
  changes: EdgeChange<TRFEdge>[],
  edges: readonly RFEdge[],
  editable$: ReadonlyVal<boolean | undefined>,
): Set<ManifestConnection> | undefined {
  let toRemoveConnections: Set<ManifestConnection> | undefined

  for (const change of changes) {
    const edgeId = (change as { id?: EdgeId }).id
    if (!edgeId) continue

    const edgeStore = edges.find((edge) => edge.id === edgeId)?.data?.store
    if (!edgeStore || toRemoveConnections?.has(edgeStore.connection)) continue

    switch (change.type) {
      case 'add': {
        console.error(new Error('Should not happen: add edge change should be handled by flow store'))
        break
      }
      case 'remove': {
        if (editable$.value) {
          ;(toRemoveConnections ??= new Set()).add(edgeStore.connection)
        }
        break
      }
      case 'select': {
        edgeStore.$$.selected.set(change.selected)
        break
      }
      case 'replace': {
        if (editable$.value) {
          edgeStore.$$.selected.set(change.item.selected)
        }
        break
      }
      default: {
        console.error(new Error('Unknown edge change type'), change)
        break
      }
    }
  }

  return toRemoveConnections
}

export function isRectIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
