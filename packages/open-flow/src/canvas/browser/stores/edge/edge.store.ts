import type { DisposableStore } from '@wopjs/disposable'
import type { ComputeGet, ReadonlyVal, Val } from 'value-enhancer'
import type { ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { HandleName, NodeId } from '../../../../schema/index.ts'
import type { RFConnection, RFEdge } from '../../base/rfHelpers.ts'
import type { ID } from '../../base/typing.ts'
import type { ToReadonly$Group } from '../../base/val.ts'
import type { FlowCanvasViewEdge } from '../../graph/FlowCanvas/model.ts'
import type { NodeStore } from '../node/node.store.ts'
import type { EdgeColor } from './colors.ts'

import { disposableStore } from '@wopjs/disposable'
import { compute, derive, val } from 'value-enhancer'
import { shallowPlainObjectEqual } from '../../../../base/common/equality.ts'
import { toRFHandleName, toRFNodeId } from '../../base/rfHelpers.ts'
import { DEFAULT_HANDLE_KIND, getHandleKind } from '../../components/handleKind.ts'
import { portSchema } from '../../graph/FlowCanvas/nodeContent.ts'
import { NODE_TYPE } from '../node/constants.ts'

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
  readonly connection: FlowCanvasViewEdge
}

export class EdgeStore {
  public readonly dispose: DisposableStore = disposableStore()

  public readonly edgeId: EdgeId

  public readonly connection: FlowCanvasViewEdge

  public readonly $$: EdgeStore$$
  public readonly $: EdgeStore$

  public constructor(edgeId: EdgeId, { nodes: nodes$, connection }: EdgeStoreProps) {
    this.connection = connection
    const rfConnection = toRFEdgeConnection(nodes$, connection)
    this.edgeId = edgeId

    const error$ = this.dispose.add(val())
    const selected$ = this.dispose.add(val())

    const sourceNodeStore$ = this.dispose.add(derive(nodes$.$, (nodes) => nodes.get(connection.source as NodeId)))
    const targetNodeStore$ = this.dispose.add(derive(nodes$.$, (nodes) => nodes.get(connection.target as NodeId)))
    const sourceGradientColor$ = this.dispose.add(
      compute((get) => {
        const node = get(sourceNodeStore$)
        return node == null ? DEFAULT_HANDLE_KIND : getHandleKind(portSchema(get(node.content$), 'output', connection.sourceHandle))
      }),
    )
    const targetGradientColor$ = this.dispose.add(
      compute((get) => {
        const node = get(targetNodeStore$)
        return node == null ? DEFAULT_HANDLE_KIND : getHandleKind(portSchema(get(node.content$), 'input', connection.targetHandle))
      }),
    )

    const connectionMeta$ = this.dispose.add(
      compute<ConnectionMeta | undefined>(
        (get) => {
          const node = get(sourceNodeStore$)
          const isFromSkippedNode = get(node?.ignore)
          const isFromValueNode = node?.nodeType === NODE_TYPE.ValueNode
          if (isFromValueNode) {
            return {
              dashed: true,
              fromValueNode: true,
              muted: hasNonValueNode(connection, targetNodeStore$, get) || isFromSkippedNode,
            }
          }
          if (node?.nodeType === NODE_TYPE.TriggerNode) {
            return { dashed: true, muted: isFromSkippedNode }
          }
          if (isFromSkippedNode) {
            return { muted: true }
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

export function getRFEdgeId(connection: FlowCanvasViewEdge): EdgeId {
  return `node(${connection.source}:${connection.sourceHandle}) → node(${connection.target}:${connection.targetHandle})` as EdgeId
}

function toRFEdgeConnection(nodes: ReadonlyReactiveMap<NodeId, NodeStore>, connection: FlowCanvasViewEdge): RFConnection {
  return {
    source: nodes.get(connection.source as NodeId)?.rfNodeId ?? toRFNodeId(connection.source as NodeId),
    target: toRFNodeId(connection.target as NodeId),
    sourceHandle: toRFHandleName(connection.sourceHandle as HandleName),
    targetHandle: toRFHandleName(connection.targetHandle as HandleName),
  }
}

function hasNonValueNode(connection: FlowCanvasViewEdge, targetNodeStore$: ReadonlyVal<NodeStore | undefined>, get: ComputeGet): boolean {
  const node = get(get(targetNodeStore$)?.content$)
  const input = node?.inputs.find((candidate) => 'handle' in candidate && candidate.handle == connection.targetHandle)
  return input != null && 'sources' in input && (input.sources?.length ?? 0) > 1
}
