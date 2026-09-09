import type { DisposableStore } from '@wopjs/disposable'
import type { ReactFlowInstance, XYPosition } from '@xyflow/react'
import type { ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { NodeId } from '../../../../schema/index.ts'
import type { RFNode } from '../../base/rfHelpers.ts'
import type { NodeStore } from '../node/node.store.ts'

import { disposableStore } from '@wopjs/disposable'
import { asArray, coalesce } from '../../base/trivial.ts'
import { getNodeMinimap, NodeMiniMapPhase } from './nodeMiniMap.ts'

export type RFCommandName = Exclude<keyof RFCommandImpl, keyof RFCommand>

export type CommandArgs<K extends RFCommandName> = RFCommandImpl[K] extends (rf: ReactFlowInstance, ...args: infer Args) => any ? Args : never

export interface RFCommand {
  readonly dispose: DisposableStore
  send<K extends RFCommandName>(method: K, ...args: CommandArgs<K>): void
  onRFInstance(rf: ReactFlowInstance): () => void
}

/**
 * Sends commands from a CanvasStore to its React Flow instances.
 * One CanvasStore may control multiple React Flow instances.
 */
export const createRFCommand = (nodes: ReadonlyReactiveMap<NodeId, NodeStore>): RFCommand => new RFCommandImpl(nodes)

/**
 * Sends commands from a CanvasStore to its React Flow instances.
 * One CanvasStore may control multiple React Flow instances.
 *
 * To add a command such as `focusNode`, declare its first argument as a
 * ReactFlowInstance on RFCommandImpl. Calling
 * `designer.command.send("focusNode", nodeId)` then invokes it for every
 * registered instance.
 */
class RFCommandImpl implements RFCommand {
  public readonly dispose: DisposableStore = disposableStore()

  private readonly rfs = new Set<ReactFlowInstance>()
  public readonly onRFInstance = (rf: ReactFlowInstance) => {
    this.rfs.add(rf)
    return (): void => {
      this.rfs.delete(rf)
    }
  }

  public send<K extends RFCommandName>(method: K, ...args: CommandArgs<K>): void {
    for (const rf of this.rfs) {
      ;(this[method] as any)(rf, ...args)
    }
  }

  public constructor(private readonly nodes: ReadonlyReactiveMap<NodeId, NodeStore>) {
    this.dispose.add(() => {
      this.rfs.clear()
    })
  }

  //#region Commands

  public focusNode(rf: ReactFlowInstance, nodeIds: NodeId | readonly NodeId[], options: { duration?: number } = { duration: 150 }): void {
    const nodes = coalesce(asArray(nodeIds).map((nodeId) => this.nodes.get(nodeId)?.$.rfNode.value))
    focusNodes(this.nodes.size, rf, nodes, options)
  }

  //#endregion
}

function getCenter(rfNode: RFNode): XYPosition {
  const x = rfNode.position.x ?? 0
  const y = rfNode.position.y ?? 0
  const width = rfNode.measured?.width ?? 400
  const height = rfNode.measured?.height ?? 200
  return { x: x + width / 2, y: y + height / 2 }
}

function focusNodes(nodesCount: number, rf: ReactFlowInstance, rfNodes: RFNode[], options: { duration?: number }) {
  if (!rfNodes.length) return

  if (rfNodes.length > 1) {
    rf.fitBounds(rf.getNodesBounds(rfNodes), { duration: 150, padding: 0.15, ...options })
  } else {
    const rfNode = rfNodes[0]
    const center = getCenter(rfNode)
    const zoom = getNodeMinimap(nodesCount, rf.getZoom()) === NodeMiniMapPhase.None ? rf.getZoom() : 1
    rf.setCenter(center.x, center.y, { zoom, ...options })
  }
}
