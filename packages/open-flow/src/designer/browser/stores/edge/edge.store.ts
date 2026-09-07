import type { DisposableStore } from '@wopjs/disposable'
import type { ComputeGet, ReadonlyVal, Val } from 'value-enhancer'
import type { ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { HandleInputFrom, HandleOutputFrom, InputHandleDef, NodeId, OutputHandleDef } from '../../../../schema/index.ts'
import type { RFConnection, RFEdge, RFHandleName, RFNodeId } from '../../base/rfHelpers.ts'
import type { ID } from '../../base/typing.ts'
import type { ToReadonly$Group } from '../../base/val.ts'
import type { GroupedInputHandleDef, GroupedOutputHandleDef } from '../node/constants.ts'
import type { NodeStore } from '../node/node.store.ts'
import type { EdgeColor } from './colors.ts'
import type { ManifestConnection } from './typings.ts'

import { disposableStore } from '@wopjs/disposable'
import { compute, derive, val } from 'value-enhancer'
import { shallowPlainObjectEqual } from '../../../../base/common/equality.ts'
import { toRFHandleName, toRFNodeId } from '../../base/rfHelpers.ts'
import { ErrorNodeStore } from '../node/errorNode.store.ts'
import { RF_INPUT_NODE_ID } from '../node/inputNode.store.ts'
import { RF_OUTPUT_NODE_ID } from '../node/outputNode.store.ts'
import { SubflowNodeStore } from '../node/subflowNode.store.ts'
import { TriggerNodeStore } from '../node/triggerNode.store.ts'
import { ValueNodeStore } from '../node/valueNode.store.ts'
import { DEFAULT_HANDLE_KIND, getHandleKind } from '../nodeHandle/handleKind.ts'

export type EdgeId = ID<string, EdgeStore>

export interface ConnectionMeta {
  readonly dashed?: boolean
  readonly fromValueNode?: boolean
  readonly muted?: boolean
}

export interface EdgeStore$$ {
  /** error message */
  readonly error: Val<string | undefined>
  readonly selected: Val<boolean | undefined>
}

export interface EdgeStore$ extends ToReadonly$Group<EdgeStore$$> {
  readonly rfEdge: ReadonlyVal<RFEdge | undefined>
  readonly sourceGradientColor: ReadonlyVal<EdgeColor>
  readonly targetGradientColor: ReadonlyVal<EdgeColor>
  readonly connectionMeta: ReadonlyVal<ConnectionMeta | undefined>
  readonly nodeSelected: ReadonlyVal<boolean>
  readonly hasError: ReadonlyVal<boolean>
}

export interface EdgeStoreProps {
  readonly nodes: ReadonlyReactiveMap<NodeId, NodeStore>
  readonly flowNode?: SubflowNodeStore
  readonly connection: ManifestConnection
}

export class EdgeStore {
  public readonly dispose: DisposableStore = disposableStore()

  public readonly edgeId: EdgeId

  public readonly connection: ManifestConnection

  public readonly $$: EdgeStore$$
  public readonly $: EdgeStore$

  public constructor(edgeId: EdgeId, { nodes: nodes$, connection, flowNode }: EdgeStoreProps) {
    this.connection = connection
    const rfConnection = toRFEdgeConnection(nodes$, connection)
    this.edgeId = edgeId

    const error$ = this.dispose.add(val())
    const selected$ = this.dispose.add(val())

    const sourceNodeStore$ = this.dispose.add(
      derive(nodes$.$, (nodes) => {
        if (connection.from.type === 'from_node') {
          return nodes.get(connection.from.source.node_id)
        }
      }),
    )

    const targetNodeStore$ = this.dispose.add(
      derive(nodes$.$, (nodes) => {
        if (connection.to.type === 'to_node') {
          return nodes.get(connection.to.target.node_id)
        }
      }),
    )

    const sourceGradientColor$ = this.dispose.add(
      compute((get) => {
        if (connection.from.type === 'from_node') {
          const { output_handle } = connection.from.source
          const sourceNode = get(sourceNodeStore$)
          if (sourceNode) {
            if (ErrorNodeStore.is(sourceNode)) return 'error'

            const defs: GroupedOutputHandleDef[] | undefined = get(sourceNode.display$.outputs_def)
            const schema = get(defs?.find((def): def is OutputHandleDef => def.handle === output_handle))?.json_schema

            return getHandleKind(schema)
          }
        } else if (connection.from.type === 'from_flow') {
          // This edge starts at the flow input node.
          const { input_handle } = connection.from.source
          if (flowNode) {
            const defs: GroupedInputHandleDef[] | undefined = get(flowNode.display$.inputs_def)
            const schema = get(defs?.find((def): def is InputHandleDef => def.handle === input_handle))?.json_schema
            return getHandleKind(schema)
          }
        } else {
          // No other connection source is currently supported.
        }

        return DEFAULT_HANDLE_KIND
      }),
    )

    const targetGradientColor$ = this.dispose.add(
      compute((get) => {
        if (connection.to.type === 'to_node') {
          const { input_handle } = connection.to.target
          const targetNode = get(targetNodeStore$)
          if (targetNode) {
            if (ErrorNodeStore.is(targetNode)) return 'error'

            const defs: GroupedInputHandleDef[] | undefined = get(targetNode.display$.inputs_def)
            const schema = defs?.find((def): def is InputHandleDef => def.handle === input_handle)?.json_schema

            return getHandleKind(schema)
          }
        } else if (connection.to.type === 'to_flow') {
          // This edge ends at the flow output node.
          const { output_handle } = connection.to.target
          if (flowNode) {
            const defs: GroupedOutputHandleDef[] | undefined = get(flowNode.display$.outputs_def)
            const schema = get(defs?.find((def): def is OutputHandleDef => def.handle === output_handle))?.json_schema
            return getHandleKind(schema)
          }
        } else {
          // No other connection target is currently supported.
        }
        return DEFAULT_HANDLE_KIND
      }),
    )

    const connectionMeta$ = this.dispose.add(
      compute<ConnectionMeta | undefined>(
        (get) => {
          if (connection.from.type === 'from_node') {
            const node = get(sourceNodeStore$)
            const isFromSkippedNode = get(node?.display$.ignore)
            const isFromValueNode = ValueNodeStore.is(node)
            if (isFromValueNode) {
              return {
                dashed: true,
                fromValueNode: true,
                muted: hasNonValueNode(connection, targetNodeStore$, flowNode, get) || isFromSkippedNode,
              }
            }
            if (TriggerNodeStore.is(node)) {
              return { dashed: true, muted: isFromSkippedNode }
            }
            if (isFromSkippedNode) {
              return { muted: true }
            }
          }
        },
        { equal: shallowPlainObjectEqual },
      ),
    )

    const nodeSelected$ = this.dispose.add(compute((get) => get(get(sourceNodeStore$)?.$.selected) || get(get(targetNodeStore$)?.$.selected) || false))

    const data = { store: this }
    const rfEdge$ = this.dispose.add(
      compute((get) => {
        return {
          ...rfConnection,
          id: this.edgeId,
          data,
          selected: get(selected$),
          zIndex: get(get(sourceNodeStore$)?.$.selected) && get(get(targetNodeStore$)?.$.selected) ? 1 : 0,
        } satisfies RFEdge
      }),
    )

    this.$$ = {
      error: error$,
      selected: selected$,
    }
    this.$ = {
      error: error$,
      selected: selected$,
      sourceGradientColor: sourceGradientColor$,
      targetGradientColor: targetGradientColor$,
      connectionMeta: connectionMeta$,
      nodeSelected: nodeSelected$,
      rfEdge: rfEdge$,
      hasError: this.dispose.add(derive(error$, (error) => !!error)),
    }
  }
}

export function getRFEdgeId({ from, to }: ManifestConnection): EdgeId {
  let source: string
  switch (from.type) {
    case 'from_node':
      source = `node(${from.source.node_id}:${from.source.output_handle})`
      break
    case 'from_flow':
      source = `flow(${from.source.input_handle})`
      break
  }
  let target: string
  switch (to.type) {
    case 'to_node':
      target = `node(${to.target.node_id}:${to.target.input_handle})`
      break
    case 'to_flow':
      target = `flow(${to.target.output_handle})`
      break
  }
  return `${source} → ${target}` as EdgeId
}

function toRFEdgeConnection(nodes: ReadonlyReactiveMap<NodeId, NodeStore>, connection: ManifestConnection): RFConnection {
  let source: RFNodeId
  let target: RFNodeId
  let sourceHandle: RFHandleName
  let targetHandle: RFHandleName

  switch (connection.from.type) {
    case 'from_flow':
      source = RF_INPUT_NODE_ID
      sourceHandle = toRFHandleName(connection.from.source.input_handle)
      break
    case 'from_node':
      source = nodes.get(connection.from.source.node_id)?.rfNodeId || toRFNodeId(connection.from.source.node_id)
      sourceHandle = toRFHandleName(connection.from.source.output_handle)
      break
    default: {
      connection.from satisfies never
      throw new Error(`Unknown connection.from: ${JSON.stringify(connection.from)}`)
    }
  }

  switch (connection.to.type) {
    case 'to_flow':
      target = RF_OUTPUT_NODE_ID
      targetHandle = toRFHandleName(connection.to.target.output_handle)
      break
    case 'to_node':
      target = toRFNodeId(connection.to.target.node_id)
      targetHandle = toRFHandleName(connection.to.target.input_handle)
      break
    default: {
      connection.to satisfies never
      throw new Error(`Unknown connection.to: ${JSON.stringify(connection.to)}`)
    }
  }

  return {
    source,
    sourceHandle,
    target,
    targetHandle,
  }
}

function hasNonValueNode(
  { to }: ManifestConnection,
  targetNodeStore$: ReadonlyVal<NodeStore | undefined>,
  flowNode: SubflowNodeStore | undefined,
  get: ComputeGet,
): boolean {
  let from: HandleInputFrom | HandleOutputFrom | undefined
  if (to.type === 'to_node') {
    const inputsFrom = get(get(targetNodeStore$)?.display$.inputs_from)
    from = inputsFrom?.find((f) => f.handle === to.target.input_handle)
  }
  if (to.type === 'to_flow') {
    const outputsFrom = get(flowNode?.display$.outputs_from)
    from = outputsFrom?.find((f) => f.handle === to.target.output_handle)
  }
  if ((from?.from_node?.length || 0) > 1) return true
  return (from?.from_flow?.length || 0) > 1
}
