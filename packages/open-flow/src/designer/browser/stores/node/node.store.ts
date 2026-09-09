import type { DisposableStore } from '@wopjs/disposable'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { NodeId } from '../../../../schema/index.ts'
import type { Size, XYPosition } from '../../base/compare.ts'
import type { RFNode, RFNodeId } from '../../base/rfHelpers.ts'
import type { ToReadonly$Group } from '../../base/val.ts'
import type { NodeContent } from '../../graph/FlowDesigner/nodeContent.ts'
import type { NodeType } from './constants.ts'
import type { NodeInteraction } from './nodeInteraction.ts'

import { disposableStore } from '@wopjs/disposable'
import { derive } from 'value-enhancer'
import { NODE_HANDLE_CLASSNAME } from '../../base/designer.ts'
import { toRFNodeId } from '../../base/rfHelpers.ts'
import { createNodeInteraction } from './nodeInteraction.ts'

const dragHandle = `.${NODE_HANDLE_CLASSNAME}`

export interface NodeStore$$ {
  readonly rfNode: Val<RFNode>
  readonly selected: Val<boolean | undefined>
  readonly position: Val<XYPosition>
}

export type NodeStore$ = ToReadonly$Group<NodeStore$$> & {
  readonly hasError: ReadonlyVal<boolean>
  readonly measured: ReadonlyVal<Partial<Size> | undefined>
}

export interface NodeStoreProps {
  readonly ignoredNodeIds: ReadonlyVal<readonly string[]>
  readonly onIgnore?: (ignored: boolean) => void
  /** NodeStore owns these values. */
  readonly content$: Val<NodeContent>

  readonly position: XYPosition
  readonly duplicateNode?: (offset?: XYPosition | undefined) => void
}

export class NodeStore {
  public static is(store: unknown): store is NodeStore {
    return store instanceof NodeStore
  }

  public static to(store: unknown): NodeStore | undefined {
    return store instanceof NodeStore ? store : undefined
  }

  public readonly dispose: DisposableStore = disposableStore()

  public readonly content$: ReadonlyVal<NodeContent>
  public readonly ignore: ReadonlyVal<boolean>
  public readonly setIgnored: (ignored: boolean) => void
  public readonly duplicateNode: ((offset?: XYPosition) => void) | undefined

  public readonly nodeType: NodeType
  public readonly nodeId: NodeId

  public readonly rfNodeId: RFNodeId

  public readonly interaction: NodeInteraction

  public readonly $$: NodeStore$$
  public readonly $: NodeStore$

  public constructor(nodeId: NodeId, nodeType: NodeType, props: NodeStoreProps) {
    this.ignore = this.dispose.add(derive(props.ignoredNodeIds, (ids) => ids.includes(nodeId)))
    this.setIgnored = (ignored) => props.onIgnore?.(ignored)
    this.nodeId = nodeId
    this.nodeType = nodeType
    this.rfNodeId = toRFNodeId(nodeId, nodeType)
    this.content$ = this.dispose.add(props.content$)
    this.duplicateNode = props.duplicateNode

    const interaction = (this.interaction = this.dispose.add(
      createNodeInteraction({
        id: this.rfNodeId,
        type: this.nodeType,
        position: props.position,
        dragHandle,
        data: Object.freeze({ store: this }),
      }),
    ))

    this.$$ = {
      rfNode: interaction.rfNode,
      selected: interaction.selected,
      position: interaction.position,
    }

    this.$ = {
      ...this.$$,
      measured: interaction.measured,
      hasError: this.dispose.add(derive(this.content$, (content) => (content.diagnostics ?? 0) > 0)),
    }
  }
}
