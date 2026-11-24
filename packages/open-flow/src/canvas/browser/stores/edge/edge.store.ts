import type { DisposableStore } from '@wopjs/disposable'
import type { ComputeGet, ReadonlyVal, Val } from 'value-enhancer'
import type { ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { HandleName, NodeId } from '../../../../schema/index.ts'
import type { RFConnection, RFEdge } from '../../base/rfHelpers.ts'
import type { ID } from '../../base/typing.ts'
import type { ToReadonly$Group } from '../../base/val.ts'
import type { FlowCanvasViewEdge } from '../../graph/FlowCanvas/model.ts'
import type { NodeContent } from '../../graph/FlowCanvas/nodeContent.ts'
import type { NodeStore } from '../node/node.store.ts'

import { disposableStore } from '@wopjs/disposable'
import { compute, derive, val } from 'value-enhancer'
import { shallowPlainObjectEqual } from '../../../../base/common/equality.ts'
import { toRFHandleName, toRFNodeId } from '../../base/rfHelpers.ts'
import { NODE_TYPE } from '../node/constants.ts'

export type EdgeId = ID<string, EdgeStore>

export interface ConnectionMeta {
  readonly dashed?: boolean
  readonly executed?: boolean
  readonly fromValueNode?: boolean
  readonly muted?: boolean
  readonly runMuted?: boolean
}

export interface EdgeStore$$ {
  /** error message */
  readonly error: Val<string | undefined>
  readonly selected: Val<boolean | undefined>
}

export interface EdgeStore$ extends ToReadonly$Group<EdgeStore$$> {
  readonly rfEdge: ReadonlyVal<RFEdge | undefined>
  readonly sourceGradientColor: ReadonlyVal<string>
  readonly targetGradientColor: ReadonlyVal<string>
  readonly connectionMeta: ReadonlyVal<ConnectionMeta | undefined>
  readonly nodeSelected: ReadonlyVal<boolean>
  readonly hovered: ReadonlyVal<boolean>
  readonly hasError: ReadonlyVal<boolean>
}

export interface EdgeStoreProps {
  readonly nodes: ReadonlyReactiveMap<NodeId, NodeStore>
  readonly connection: FlowCanvasViewEdge
  readonly hoveredNodeId?: ReadonlyVal<NodeId | undefined>
  readonly hoveredEdgeId?: ReadonlyVal<EdgeId | undefined>
  readonly hasRun?: ReadonlyVal<boolean>
}

export class EdgeStore {
  public readonly dispose: DisposableStore = disposableStore()

  public readonly edgeId: EdgeId

  public readonly connection: FlowCanvasViewEdge

  public readonly $$: EdgeStore$$
  public readonly $: EdgeStore$

  public constructor(edgeId: EdgeId, { nodes: nodes$, connection, hoveredNodeId, hoveredEdgeId, hasRun }: EdgeStoreProps) {
    this.connection = connection
    const rfConnection = toRFEdgeConnection(nodes$, connection)
    this.edgeId = edgeId

    const error$ = this.dispose.add(val())
    const selected$ = this.dispose.add(val())

    const sourceNodeStore$ = this.dispose.add(derive(nodes$.$, (nodes) => nodes.get(connection.source as NodeId)))
    const targetNodeStore$ = this.dispose.add(derive(nodes$.$, (nodes) => nodes.get(connection.target as NodeId)))
    const executed$ = this.dispose.add(compute((get) => isEdgeExecuted(connection, get(get(sourceNodeStore$)?.content$), get(get(targetNodeStore$)?.content$))))
    const sourceGradientColor$ = this.dispose.add(
      compute((get) => {
        const portColor = get(get(sourceNodeStore$)?.$.executionPortColor)
        if (get(executed$)) {
          return portColor === 'var(--accent-red-1)' || portColor === 'var(--_open-flow-error-stroke)' ? portColor : 'var(--edge-executed)'
        }
        return portColor == null || portColor === 'var(--edge-executed)' || portColor === 'var(--edge-executed-selected)' ? 'var(--edge-primitive)' : portColor
      }),
    )
    const targetGradientColor$ = this.dispose.add(
      compute((get) => {
        const portColor = get(get(targetNodeStore$)?.$.executionPortColor)
        if (get(executed$)) {
          return portColor === 'var(--accent-red-1)' || portColor === 'var(--_open-flow-error-stroke)' ? portColor : 'var(--edge-executed)'
        }
        return portColor == null || portColor === 'var(--edge-executed)' || portColor === 'var(--edge-executed-selected)' ? 'var(--edge-primitive)' : portColor
      }),
    )

    const connectionMeta$ = this.dispose.add(
      compute<ConnectionMeta | undefined>(
        (get) => {
          const node = get(sourceNodeStore$)
          const executed = get(executed$)
          const isFromSkippedNode = get(node?.ignore)
          const isFromValueNode = node?.nodeType === NODE_TYPE.ValueNode
          const muted = isFromValueNode ? hasNonValueNode(connection, targetNodeStore$, get) || isFromSkippedNode : isFromSkippedNode
          const runMuted = !executed && !muted && Boolean(hasRun && get(hasRun))
          if (!isFromValueNode && !muted && !runMuted && !executed) return undefined
          return {
            ...(isFromValueNode ? { dashed: true, fromValueNode: true } : {}),
            ...(muted ? { muted: true } : {}),
            ...(runMuted ? { runMuted: true } : {}),
            ...(executed ? { executed: true } : {}),
          }
        },
        { equal: shallowPlainObjectEqual },
      ),
    )

    const nodeSelected$ = this.dispose.add(compute((get) => get(get(sourceNodeStore$)?.$.selected) || get(get(targetNodeStore$)?.$.selected) || false))
    const hovered$ = this.dispose.add(
      compute(
        (get) =>
          (hoveredEdgeId != null && get(hoveredEdgeId) === this.edgeId) ||
          (hoveredNodeId != null && (get(hoveredNodeId) === connection.source || get(hoveredNodeId) === connection.target)),
      ),
    )

    const data = { store: this }
    const rfEdge$ = this.dispose.add(
      compute((get) => {
        return {
          ...rfConnection,
          id: this.edgeId,
          data,
          selected: get(selected$),
          zIndex: get(selected$) ? 3 : get(hovered$) ? 2 : get(nodeSelected$) ? 1 : 0,
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
      hovered: hovered$,
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

const activeOrExecutedTargetStatuses = new Set(['running', 'waiting', 'success', 'handled', 'error'])

export function isEdgeExecuted(connection: FlowCanvasViewEdge, sourceContent: NodeContent | undefined, targetContent: NodeContent | undefined): boolean {
  const sourceStatus = sourceContent?.run?.status
  const targetStatus = targetContent?.run?.status
  if (sourceStatus !== 'success' && sourceStatus !== 'handled') return false
  if (targetStatus == null || !activeOrExecutedTargetStatuses.has(targetStatus)) return false
  if (connection.sourceHandle.startsWith('$branch:')) {
    const branch = connection.sourceHandle.slice('$branch:'.length)
    const releasedHandles = sourceContent?.run?.releasedHandles
    if (releasedHandles != null) return releasedHandles.includes(branch)
    const outputs = sourceContent?.run?.outputs
    if (outputs != null && typeof outputs === 'object' && !Array.isArray(outputs) && Object.keys(outputs).length > 0) {
      return Object.hasOwn(outputs, branch)
    }
  }
  return true
}
