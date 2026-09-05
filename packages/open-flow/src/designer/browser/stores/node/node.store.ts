import type { DisposableStore } from '@wopjs/disposable'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { GroupDividerDef, HandleInputFrom, HandleOutputFrom, InputHandleDef, NodeId, OutputHandleDef } from '../../../../schema/index.ts'
import type { Size, XYPosition } from '../../base/compare.ts'
import type { RFNode, RFNodeId } from '../../base/rfHelpers.ts'
import type { ToReadonly$Group } from '../../base/val.ts'
import type { DesignerUIStore } from '../designer/designerUI.store.ts'
import type { EdgeId, EdgeStore } from '../edge/edge.store.ts'
import type { NodeStatus, NodeType } from './constants.ts'
import type { INodeSectionStore } from './nodeSection/interface.ts'
import type { NodeUIPersistedData } from './nodeUI.store.ts'

import { isArray, isDefined } from '@wopjs/cast'
import { disposableStore, dispose } from '@wopjs/disposable'
import { attachSetter, compute, derive, val } from 'value-enhancer'
import { isSameSize } from '../../base/compare.ts'
import { DEFAULT_POSITION, NODE_HANDLE_CLASSNAME } from '../../base/designer.ts'
import { toRFNodeId } from '../../base/rfHelpers.ts'
import { updatePartial } from '../../base/trivial.ts'
import { INPUT_NODE_ID, isManifestNodeType, NODE_TYPE, OUTPUT_NODE_ID } from './constants.ts'
import { NodeUIStore } from './nodeUI.store.ts'

const dragHandle = `.${NODE_HANDLE_CLASSNAME}`

// Input and output pseudo-nodes receive their real positions after every node is constructed.
const UndefinedPosition: XYPosition = { x: -1, y: -1 }

export function isUndefinedPosition(position: XYPosition | undefined): boolean {
  return !position || (position.x === UndefinedPosition.x && position.y === UndefinedPosition.y)
}

/** Editable manifest values used to render a node. */
export interface NodeStoreManifest$ {
  readonly icon: Val<string | undefined>
  readonly title: Val<string | undefined>
  readonly description: Val<string | undefined>
  readonly timeout?: Val<number | undefined>
  readonly progressWeight?: Val<number | undefined>
  // Private shared blocks are hidden from agents and other users.
  readonly private?: Val<boolean | undefined>
}

export interface NodeShowSettings {
  // Node opens the node menu. Input and output disambiguate duplicate Task handles.
  // Value covers handles that cannot collide, including Value and Subflow Node handles.
  readonly scope: 'node' | 'input' | 'output' | 'value' | 'condition'
  /** Node scope has no handle. */
  readonly handle?: string
}

/** Reactive presentation values used to render a node. */
export interface NodeStoreDisplay$ {
  readonly branches?: ReadonlyVal<readonly string[] | undefined>
  readonly executionInput?: ReadonlyVal<boolean>
  readonly icon: ReadonlyVal<string | undefined>
  readonly title: ReadonlyVal<string | undefined>
  readonly description: ReadonlyVal<string | undefined>
  readonly timeout?: ReadonlyVal<number | undefined>
  readonly progressWeight?: ReadonlyVal<number | undefined>
  readonly status: Val<NodeStatus>
  readonly successCount?: Val<number | undefined>
  readonly progress: Val<number | undefined>
  readonly showSettings: Val<NodeShowSettings | undefined>
  readonly ignore: Val<boolean | undefined>
  readonly sections: ReadonlyVal<INodeSectionStore[]>

  readonly inputs_def: ReadonlyVal<(InputHandleDef | GroupDividerDef)[] | undefined>
  readonly outputs_def: ReadonlyVal<(OutputHandleDef | GroupDividerDef)[] | undefined>

  // Task Node inputs can receive connections.
  readonly inputs_from?: ReadonlyVal<readonly HandleInputFrom[] | undefined>
  // SubflowNode outputs can be connected by internal nodes.
  readonly outputs_from?: ReadonlyVal<readonly HandleOutputFrom[] | undefined>
}

export interface NodeStore$$ {
  readonly rfNode: Val<RFNode>
  readonly selected: Val<boolean | undefined>
  readonly position: Val<XYPosition>
  readonly showSettings: Val<boolean>
}

export type NodeStore$ = ToReadonly$Group<NodeStore$$> & {
  readonly hasError: ReadonlyVal<boolean>
  readonly measured: ReadonlyVal<Partial<Size> | undefined>
}

export interface NodeStoreProps<TManifest$ extends NodeStoreManifest$ = NodeStoreManifest$, TDisplay$ extends NodeStoreDisplay$ = NodeStoreDisplay$> {
  /** NodeStore owns these values. Their absence makes the manifest fields read-only. */
  readonly manifest$?: TManifest$
  /** NodeStore owns these values. */
  readonly display$: TDisplay$

  readonly designerUIStore: DesignerUIStore
  readonly changeDescription?: (description: string | undefined) => void
  readonly duplicateNode?: (offset?: XYPosition | undefined) => void
  readonly execute?: (executeWithCache: boolean) => void
  readonly remove?: () => void
}

export class NodeStore<TManifest$ extends NodeStoreManifest$ = NodeStoreManifest$, TDisplay$ extends NodeStoreDisplay$ = NodeStoreDisplay$> {
  public static is(store: unknown): store is NodeStore {
    return store instanceof NodeStore
  }

  public static to(store: unknown): NodeStore | undefined {
    return store instanceof NodeStore ? store : undefined
  }

  public readonly dispose: DisposableStore = disposableStore()

  public readonly manifest$: TManifest$ | undefined
  public readonly display$: TDisplay$
  public readonly designerUIStore: DesignerUIStore
  public readonly changeDescription: ((description: string | undefined) => void) | undefined
  public readonly duplicateNode: ((offset?: XYPosition) => void) | undefined
  public readonly execute: ((executeWithCache: boolean) => void) | undefined
  public readonly remove: (() => void) | undefined

  public readonly nodeType: NodeType
  public readonly nodeId: NodeId

  public readonly rfNodeId: RFNodeId

  public readonly uiStore: NodeUIStore
  /** Runtime-only sections are rendered but never persisted into node UI data. */
  public readonly runtimeSections$: Val<INodeSectionStore[]>

  public readonly $$: NodeStore$$
  public readonly $: NodeStore$

  /**
   * @internal
   * Assigned after the initial node collection is complete.
   */
  public edges?: ReadonlyVal<Record<EdgeId, EdgeStore>>

  public constructor(nodeId: NodeId, nodeType: NodeType, props: NodeStoreProps<TManifest$, TDisplay$>) {
    this.nodeId = nodeId
    this.nodeType = nodeType
    this.rfNodeId = toRFNodeId(nodeId, nodeType)
    this.manifest$ = props.manifest$
    this.runtimeSections$ = this.dispose.add(val<INodeSectionStore[]>([]))
    this.display$ = props.display$
    this.designerUIStore = props.designerUIStore
    this.changeDescription = props.changeDescription
    this.duplicateNode = props.duplicateNode
    this.execute = props.execute
    this.remove = props.remove

    if (this.manifest$) {
      this.dispose.add(Object.values(this.manifest$))
    }
    this.dispose.add(Object.values(this.display$))
    this.dispose.add(() => [...this.display$.sections.value, ...this.runtimeSections$.value].forEach(dispose))

    {
      let uiData: NodeUIPersistedData | undefined
      if (nodeType === NODE_TYPE.ErrorNode) {
        uiData = this.designerUIStore.peekNodeUIData(this.nodeId)
      } else if (isManifestNodeType(nodeType)) {
        uiData = this.designerUIStore.takeNodeUIData(this.nodeId)
      } else if (nodeType === NODE_TYPE.InputNode) {
        uiData = this.designerUIStore.takePseudoNodeUIData(INPUT_NODE_ID) || {
          rfNode: { position: { ...UndefinedPosition } },
        }
      } else if (nodeType === NODE_TYPE.OutputNode) {
        uiData = this.designerUIStore.takePseudoNodeUIData(OUTPUT_NODE_ID) || {
          rfNode: { position: { ...UndefinedPosition } },
        }
      }

      const sections$ = this.dispose.add(compute((get) => [...get(this.display$.sections), ...get(this.runtimeSections$)]))
      this.uiStore = this.dispose.add(new NodeUIStore(sections$, uiData))
      if (isDefined(uiData?.showSettings)) {
        this.display$.showSettings.set(uiData?.showSettings)
      }
    }

    const rfNodeData = Object.freeze({ store: this })
    const ensureRFNode = (rfNode: Partial<RFNode> = {}): RFNode => {
      rfNode.id = this.rfNodeId
      rfNode.type = this.nodeType
      rfNode.position = rfNode.position ?? DEFAULT_POSITION
      rfNode.dragHandle = dragHandle
      rfNode.data = rfNodeData
      return rfNode as RFNode
    }

    const rfNode$ = this.dispose.add(attachSetter(derive(this.uiStore.$.rfNode, ensureRFNode), this.uiStore.$$.rfNode.set))

    const selected$ = this.dispose.add(
      attachSetter(
        derive(rfNode$, (rfNode) => rfNode.selected),
        updatePartial(rfNode$, 'selected'),
      ),
    )

    const measured$ = this.dispose.add(derive(rfNode$, (rfNode) => rfNode.measured, { equal: isSameSize }))

    const hasError$ = this.dispose.add(
      compute((get) => {
        if (get(this.display$.sections).some((section) => get(section.hasError$))) {
          return true
        }
        return false
      }),
    )

    const showSettings$ = this.dispose.add(
      attachSetter(
        derive(this.display$.showSettings, (s) => s?.scope === 'node'),
        (b) => this.display$.showSettings.set(b ? { scope: 'node' } : undefined),
      ),
    )

    this.$$ = {
      rfNode: rfNode$,
      selected: selected$,
      position: this.uiStore.position$,
      showSettings: showSettings$,
    }

    this.$ = {
      ...this.$$,
      measured: measured$,
      hasError: hasError$,
    }
  }

  /**
   * @internal
   */
  public findSection<T extends INodeSectionStore>(types: string | string[]): T | undefined {
    if (isArray(types)) {
      return this.display$.sections.value.find((section) => types.includes(section.type)) as T | undefined
    } else {
      return findSection<T>(types)(this.display$.sections.value)
    }
  }

  /** @internal */
  public setRuntimeSections(sections: INodeSectionStore[]): void {
    const retained = new Set(sections)
    const removed = this.runtimeSections$.value.filter((section) => !retained.has(section))
    this.runtimeSections$.set(sections)
    removed.forEach(dispose)
  }
}

function findSection<T extends INodeSectionStore>(type: string): (sections: INodeSectionStore[]) => T | undefined {
  return (sections) => sections.find((section) => section.type === type) as T | undefined
}
