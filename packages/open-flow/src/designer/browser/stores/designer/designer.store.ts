import type { DisposableStore } from '@wopjs/disposable'
import type { AddEventListener } from '@wopjs/event'
import type { Connection as _RFConnection, OnBeforeDelete, OnEdgesChange, OnNodesChange, Viewport, XYPosition } from '@xyflow/react'
import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { ReactiveMap, ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { LocaleTextStore } from '../../../../localization/common/localization.ts'
import type { HandleName, NodeId } from '../../../../schema/index.ts'
import type { FlowDisplayMode } from '../../../common/flowDisplay.ts'
import type { AddNodeType } from '../../base/dragNDrop.ts'
import type { PartialConnection, RFConnection, RFEdge, RFNode, RFNodeId } from '../../base/rfHelpers.ts'
import type { ToReadonly$Group } from '../../base/val.ts'
import type { TranslateKeyEvent, UserLocalesContext } from '../../components/userLocales.tsx'
import type { EdgeStore } from '../edge/edge.store.ts'
import type { RenderedRFEdge } from '../edge/overviewEdges.ts'
import type { ManifestConnection } from '../edge/typings.ts'
import type { HandleIndex } from '../node/constants.ts'
import type { IHandleRowDragNDrop } from '../node/nodeSection/interface.ts'
import type { ConnectorConnectionStore } from './connectorConnection.store.ts'
import type { DesignerUIStore } from './designerUI.store.ts'
import type { RFCommand } from './rfCommand.ts'
import type { DesignerType, FlowRunStatus } from './typings.ts'

import { graphlib, layout } from '@dagrejs/dagre'
import { disposableStore } from '@wopjs/disposable'
import { event } from '@wopjs/event'
import { Position } from '@xyflow/react'
import { cluster, isObject } from 'radash'
import { compute, derive, val } from 'value-enhancer'
import { DESIGNER_CLASSNAME } from '../../base/designer.ts'
import { dispatchEvent, isInside, isMac } from '../../base/dom.ts'
import {
  applyEdgeChanges,
  applyNodeChanges,
  getRFNodeType,
  makeConnection,
  RF_NODE_TYPE,
  toManifestHandleName,
  toManifestNodeId,
} from '../../base/rfHelpers.ts'
import { coalesce, filterMap, Negative } from '../../base/trivial.ts'
import { createI18n } from '../../i18n/index.ts'
import { deriveEdgesFromNodes } from '../edge/edges.ts'
import { deriveOverviewEdges } from '../edge/overviewEdges.ts'
import { CommentNodeStore } from '../node/commentNode.store.ts'
import { ConditionNodeStore } from '../node/conditionNode.store.ts'
import { InputNodeStore } from '../node/inputNode.store.ts'
import { NodeStore } from '../node/node.store.ts'
import { LEFT_FROM_SECTION_TYPES, RIGHT_FROM_SECTION_TYPES, RIGHT_TO_SECTION_TYPES } from '../node/nodeSection/constants.ts'
import { InputSectionStore } from '../node/nodeSection/inputSection.store.ts'
import { OutputSectionStore } from '../node/nodeSection/outputSection.store.ts'
import { OutputNodeStore } from '../node/outputNode.store.ts'
import { SubflowNodeStore } from '../node/subflowNode.store.ts'
import { TaskNodeStore } from '../node/taskNode.store.ts'
import { ValueNodeStore } from '../node/valueNode.store.ts'
import { HandleRowStore } from '../nodeHandle/handleRow.store.ts'
import { getNodeMinimap, NodeMiniMapPhase } from './nodeMiniMap.ts'
import { decodeRFSourceHandle, decodeRFTargetHandle } from './rfConnection.ts'

export type IAddNodeMenuItem =
  | {
      type: AddNodeType
      /**
       * ```js
       * { type: 'scriptlet', data: 'javascript' }
       * { type: 'block', data: 'path/to/task.oo.yaml' }
       * { type: 'value' }
       * ```
       */
      data?: string
      /** Prevents selection while keeping an unavailable or incompatible item visible. */
      disabled?: boolean
      /**
       * `DesignerIcon` format, `:codicon:add:`, `path/to/icon.svg`.
       */
      icon?: string
      /**
       * Will be used for searching.
       */
      label: string
      /**
       * Will be used for searching, not displayed on the UI.
       */
      detail?: string
      /**
       * Will be used for searching, displayed at the right side of the label.
       */
      description?: string
      /**
       * Requires one explicit choice before adding the node.
       */
      choices?: readonly {
        readonly data: string
        readonly description?: string
        readonly handles?: {
          name: HandleName
          json_schema?: unknown
          description?: string
        }[]
        readonly label: string
      }[]
      /**
       * If provided, selected handle will be connected.
       * Otherwise only the node will be created.
       */
      handles?: {
        name: HandleName
        // Help generating the icon at the left side of the name.
        json_schema?: unknown
        // Displayed at the right side of the handle name.
        description?: string
      }[]
    }
  | { type: 'divider'; label: string; detail?: string }

export interface IFromSource {
  readonly nodeId: NodeId
  readonly handle: HandleName
  readonly side: 'left' | 'right'
}

/** @internal */
export interface IAddHandleOptions {
  fromFlow: boolean
  fromNodeId: NodeId
  fromPosition: Position
  fromHandleName: HandleName
  toFlow: boolean
  toNodeId: NodeId
  toSection: string
  // Omitting the index inserts the handle at one end of the section.
  toHandleIndex?: HandleIndex | null
  // Controls which end is used when toHandleIndex is null.
  insertBefore?: boolean
}

export type InteractiveMode = 'mouse' | 'touchpad'

export interface OverviewConnectedNodes {
  readonly inputs: ReadonlySet<RFNodeId>
  readonly outputs: ReadonlySet<RFNodeId>
}

export interface RFGraph {
  readonly nodes: RFNode[]
  readonly edges: RenderedRFEdge[]
}

export interface DesignerStore$$ {
  readonly initialized: Val<boolean>
  readonly editable: Val<boolean>

  readonly viewport: DesignerStoreProps['viewport']
  readonly miniMapExpanded: DesignerStoreProps['miniMapExpanded']
  readonly interactiveMode: Val<InteractiveMode>
  readonly displayMode: Val<FlowDisplayMode>

  /** Nodes persisted in flow.oo.yaml, excluding virtual input and output nodes. */
  readonly nodes: ReactiveMap<NodeId, NodeStore>
  readonly pseudoNodes?: ReactiveMap<NodeId, NodeStore>
  readonly commentNodes?: ReactiveMap<NodeId, CommentNodeStore>

  readonly showSettings: Val<boolean>
  readonly settingsPanelWidth: Val<number | undefined>
}

export interface DesignerStore$ extends ToReadonly$Group<DesignerStore$$> {
  readonly initialized: ReadonlyVal<boolean>
  readonly nodes: ReadonlyReactiveMap<NodeId, NodeStore>
  readonly pseudoNodes?: ReadonlyReactiveMap<NodeId, NodeStore>
  readonly edges: ReadonlyVal<EdgeStore[]>

  /** Selected nodes excluding pseudo nodes and the flow node. */
  readonly selectedNodes: ReadonlyVal<(NodeStore | CommentNodeStore)[]>

  readonly scale: ReadonlyVal<number>

  readonly rfNodes: ReadonlyVal<RFNode[]>
  readonly rfEdges: ReadonlyVal<RFEdge[]>
  readonly renderedRFEdges: ReadonlyVal<RenderedRFEdge[]>
  readonly rfGraph: ReadonlyVal<RFGraph>
  readonly renderedRFGraph: ReadonlyVal<RFGraph>
  readonly overviewConnectedNodes: ReadonlyVal<OverviewConnectedNodes>

  readonly runStatus: ReadonlyVal<FlowRunStatus>

  readonly nodeMiniMapPhase: ReadonlyVal<NodeMiniMapPhase>
  readonly variableInputs: ReadonlyVal<ReadonlyMap<string, { readonly compatible: boolean; readonly name?: string }>>
  readonly variableNames: ReadonlyVal<readonly string[]>
  readonly variableNamesLoaded: ReadonlyVal<boolean>
  readonly variableNamesLoading: ReadonlyVal<boolean>
}

export interface DesignerStoreProps {
  readonly lang$: ReadonlyVal<string>
  readonly userLocales?: LocaleTextStore
  /** Makes every input and output section read-only for previews. */
  readonly readonly?: boolean

  readonly rfCommand: RFCommand
  readonly miniMapExpanded: Val<boolean | undefined>
  readonly interactiveMode: Val<InteractiveMode>
  readonly displayMode?: Val<FlowDisplayMode>
  readonly viewport: Val<Viewport | undefined>
  readonly settingsPanelWidth: Val<number | undefined>
  readonly connectorConnections?: ConnectorConnectionStore
  readonly nodes: ReactiveMap<NodeId, NodeStore>
  readonly runStatus: ReadonlyVal<FlowRunStatus>
  readonly designerUIStore: DesignerUIStore
  readonly focused$?: ReadonlyVal<boolean>
  readonly variableInputs?: ReadonlyVal<ReadonlyMap<string, { readonly compatible: boolean; readonly name?: string }>>
  readonly variableNames?: ReadonlyVal<readonly string[]>
  readonly variableNamesLoaded?: ReadonlyVal<boolean>
  readonly variableNamesLoading?: ReadonlyVal<boolean>

  readonly showConfirmDialog: (message: string) => Promise<boolean>

  readonly bindValidateConnection?: (edgeStore: EdgeStore) => void

  // For flow designer store.
  readonly onAddNode?: (
    type: AddNodeType,
    blockName: string,
    position: XYPosition,
    connection?: (nodeId: NodeId) => RFConnection,
  ) => Promise<NodeId | undefined>
  readonly onDeleteNodes?: (toDeleteNodeStores: Iterable<NodeStore | CommentNodeStore>) => void
  readonly onConnect?: (connection: ManifestConnection) => void
  readonly onChangeInputVariable?: (nodeId: string, handle: string, name: string | undefined) => void
  readonly onOpenVariables?: () => void
  readonly onDisconnect?: (connections: Iterable<ManifestConnection>) => void
  readonly onDuplicate?: (nodeStores: NodeId[], offset?: XYPosition) => Promise<void>
  readonly onPaste?: (position: XYPosition) => void
  readonly provideAddNodeMenuItems?: (fromSource?: IFromSource) => IAddNodeMenuItem[] | undefined
  readonly provideAsyncAddNodeMenuItems?: (
    fromSource: IFromSource | undefined,
    searchTerm: string,
    signal: AbortSignal,
  ) => Promise<IAddNodeMenuItem[] | undefined>

  // Rename node id (in flow designer) or task folder name (in block designer).
  readonly validateNodeId?: (newName: NodeId, oldName: NodeId) => string | undefined
  readonly onRenameNodeId?: (oldName: NodeId, newName: NodeId) => void

  readonly validateDirName?: (newName: string, oldName: string) => string | undefined
  readonly onRenameDirName?: (oldName: string, newName: string) => void

  // For the subflow designer store.
  readonly pseudoNodes?: ReactiveMap<NodeId, NodeStore>
  readonly flowNode?: SubflowNodeStore

  readonly commentNodes?: ReactiveMap<NodeId, CommentNodeStore>
}

export interface FlowDiagnostics {
  readonly handleErrors: Array<{
    node: string
    nodeTitle?: string
    handle: string
    error: unknown
  }>
  readonly edgeErrors: Array<{
    edge: string
    error: unknown
  }>
}

export class DesignerStore {
  public readonly lang$: ReadonlyVal<string>
  public readonly i18n: I18n
  public readonly userLocales?: LocaleTextStore
  public readonly designerType: DesignerType

  public readonly focused$?: ReadonlyVal<boolean>
  public readonly canDeleteNodes: boolean

  public readonly dispose: DisposableStore = disposableStore()
  public readonly onDidChangeTranslateKey: AddEventListener<TranslateKeyEvent>

  public readonly $: DesignerStore$
  public readonly $$: DesignerStore$$

  public readonly pseudoNodes?: ReactiveMap<NodeId, NodeStore>
  public readonly flowNode?: SubflowNodeStore

  public readonly rfCommand: RFCommand
  public readonly designerUIStore: DesignerUIStore
  public readonly connectorConnections: ConnectorConnectionStore | undefined

  public readonly showConfirmDialog: DesignerStoreProps['showConfirmDialog']

  /** @internal */
  public readonly onAddNode: DesignerStoreProps['onAddNode']
  /** @internal */
  public readonly onDeleteNodes: DesignerStoreProps['onDeleteNodes']
  /** @internal */
  public readonly onConnect: DesignerStoreProps['onConnect']
  /** @internal */
  public readonly onChangeInputVariable: DesignerStoreProps['onChangeInputVariable']
  /** @internal */
  public readonly onOpenVariables: DesignerStoreProps['onOpenVariables']
  /** @internal */
  public readonly onDisconnect: DesignerStoreProps['onDisconnect']
  /** @internal */
  public readonly onDuplicate: DesignerStoreProps['onDuplicate']
  /** @internal */
  public readonly onPaste: DesignerStoreProps['onPaste']
  /** @internal */
  public readonly validateRenameNodeId: DesignerStoreProps['validateNodeId']
  /** @internal */
  public readonly onRenameNodeId: DesignerStoreProps['onRenameNodeId']
  /** @internal */
  public readonly validateRenameDirName: DesignerStoreProps['validateDirName']
  /** @internal */
  public readonly onRenameDirName: DesignerStoreProps['onRenameDirName']
  /** @internal */
  public readonly provideAddNodeMenuItems: DesignerStoreProps['provideAddNodeMenuItems']
  /** @internal */
  public readonly provideAsyncAddNodeMenuItems: DesignerStoreProps['provideAsyncAddNodeMenuItems']

  /** @internal */
  public readonly userLocalesContext: UserLocalesContext

  private pendingDisplayModeLayout: FlowDisplayMode | undefined
  private displayModeLayoutMeasurementAttempts = 0
  private activeDisplayMode: FlowDisplayMode

  public constructor(type: DesignerType, editable: boolean, props: DesignerStoreProps) {
    this.rfCommand = this.dispose.add(props.rfCommand)
    this.designerUIStore = this.dispose.add(props.designerUIStore)
    this.connectorConnections = props.connectorConnections

    this.focused$ = props.focused$ && this.dispose.add(props.focused$)
    this.canDeleteNodes = props.onDeleteNodes != null

    this.designerType = type
    this.showConfirmDialog = props.showConfirmDialog

    this.onAddNode = props.onAddNode
    this.onDeleteNodes = props.onDeleteNodes
    this.onConnect = props.onConnect
    this.onChangeInputVariable = props.onChangeInputVariable
    this.onOpenVariables = props.onOpenVariables
    this.onDisconnect = props.onDisconnect
    this.onDuplicate = props.onDuplicate
    this.onPaste = props.onPaste
    this.validateRenameNodeId = props.validateNodeId
    this.onRenameNodeId = props.onRenameNodeId
    this.validateRenameDirName = props.validateDirName
    this.onRenameDirName = props.onRenameDirName
    this.provideAddNodeMenuItems = props.provideAddNodeMenuItems
    this.provideAsyncAddNodeMenuItems = props.provideAsyncAddNodeMenuItems

    this.lang$ = props.lang$
    this.i18n = createI18n(this.lang$.value)
    this.userLocales = props.userLocales
    this.dispose.add(this.lang$.reaction((lang) => this.i18n.switchLang(lang)))

    const { nodes, pseudoNodes, flowNode, commentNodes } = props
    const edges = this.dispose.add(deriveEdgesFromNodes(nodes, pseudoNodes, flowNode, props.bindValidateConnection))
    const rfEdges = this.dispose.add(compute((get) => coalesce(get(edges).map((edge) => get(edge.$.rfEdge)))))
    const selectedNodeIds = this.dispose.add(
      compute((get) => {
        const result = new Set<RFNodeId>()
        for (const node of get(nodes.$).values()) {
          if (get(node.$.selected)) result.add(node.rfNodeId)
        }
        if (pseudoNodes) {
          for (const node of get(pseudoNodes.$).values()) {
            if (get(node.$.selected)) result.add(node.rfNodeId)
          }
        }
        return result
      }),
    )
    const overviewRFEdges = this.dispose.add(deriveOverviewEdges(edges, selectedNodeIds))

    this.$$ = {
      initialized: this.dispose.add(val(false)),
      editable: this.dispose.add(val(editable)),
      miniMapExpanded: this.dispose.add(props.miniMapExpanded),
      viewport: this.dispose.add(props.viewport),
      interactiveMode: this.dispose.add(props.interactiveMode),
      displayMode: this.dispose.add(props.displayMode ?? val<FlowDisplayMode>('detail')),
      nodes,
      pseudoNodes,
      commentNodes,
      showSettings: this.dispose.add(val(false)),
      settingsPanelWidth: this.dispose.add(props.settingsPanelWidth),
    }
    this.activeDisplayMode = this.$$.displayMode.value

    const rfNodes = this.dispose.add(compute((get) => [...(get(commentNodes?.$)?.values() ?? []), ...get(nodes.$).values()].map((node) => get(node.$.rfNode))))
    const renderedRFEdges = this.dispose.add(compute((get) => (get(this.$$.displayMode) == 'overview' ? get(overviewRFEdges) : get(rfEdges))))
    const rfGraph = this.dispose.add(compute<RFGraph>((get) => ({ nodes: get(rfNodes), edges: get(rfEdges) })))
    const renderedRFGraph = this.dispose.add(compute<RFGraph>((get) => ({ nodes: get(rfNodes), edges: get(renderedRFEdges) })))

    this.$ = {
      ...this.$$,
      nodes,
      commentNodes,
      edges,
      runStatus: this.dispose.add(props.runStatus),
      scale: this.dispose.add(derive(props.viewport, (viewport) => 1 / (viewport?.zoom || 1))),
      selectedNodes: this.dispose.add(
        compute((get) => {
          const nodeStores: (NodeStore | CommentNodeStore)[] = []
          for (const node of get(nodes.$).values()) {
            if (get(node.$.selected)) {
              nodeStores.push(node)
            }
          }
          if (commentNodes) {
            for (const node of get(commentNodes.$)?.values() ?? []) {
              if (get(node.$.selected)) {
                nodeStores.push(node)
              }
            }
          }
          return nodeStores
        }),
      ),
      rfNodes,
      rfEdges,
      renderedRFEdges,
      rfGraph,
      renderedRFGraph,
      overviewConnectedNodes: this.dispose.add(
        compute((get) => {
          const inputs = new Set<RFNodeId>()
          const outputs = new Set<RFNodeId>()
          for (const edge of get(rfEdges)) {
            inputs.add(edge.target as RFNodeId)
            outputs.add(edge.source as RFNodeId)
          }
          return { inputs, outputs }
        }),
      ),
      nodeMiniMapPhase: this.dispose.add(
        compute((get) =>
          get(this.$$.displayMode) == 'overview' ? NodeMiniMapPhase.None : getNodeMinimap(get(this.$$.nodes.$).size, get(this.$$.viewport)?.zoom || 1),
        ),
      ),
      variableInputs: this.dispose.add(props.variableInputs ?? val(new Map())),
      variableNames: this.dispose.add(props.variableNames ?? val([])),
      variableNamesLoaded: this.dispose.add(props.variableNamesLoaded ?? val(false)),
      variableNamesLoading: this.dispose.add(props.variableNamesLoading ?? val(false)),
    }

    this.onDidChangeTranslateKey = this.dispose.add(event())
    this.userLocalesContext = {
      userLocales: this.userLocales,
      onDidChangeTranslateKey: this.onDidChangeTranslateKey,
    }

    this.dispose.add(
      this.$.displayMode.reaction((mode) => {
        this.applyDisplayMode(mode)
      }),
    )
  }

  public switchDisplayMode(mode: FlowDisplayMode): void {
    this.applyDisplayMode(mode)
    this.$$.displayMode.set(mode)
  }

  private applyDisplayMode(mode: FlowDisplayMode): void {
    if (mode == this.activeDisplayMode) return
    const restored = this.designerUIStore.switchDisplayMode(this.activeDisplayMode, mode)
    this.pendingDisplayModeLayout = restored ? undefined : mode
    this.displayModeLayoutMeasurementAttempts = 0
    this.activeDisplayMode = mode
    if (mode == 'overview') {
      for (const edgeStore of this.$.edges.value) edgeStore.$$.selected.set(undefined)
    }
  }

  /**
   * Initializes a missing display-mode layout after React Flow has measured the
   * target node rendering. Returns "relayout" when the viewport should fit it.
   */
  public completeDisplayModeLayout = (): boolean | 'relayout' => {
    const pending = this.pendingDisplayModeLayout
    const currentMode = this.$.displayMode.value
    if (pending && pending !== currentMode) return true
    if (!pending && this.designerUIStore.isActiveLayoutInitialized()) return true
    const nodes = this.allLayoutNodes()
    if (nodes.length === 0) return true
    for (const node of nodes) {
      const measured = node.$.measured.value
      if (!measured?.width || !measured.height) {
        if (this.displayModeLayoutMeasurementAttempts++ < 5) return false
        this.pendingDisplayModeLayout = undefined
        this.displayModeLayoutMeasurementAttempts = 0
        this.designerUIStore.completeActiveLayout()
        return true
      }
    }
    this.doRelayout()
    this.pendingDisplayModeLayout = undefined
    this.displayModeLayoutMeasurementAttempts = 0
    this.designerUIStore.completeActiveLayout()
    return 'relayout'
  }

  private allLayoutNodes(): NodeStore[] {
    return [...this.$.nodes.values(), ...(this.$.pseudoNodes?.values() ?? [])]
  }

  /** Deletes nodes programmatically, such as from a menu action. */
  public async deleteNodes(nodes: readonly (NodeStore | CommentNodeStore)[], skipConfirm?: boolean): Promise<void> {
    const payload = {
      nodes: nodes.map((e) => e.$.rfNode.value),
      edges: [],
    }
    if (skipConfirm || (await this.onBeforeDelete(payload))) {
      this.handleNodesChange(nodes.map((e) => ({ type: 'remove', id: e.rfNodeId })))
    }
  }

  /**
   * Returning false cancels the deletion.
   * @internal
   */
  public onBeforeDelete: OnBeforeDelete<RFNode, RFEdge> = async (toDelete): Promise<boolean> => {
    if (this.$.editable.value && this.canDeleteNodes) {
      const { nodes } = toDelete
      if (nodes.length > 0) {
        return this.confirmDeleteNodes(nodes.map((e) => e.data.store))
      }
      return true
    } else {
      return false
    }
  }

  /**
   * @internal
   */
  public handleNodesChange: OnNodesChange<RFNode> = async (changes): Promise<void> => {
    const toRemoveNodes = applyNodeChanges(changes, this.$.nodes, this.pseudoNodes, this.$.commentNodes, this.$$.editable)
    if (toRemoveNodes) this.doRemoveNodes(toRemoveNodes)
  }

  /**
   * @internal
   */
  public handleEdgesChange: OnEdgesChange<RFEdge> = (changes): void => {
    const toRemoveEdges = applyEdgeChanges(changes, this.$.rfEdges.value, this.$.editable)
    if (toRemoveEdges?.size) {
      this.onDisconnect?.(toRemoveEdges)
    }
  }

  private async confirmDeleteNodes(nodeStores: Iterable<NodeStore | CommentNodeStore>): Promise<boolean> {
    const nodeTitles: string[] = []
    for (const nodeStore of nodeStores) {
      if (NodeStore.is(nodeStore)) {
        nodeTitles.push(nodeStore.display$.title.value || nodeStore.nodeId)
      } else if (CommentNodeStore.is(nodeStore)) {
        nodeTitles.push(nodeStore.$.title.value || nodeStore.nodeId)
      }
    }
    if (nodeTitles.length > 0) {
      const { t } = this.i18n
      const message = t('nodeActions.deleteConfirm', {
        name: nodeTitles.join(', '),
        shortcut: isMac ? 'Cmd + Shift + Delete' : 'Ctrl + Shift + Delete',
      })
      const result = await this.showConfirmDialog(message)
      // The dialog consumes keyup, so replay it to restore XYFlow's keyboard state.
      // https://github.com/xyflow/xyflow/blob/0f21ec2/packages/react/src/hooks/useKeyPress.ts#L103
      // XYFlow calls target.closest(), so dispatch from document.documentElement.
      dispatchEvent(document.documentElement, KeyboardEvent, 'keyup', {
        key: 'Delete',
      })
      dispatchEvent(document.documentElement, KeyboardEvent, 'keyup', {
        key: 'Backspace',
      })
      return result
    }
    return true
  }

  public onRFConnect = (rfConnection: _RFConnection): void => {
    if (rfConnection.targetHandle === null || rfConnection.sourceHandle === null) {
      console.error(
        `not found source or target handle. ` +
          `source: ${rfConnection.source}:${rfConnection.sourceHandle}, ` +
          `target: ${rfConnection.target}:${rfConnection.targetHandle}`,
      )
      return
    }

    const { source, target, sourceHandle, targetHandle } = rfConnection as RFConnection

    const from = decodeRFSourceHandle(this.$.nodes, this.pseudoNodes, source, sourceHandle)
    if (!from) {
      console.error(`not found source handle ${source}:${sourceHandle}`)
      return
    }

    const to = decodeRFTargetHandle(this.$.nodes, this.pseudoNodes, target, targetHandle)
    if (!to) {
      console.error(`not found target handle ${target}:${targetHandle}`)
      return
    }

    this.onConnect?.({ from, to })
  }

  /**
   * If the document.activeElement is in Designer
   */
  public isDesignerActive(): boolean {
    for (let node = document.activeElement; node; node = node.parentElement) {
      if (node.classList.contains(DESIGNER_CLASSNAME)) {
        return true
      }
    }
    return false
  }

  public prepareDeselectNodesAndEdges(): () => void {
    const toDeselect: { readonly $$: { readonly selected: Val<boolean | undefined> } }[] = []

    for (const node of this.$.nodes.values()) {
      toDeselect.push(node)
    }
    if (this.pseudoNodes)
      for (const node of this.pseudoNodes.values()) {
        toDeselect.push(node)
      }
    if (this.$.commentNodes)
      for (const node of this.$.commentNodes.values()) {
        toDeselect.push(node)
      }
    for (const edge of this.$.edges.value) {
      toDeselect.push(edge)
    }

    return () => {
      toDeselect.forEach((store) => store.$$.selected.set(false))
    }
  }

  public onRelayout = (): void => {
    try {
      this.closeAllSettingsPanel()
      this.doRelayout()
    } catch (e) {
      console.error(e)
    }
  }

  // https://reactflow.dev/learn/layouting/layouting#dagre
  private doRelayout() {
    const g = new graphlib.Graph().setDefaultEdgeLabel(() => ({}))
    g.setGraph({ rankdir: 'LR' })

    const singles = new Set<string>()
    for (const rfNode of this.$.rfNodes.value) {
      // Comment nodes do not participate in layout.
      if (getRFNodeType(rfNode.id as RFNodeId) === RF_NODE_TYPE.CommentNode) continue
      singles.add(rfNode.id)
      g.setNode(rfNode.id, {
        ...rfNode,
        width: rfNode.measured?.width ?? 0,
        height: rfNode.measured?.height ?? 0,
      })
    }

    for (const rfEdge of this.$.rfEdges.value) {
      singles.delete(rfEdge.source)
      singles.delete(rfEdge.target)
      g.setEdge(rfEdge.source, rfEdge.target)
    }

    // Chain isolated nodes in small groups to avoid an excessively tall layout.
    if (singles.size > 0) {
      for (const list of cluster([...singles], 10)) {
        for (let i = 0; i < list.length - 1; i++) {
          g.setEdge(list[i], list[i + 1])
        }
      }
    }

    layout(g)

    const updateNodePosition = (node: NodeStore): void => {
      const { id, measured } = node.$.rfNode.value
      const { x, y } = g.node(id)
      node.$$.position.set({
        x: x - (measured?.width ?? 0) / 2,
        y: y - (measured?.height ?? 0) / 2,
      })
    }

    this.$.nodes.forEach(updateNodePosition)
    this.$.pseudoNodes?.forEach(updateNodePosition)
  }

  public duplicateNodes = async (manifestNodeIds?: NodeId[], offset?: XYPosition): Promise<void> => {
    if (!this.onDuplicate) return
    const toDuplicateNodes = manifestNodeIds ?? filterMap(this.$.selectedNodes.value, (node) => (CommentNodeStore.is(node) ? Negative : node.nodeId))
    const deselect = this.prepareDeselectNodesAndEdges()
    await this.onDuplicate(toDuplicateNodes, offset)
    setTimeout(deselect, 0)
  }

  /**
   * @internal
   */
  public setupForceDelete = (): (() => void) => {
    const NODE_CLASS = '.react-flow__node, .react-flow__nodesselection-rect'
    // Command + Shift
    const onKeyDown = (ev: KeyboardEvent) => {
      if (
        (isMac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey) &&
        !ev.altKey &&
        ev.shiftKey &&
        (ev.key === 'Backspace' || ev.key === 'Delete') &&
        this.$.selectedNodes.value.length > 0 &&
        isInside(ev.target, NODE_CLASS) &&
        !isInside(ev.target, '.nokey')
      ) {
        const activeElement = document.activeElement?.tagName.toLowerCase()
        if (activeElement === 'input' || activeElement === 'textarea') {
          return
        }

        ev.preventDefault()
        this.doRemoveNodes(new Set(this.$.selectedNodes.value))
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }

  protected doRemoveNodes(toRemoveNodes: Set<NodeStore | CommentNodeStore> | undefined): void {
    if (toRemoveNodes?.size) {
      // React Flow also emits edge deletions, so defer node deletion until edge data is updated.
      if (this.onDeleteNodes) setTimeout(() => this.onDeleteNodes?.(toRemoveNodes), 0)
      this.cleanupConnections(toRemoveNodes)
    }
  }

  // Only persisted nodes, not input or output pseudo nodes, can be deleted.
  private cleanupConnections(toRemoveNodes: Set<NodeStore | CommentNodeStore>) {
    let toRemoveConnections: Set<ManifestConnection> | undefined

    for (const edgeStore of this.$.edges.value) {
      const { connection } = edgeStore

      // Delete a connection when its source node is deleted.
      if (connection.from.type === 'from_node') {
        const nodeStore = this.$.nodes.get(connection.from.source.node_id)
        if (nodeStore && toRemoveNodes.has(nodeStore)) {
          ;(toRemoveConnections ??= new Set()).add(connection)
        }
      } else if (connection.from.type === 'from_flow') {
        // The input pseudo node cannot be deleted.
      } else {
        // No other source variants are currently supported.
      }

      // Delete a connection when its target node is deleted.
      if (connection.to.type === 'to_node') {
        const nodeStore = this.$.nodes.get(connection.to.target.node_id)
        if (nodeStore && toRemoveNodes.has(nodeStore)) {
          ;(toRemoveConnections ??= new Set()).add(connection)
        }
      } else if (connection.to.type === 'to_flow') {
        // The output pseudo node cannot be deleted.
      } else {
        // No other target variants are currently supported.
      }
    }

    if (toRemoveConnections?.size) {
      this.onDisconnect?.(toRemoveConnections)
    }
  }

  /**
   * Adds a handle definition by dropping a connection on a target node.
   * @internal
   */
  public onAddHandle = (options: IAddHandleOptions): void => {
    if (!this.$.editable.value) {
      console.warn('onAddHandle: Designer is not editable')
      return
    }

    const fromNode = (options.fromFlow ? this.$.pseudoNodes : this.$.nodes)?.get(options.fromNodeId)
    if (!fromNode) {
      console.warn(`onAddHandle: fromNode ${options.fromNodeId} not found`)
      return
    }

    const toNode = (options.toFlow ? this.$.pseudoNodes : this.$.nodes)?.get(options.toNodeId)
    if (!toNode) {
      console.warn(`onAddHandle: toNode ${options.toNodeId} not found`)
      return
    }

    let fromSection: IHandleRowDragNDrop | undefined
    if (options.fromPosition === Position.Left) {
      fromSection = fromNode.findSection<IHandleRowDragNDrop>(LEFT_FROM_SECTION_TYPES)
    } else if (options.fromPosition === Position.Right) {
      fromSection = fromNode.findSection<IHandleRowDragNDrop>(RIGHT_FROM_SECTION_TYPES)
    }
    if (!fromSection) {
      console.warn(`onAddHandle: fromSection ${options.fromPosition} not found`)
      return
    }

    const row = fromSection.grabHandleRow(options.fromHandleName)
    if (!row) {
      console.warn(`onAddHandle: fromHandleRow ${options.fromHandleName} not found`)
      return
    }

    const toSection = toNode.findSection<IHandleRowDragNDrop>(options.toSection)
    if (!toSection) {
      console.warn(`onAddHandle: toSection ${options.toSection} not found`)
      return
    }

    const newHandleName = toSection.dropHandleRow(options.toHandleIndex, row, options.insertBefore)
    if (!newHandleName) {
      console.warn(`onAddHandle: Failed to create handle ${options.toHandleIndex}`)
      return
    }

    // When dragging left, toNode becomes the connection source.
    const orderIsCorrect = RIGHT_TO_SECTION_TYPES.includes(options.toSection)
    if (orderIsCorrect) {
      this.onConnect?.({
        from: options.fromFlow
          ? { type: 'from_flow', source: { input_handle: options.fromHandleName } }
          : { type: 'from_node', source: { node_id: options.fromNodeId, output_handle: options.fromHandleName } },
        to: options.toFlow
          ? { type: 'to_flow', target: { output_handle: newHandleName } }
          : { type: 'to_node', target: { node_id: options.toNodeId, input_handle: newHandleName } },
      })
    } else {
      this.onConnect?.({
        from: options.toFlow
          ? { type: 'from_flow', source: { input_handle: newHandleName } }
          : { type: 'from_node', source: { node_id: options.toNodeId, output_handle: newHandleName } },
        to: options.fromFlow
          ? { type: 'to_flow', target: { output_handle: options.fromHandleName } }
          : { type: 'to_node', target: { node_id: options.fromNodeId, input_handle: options.fromHandleName } },
      })
    }
  }

  /** Returns UI-visible diagnostics for programmatic inspection. */
  public getDiagnostics(): FlowDiagnostics {
    const handleErrors: {
      node: string
      nodeTitle?: string
      handle: string
      error: unknown
    }[] = []

    const addHandleError = (node: NodeStore, row: HandleRowStore) => {
      handleErrors.push({
        node: node.nodeId,
        nodeTitle: node.display$.title.value,
        handle: row.name,
        error: row.error$.value,
      })
    }

    const { nodes, edges } = this.$
    for (const node of nodes.values()) {
      for (const section of node.display$.sections.value) {
        if (InputSectionStore.is(section) || OutputSectionStore.is(section)) {
          for (const row of section.$.handles.value) {
            if (HandleRowStore.is(row) && row.error$.value) addHandleError(node, row)
          }
        }
      }
    }

    const edgeErrors: {
      edge: string
      error: unknown
    }[] = []

    for (const edge of edges.value) {
      if (edge.$.error.value) {
        edgeErrors.push({
          edge: edge.edgeId,
          error: edge.$.error.value,
        })
      }
    }

    return { handleErrors, edgeErrors }
  }

  /**
   * Marks initialization complete after the settings-panel padding is measured.
   * @internal
   */
  public onInit = (): void => {
    this.$$.initialized.set(true)
  }

  /**
   * Closes every settings panel before fitting the view.
   * @internal
   */
  public onFitView = (): void => {
    this.closeAllSettingsPanel()
  }

  public closeAllSettingsPanel(): void {
    for (const node of this.$.nodes.values()) {
      node.display$.showSettings.set(void 0)
    }
  }

  /**
   * Waits for a node to appear in the reactive node map.
   * @internal
   */
  public waitNode = async <T extends NodeStore = NodeStore>(nodeId: NodeId): Promise<T | undefined> => {
    const existingNode = this.$.nodes.get(nodeId)
    if (existingNode) return existingNode as T
    return new Promise<T | undefined>((resolve) => {
      let settled = false
      let disposeReaction: (() => void) | undefined
      const finish = (node: T | undefined): void => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          disposeReaction?.()
          resolve(node)
        }
      }
      const timer = setTimeout(() => {
        console.error(`node ${nodeId} not found`)
        finish(undefined)
      }, 5000)
      disposeReaction = this.$.nodes.$.reaction((nodeMap) => {
        const node = nodeMap.get(nodeId)
        if (node) {
          finish(node as T)
        }
      })
    })
  }

  private resolveRFNode(rfNodeId: RFNodeId): NodeStore | undefined {
    const nodeId = toManifestNodeId(rfNodeId)
    if (getRFNodeType(rfNodeId) === RF_NODE_TYPE.ManifestNode) {
      return this.$.nodes.get(nodeId)
    } else {
      return this.$.pseudoNodes?.get(nodeId)
    }
  }

  /**
   * Adds a handle and connection after the value node appears.
   * @internal
   */
  public setupValueNode = async (source: NodeId, connection: Pick<RFConnection, 'target' | 'targetHandle'>): Promise<void> => {
    const targetNode = this.resolveRFNode(connection.target)
    const handle = toManifestHandleName(connection.targetHandle)
    if (TaskNodeStore.is(targetNode) || SubflowNodeStore.is(targetNode) || OutputNodeStore.is(targetNode) || ConditionNodeStore.is(targetNode)) {
      const def = targetNode.getInputHandleDef(handle)
      if (def) {
        const sourceNode = await this.waitValueNode(source)
        sourceNode?.setupHandle(def, targetNode.getInputFrom(handle))
        if (OutputNodeStore.is(targetNode)) {
          this.onConnect?.({
            from: { type: 'from_node', source: { node_id: source, output_handle: handle } },
            to: { type: 'to_flow', target: { output_handle: handle } },
          })
        } else {
          this.onConnect?.({
            from: { type: 'from_node', source: { node_id: source, output_handle: handle } },
            to: { type: 'to_node', target: { node_id: toManifestNodeId(connection.target), input_handle: handle } },
          })
        }
      }
    }
  }

  private async waitValueNode(nodeId: NodeId): Promise<ValueNodeStore | null> {
    const alreadyExist = this.$.nodes.get(nodeId)
    if (ValueNodeStore.is(alreadyExist)) {
      return alreadyExist
    }
    return new Promise<ValueNodeStore | null>((resolve) => {
      const timer = setTimeout(() => {
        console.error(`value node ${nodeId} not found`)
        dispose()
        resolve(null)
      }, 5000)
      const dispose = this.$.nodes.$.reaction((nodes) => {
        const node = nodes.get(nodeId)
        if (node) {
          clearTimeout(timer)
          dispose()
          if (ValueNodeStore.is(node)) {
            resolve(node)
          } else {
            console.error(`node ${nodeId} is not a value node`)
            resolve(null)
          }
        }
      })
    })
  }

  /**
   * Updates a scriptlet handle after its task node appears.
   * @internal
   * @param nodeId The newly created scriptlet node ID.
   * @param handle The scriptlet input or output handle.
   */
  public setupScriptletNode = async (nodeId: NodeId, connection: PartialConnection, handle: HandleName): Promise<void> => {
    if (handle && 'source' in connection) {
      // Dragging right from a value or task node determines the scriptlet input type.
      const sourceNode = this.resolveRFNode(connection.source)
      const sourceHandle = toManifestHandleName(connection.sourceHandle)
      if (
        ValueNodeStore.is(sourceNode) ||
        TaskNodeStore.is(sourceNode) ||
        SubflowNodeStore.is(sourceNode) ||
        InputNodeStore.is(sourceNode) ||
        ConditionNodeStore.is(sourceNode)
      ) {
        const def = sourceNode.getOutputHandleDef(sourceHandle)
        if (def) {
          const targetNode = await this.waitInlineTaskNode(nodeId)
          targetNode?.setupInputHandle(handle, def)
        }
      }
    } else if (handle && 'target' in connection) {
      // Dragging left from a task node determines the scriptlet output type.
      const targetNode = this.resolveRFNode(connection.target)
      const targetHandle = toManifestHandleName(connection.targetHandle)
      if (TaskNodeStore.is(targetNode) || SubflowNodeStore.is(targetNode) || OutputNodeStore.is(targetNode) || ConditionNodeStore.is(targetNode)) {
        const def = targetNode.getInputHandleDef(targetHandle)
        if (def) {
          const sourceNode = await this.waitInlineTaskNode(nodeId)
          sourceNode?.setupOutputHandle(handle, def)
        }
      }
    }
    this.onRFConnect(makeConnection(connection, nodeId, handle))
  }

  private async waitInlineTaskNode(nodeId: NodeId): Promise<TaskNodeStore | null> {
    const alreadyExist = this.$.nodes.get(nodeId)
    if (TaskNodeStore.is(alreadyExist)) {
      if (isInlineTaskNode(alreadyExist)) {
        return alreadyExist
      } else {
        console.error(`node ${nodeId} is not an inline task node`)
        return null
      }
    }
    return new Promise<TaskNodeStore | null>((resolve) => {
      const timer = setTimeout(() => {
        console.error(`task node ${nodeId} not found`)
        dispose()
        resolve(null)
      }, 5000)
      const dispose = this.$.nodes.$.reaction((nodes) => {
        const node = nodes.get(nodeId)
        if (node) {
          clearTimeout(timer)
          dispose()
          if (TaskNodeStore.is(node) && isInlineTaskNode(node)) {
            resolve(node)
          } else {
            console.error(`node ${nodeId} is not an inline task node`)
            resolve(null)
          }
        }
      })
    })
  }
}

function isInlineTaskNode(node: TaskNodeStore): boolean {
  return isObject(node.manifest$?.task.value)
}
