import type { InternalNode, ReactFlowState } from '@xyflow/react'
import type { PropsWithChildren } from 'react'
import type { ReadonlyVal } from 'value-enhancer'
import type { CanvasDirection } from '../../../common/direction.ts'
import type { LayoutNode, LayoutPoint } from '../../base/wrapLayout.ts'

import { Position, useStore } from '@xyflow/react'
import { createContext, useMemo } from 'react'
import { useVal } from 'use-value-enhancer'
import { shallowPlainObjectEqual } from '../../../../base/common/equality.ts'
import { routeLayout } from '../../base/routeLayout.ts'
import { layoutAxes } from '../../base/wrapLayout.ts'

interface RoutingNode extends LayoutNode {
  readonly handles: InternalNode['internals']['handleBounds']
}

const emptyRoutes: ReadonlyMap<string, readonly LayoutPoint[]> = new Map()
const emptyNodes: RoutingNode[] = []
const emptyEdges: ReactFlowState['edges'] = []
export const ConnectionRoutesContext = createContext(emptyRoutes)

export interface ConnectionRoutesProviderProps extends PropsWithChildren {
  readonly direction?: CanvasDirection
  /** Complete routes supplied by an explicitly arranged canvas. */
  readonly routes$?: ReadonlyVal<ReadonlyMap<string, readonly LayoutPoint[]>>
}

function inactiveNodes(): RoutingNode[] {
  return emptyNodes
}

// Snapshot geometry because React Flow updates absolute positions in place.
function measuredNodes(state: ReactFlowState): RoutingNode[] {
  return [...state.nodeLookup.values()].flatMap((node) =>
    node.hidden || !node.measured.width || !node.measured.height
      ? []
      : [
          {
            id: node.id,
            ...layoutAxes(node.internals.positionAbsolute, 'vertical'),
            width: node.measured.height,
            height: node.measured.width,
            column: 0,
            handles: node.internals.handleBounds,
          },
        ],
  )
}

function sameNodes(a: readonly RoutingNode[], b: readonly RoutingNode[]): boolean {
  return a.length === b.length && a.every((node, index) => shallowPlainObjectEqual(node, b[index]))
}

/** Share obstacle-aware routes using React Flow's measured cards and actual ports. */
export function ConnectionRoutesProvider({ direction, routes$, children }: ConnectionRoutesProviderProps) {
  const planned = useVal(routes$)
  const active = direction === 'vertical' && !planned?.size
  const nodes = useStore(active ? measuredNodes : inactiveNodes, sameNodes)
  const edges = useStore((state) => (active ? state.edges : emptyEdges))
  const routes = useMemo(() => {
    if (planned?.size) return planned
    if (direction !== 'vertical') return emptyRoutes
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const connections = edges.flatMap((edge) => {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      const output = source?.handles?.source?.find((handle) => edge.sourceHandle == null || handle.id === edge.sourceHandle)
      const input = target?.handles?.target?.find((handle) => edge.targetHandle == null || handle.id === edge.targetHandle)
      if (edge.hidden || !source || !target || output?.position !== Position.Bottom || input?.position !== Position.Top) return []
      return [
        {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceOffset: { x: output.y + output.height, y: output.x + output.width / 2 },
          targetOffset: { x: input.y, y: input.x + input.width / 2 },
        },
      ]
    })
    return new Map(
      [...routeLayout(nodes, connections, { allowBlockedPorts: true })].map(([id, points]) => [id, points.map((point) => layoutAxes(point, 'vertical'))]),
    )
  }, [direction, nodes, edges, planned])
  return <ConnectionRoutesContext.Provider value={routes}>{children}</ConnectionRoutesContext.Provider>
}
