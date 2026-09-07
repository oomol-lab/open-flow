import type { Edge, OnNodesChange, Viewport } from '@xyflow/react'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { ReactiveMap, ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { NodeId } from '../../../../schema/index.ts'
import type { RFNode } from '../../base/rfHelpers.ts'
import type { DesignerOption as IBasicOption } from '../../components/select.tsx'
import type { NodeStore } from '../node/node.store.ts'
import type { DesignerStore$, DesignerStore$$, DesignerStoreProps } from './designer.store.ts'

import { compute, val } from 'value-enhancer'
import { applyNodeChanges } from '../../base/rfHelpers.ts'
import { coalesce } from '../../base/trivial.ts'
import { defaultNodeIcon } from '../../graph/Nodes/components/constants.ts'
import { INPUT_NODE_ID, OUTPUT_NODE_ID } from '../node/constants.ts'
import { SubflowNodeStore } from '../node/subflowNode.store.ts'
import { DesignerStore } from './designer.store.ts'
import { NodeMiniMapPhase } from './nodeMiniMap.ts'
import { DESIGNER_TYPE } from './typings.ts'

export interface SubflowDesignerStoreManifest$ {
  readonly icon: Val<string | undefined>
  readonly title: Val<string | undefined>
  readonly description: Val<string | undefined>
  readonly private?: Val<boolean | undefined>
  readonly forward_previews?: Val<NodeId[] | undefined>
}

export interface SubflowDesignerStoreDisplay$ {
  readonly icon: ReadonlyVal<string | undefined>
  readonly title: ReadonlyVal<string | undefined>
  readonly description: ReadonlyVal<string | undefined>
  readonly forward_previews?: ReadonlyVal<NodeId[] | undefined>
}

export interface SubflowDesignerStore$ extends DesignerStore$ {
  readonly viewMode: ReadonlyVal<SubflowViewMode>
  readonly forwardPreviewOptions: ReadonlyVal<ForwardPreviewOption[]>
}

export interface SubflowDesignerStore$$ extends DesignerStore$$ {
  readonly viewMode: Val<SubflowViewMode>
  /** The temporary viewport for block mode. Switching modes resets it. */
  readonly nodeViewport: Val<Viewport | undefined>
}

export enum SUBFLOW_VIEW_MODE {
  Block = 'block',
  Flow = 'flow',
}

export type SubflowViewMode = `${SUBFLOW_VIEW_MODE}`

export interface ForwardPreviewOption extends IBasicOption {
  readonly value: NodeId
}

export interface SubflowDesignerStoreProps extends DesignerStoreProps {
  readonly manifest$?: SubflowDesignerStoreManifest$
  readonly display$: SubflowDesignerStoreDisplay$
  readonly viewMode: Val<SubflowViewMode>
  readonly pseudoNodes: ReactiveMap<NodeId, NodeStore>
  readonly flowNode: SubflowNodeStore
}

export class SubflowDesignerStore extends DesignerStore {
  public static is(store: unknown): store is SubflowDesignerStore {
    return (store as DesignerStore)?.designerType === DESIGNER_TYPE.Subflow
  }

  declare public readonly $: SubflowDesignerStore$
  declare public readonly $$: SubflowDesignerStore$$

  public readonly manifest$?: SubflowDesignerStoreManifest$
  public readonly display$: SubflowDesignerStoreDisplay$

  public override readonly pseudoNodes: ReactiveMap<NodeId, NodeStore>
  public override readonly flowNode: SubflowNodeStore

  public constructor(props: SubflowDesignerStoreProps) {
    super(DESIGNER_TYPE.Subflow, !props.readonly, props)
    this.manifest$ = props.manifest$
    this.display$ = props.display$
    this.pseudoNodes = props.pseudoNodes
    this.flowNode = props.flowNode

    Object.assign(this.$$, {
      viewMode: this.dispose.add(props.viewMode),
      nodeViewport: this.dispose.add(val()),
    } satisfies Partial<SubflowDesignerStore$$>)

    const rfNodes = this.dispose.add(this.deriveRFNodes(this.$.rfNodes, this.$$.viewMode, props))
    const rfEdges = this.dispose.add(this.deriveRFEdges(this.$.rfEdges, this.$$.viewMode))

    Object.assign(this.$, {
      viewMode: this.$$.viewMode,
      rfNodes,
      rfEdges,
      nodeMiniMapPhase: this.dispose.add(this.deriveNodeMiniMapPhase(this.$.nodeMiniMapPhase, this.$$.viewMode)),
      forwardPreviewOptions: this.dispose.add(this.deriveForwardPreviewOptions(this.$.nodes, props.display$)),
    } satisfies Partial<SubflowDesignerStore$>)

    this.dispose.add(
      this.$.viewMode.reaction(() => {
        this.$$.initialized.set(false)
        this.$$.nodeViewport.set(void 0)
      }, true),
    )
  }

  /**
   * @internal
   */
  public override handleNodesChange: OnNodesChange<RFNode> = async (changes): Promise<void> => {
    if (this.$.viewMode.value === SUBFLOW_VIEW_MODE.Flow) {
      const toRemoveNodes = applyNodeChanges(changes, this.$.nodes, this.pseudoNodes, this.$.commentNodes, this.$$.editable)
      this.doRemoveNodes(toRemoveNodes)
    } else {
      applyNodeChanges(changes, this.flowNode, undefined, undefined, this.$$.editable)
    }
  }

  private deriveRFNodes(rfNodes: ReadonlyVal<RFNode[]>, viewMode$: ReadonlyVal<SubflowViewMode>, props: SubflowDesignerStoreProps): ReadonlyVal<RFNode[]> {
    return compute((get) => {
      if (get(viewMode$) === SUBFLOW_VIEW_MODE.Flow) {
        const inputRFNode = get(props.pseudoNodes).get(INPUT_NODE_ID)?.$.rfNode
        const outputRFNode = get(props.pseudoNodes).get(OUTPUT_NODE_ID)?.$.rfNode
        return coalesce([get(inputRFNode), ...get(rfNodes), get(outputRFNode)])
      }
      return [get(props.flowNode.$.rfNode)]
    })
  }

  private deriveRFEdges<TEdge extends Edge>(rfEdges: ReadonlyVal<TEdge[]>, viewMode$: ReadonlyVal<SubflowViewMode>): ReadonlyVal<TEdge[]> {
    return compute((get) => (get(viewMode$) === SUBFLOW_VIEW_MODE.Flow ? get(rfEdges) : []))
  }

  private deriveNodeMiniMapPhase(nodeMiniMapPhase: ReadonlyVal<NodeMiniMapPhase>, viewMode$: ReadonlyVal<SubflowViewMode>): ReadonlyVal<NodeMiniMapPhase> {
    return compute((get) => (get(viewMode$) === SUBFLOW_VIEW_MODE.Flow ? get(nodeMiniMapPhase) : NodeMiniMapPhase.None))
  }

  private deriveForwardPreviewOptions(
    nodes: ReadonlyReactiveMap<NodeId, NodeStore>,
    display$: SubflowDesignerStoreDisplay$,
  ): ReadonlyVal<ForwardPreviewOption[]> {
    return compute((get) => {
      const result: ForwardPreviewOption[] = []
      const visited = get(display$.forward_previews)
      for (const node of get(nodes).values()) {
        if (visited?.includes(node.nodeId)) continue
        if (SubflowNodeStore.is(node) && get(node.display$.subflow) === get(this.flowNode.display$.subflow)) continue
        result.push({
          label: get(node.display$.title) || node.nodeId,
          icon: get(node.display$.icon) || defaultNodeIcon,
          value: node.nodeId,
        })
      }
      return result
    })
  }
}
