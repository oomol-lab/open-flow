import type { Val } from 'value-enhancer'
import type { HandleName, NodeId } from '../../../../schema/index.ts'
import type { FlowDisplayMode } from '../../../common/flowDisplay.ts'
import type { CreateSchemaEditorFn } from '../../services/designerService.ts'
import type { IAddNodeMenuItem, IFromSource, InteractiveMode } from '../../stores/designer/designer.store.ts'
import type { FlowRunStatus } from '../../stores/designer/typings.ts'
import type { NodeStore } from '../../stores/node/node.store.ts'
import type {
  FlowDesignerViewAddItem,
  FlowDesignerViewAddPort,
  FlowDesignerViewEdge,
  FlowDesignerViewModel,
  FlowDesignerViewNode,
  FlowDesignerViewPosition,
  FlowDesignerViewViewport,
  ViewCallbacks,
} from './model.ts'
import type { NodeEntry } from './node.tsx'

import { dispose } from '@wopjs/disposable'
import { isEqual } from 'radash'
import { unstable_batchedUpdates } from 'react-dom'
import { arrayShallowEqual, val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { isSameViewport } from '../../base/compare.ts'
import { toManifestHandleName, toManifestNodeId } from '../../base/rfHelpers.ts'
import { DesignerUIStore } from '../../stores/designer/designerUI.store.ts'
import { FlowDesignerStore } from '../../stores/designer/flowDesigner.store.ts'
import { createRFCommand } from '../../stores/designer/rfCommand.ts'
import { FLOW_RUN_STATUS } from '../../stores/designer/typings.ts'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { connectedOutputs, createCommentNodeEntry, createNodeEntry, updateCommentNodeEntry, updateNodeEntry } from './node.tsx'

export function toViewEdge(source: string, sourceHandle: string, target: string, targetHandle: string): FlowDesignerViewEdge {
  return {
    id: JSON.stringify([source, sourceHandle, target, targetHandle]),
    source,
    sourceHandle,
    target,
    targetHandle,
  }
}

function variableInputs(nodes: readonly FlowDesignerViewNode[]): ReadonlyMap<
  string,
  {
    readonly compatible: boolean
    readonly enabled?: false
    readonly name?: string
  }
> {
  const inputs = new Map<
    string,
    {
      readonly compatible: boolean
      readonly enabled?: false
      readonly name?: string
    }
  >()
  for (const node of nodes) {
    if (node.kind == 'comment') continue
    for (const input of node.inputs) {
      if (!('handle' in input)) continue
      if ((input.variableEnabled !== false && input.variableCompatible) || input.variable != null) {
        inputs.set(`${node.id}\0${input.handle}`, {
          compatible: input.variableCompatible ?? false,
          ...(input.variableEnabled === false ? { enabled: false as const } : {}),
          ...(input.variable == null ? {} : { name: input.variable }),
        })
      }
    }
  }
  return inputs
}

function equalVariableInputs(left: ReturnType<typeof variableInputs>, right: ReturnType<typeof variableInputs>): boolean {
  return left.size == right.size && [...left].every(([key, input]) => isEqual(input, right.get(key)))
}

export class FlowDesignerViewAdapter {
  readonly store: FlowDesignerStore

  #addItems: readonly FlowDesignerViewAddItem[]
  readonly #callbacks: ViewCallbacks
  readonly #createSchemaEditor: CreateSchemaEditorFn
  #disconnectTimer: ReturnType<typeof setTimeout> | undefined
  #disposeTimer: ReturnType<typeof setTimeout> | undefined
  #entries = new Map<string, NodeEntry>()
  #language: Val<string>
  #modelPositions = new Map<string, FlowDesignerViewPosition>()
  #modelViewport: FlowDesignerViewViewport | undefined
  #pendingDisconnects = new Map<string, FlowDesignerViewEdge>()
  #runStatus: Val<FlowRunStatus>
  #selectedNodeIds = new Set<string>()
  #variableInputs: Val<
    ReadonlyMap<
      string,
      {
        readonly compatible: boolean
        readonly enabled?: false
        readonly name?: string
      }
    >
  >
  #variableNames: Val<readonly string[]>
  #variableNamesLoaded: Val<boolean>
  #variableNamesLoading: Val<boolean>

  constructor(
    model: FlowDesignerViewModel,
    editable: boolean,
    language: string,
    addItems: readonly FlowDesignerViewAddItem[],
    callbacks: ViewCallbacks,
    createSchemaEditor: CreateSchemaEditorFn,
  ) {
    this.#addItems = addItems
    this.#callbacks = callbacks
    this.#createSchemaEditor = createSchemaEditor
    this.#language = val(language)
    const nodes = reactiveMap<NodeId, NodeStore>(null, { onDeleted: dispose })
    const commentNodes = reactiveMap<NodeId, CommentNodeStore>(null, {
      onDeleted: dispose,
    })
    const viewport = val<FlowDesignerViewViewport | undefined>(model.viewport, { equal: isSameViewport })
    this.#runStatus = val<FlowRunStatus>(model.runStatus == 'running' ? FLOW_RUN_STATUS.Running : FLOW_RUN_STATUS.Idle)
    this.#variableInputs = val(variableInputs(model.nodes), { equal: equalVariableInputs })
    this.#variableNames = val(model.variableNames ?? [], { equal: arrayShallowEqual })
    this.#variableNamesLoaded = val(model.variableNamesLoaded ?? false)
    this.#variableNamesLoading = val(model.variableNamesLoading ?? false)
    const designerUIStore = new DesignerUIStore({
      commentNodeStores: commentNodes,
      viewport,
      nodeStores: nodes,
    })
    this.store = new FlowDesignerStore({
      readonly: !editable,
      displayMode: val<FlowDisplayMode>('overview'),
      lang$: this.#language,
      rfCommand: createRFCommand(nodes),
      designerUIStore,
      nodes,
      commentNodes,
      viewport: designerUIStore.viewport$,
      miniMapExpanded: val<boolean | undefined>(),
      interactiveMode: val<InteractiveMode>('touchpad'),
      settingsPanelWidth: val<number | undefined>(),
      runStatus: this.#runStatus,
      variableInputs: this.#variableInputs,
      variableNames: this.#variableNames,
      variableNamesLoaded: this.#variableNamesLoaded,
      variableNamesLoading: this.#variableNamesLoading,
      display$: {
        description: val<string | undefined>(),
        icon: val<string | undefined>(),
        title: val<string | undefined>(),
      },
      showConfirmDialog: async () => true,
      onAddNode: async (_type, itemId, position, connection) =>
        (await this.#callbacks.onAddNode(
          itemId,
          position,
          connection == null
            ? undefined
            : (nodeId) => {
                const edge = connection(nodeId as NodeId)
                return {
                  source: toManifestNodeId(edge.source),
                  sourceHandle: toManifestHandleName(edge.sourceHandle),
                  target: toManifestNodeId(edge.target),
                  targetHandle: toManifestHandleName(edge.targetHandle),
                }
              },
        )) as NodeId | undefined,
      onConnect: (connection) => {
        if (connection.from.type != 'from_node' || connection.to.type != 'to_node') return
        this.#callbacks.onConnect({
          source: connection.from.source.node_id,
          sourceHandle: connection.from.source.output_handle,
          target: connection.to.target.node_id,
          targetHandle: connection.to.target.input_handle,
        })
      },
      onChangeInputVariable: (nodeId, handle, name) => this.#callbacks.onChangeInputVariable?.(nodeId, handle, name),
      onOpenVariables: () => this.#callbacks.onOpenVariables?.(),
      onDeleteNodes: (stores) => {
        const nodeIds = [...stores].map((node) => node.nodeId)
        const deleted = new Set<string>(nodeIds)
        for (const [edgeId, edge] of this.#pendingDisconnects) {
          if (deleted.has(edge.source) || deleted.has(edge.target)) this.#pendingDisconnects.delete(edgeId)
        }
        this.#callbacks.onDeleteNodes(nodeIds)
      },
      onDisconnect: (connections) => {
        for (const connection of connections) {
          if (connection.from.type != 'from_node' || connection.to.type != 'to_node') continue
          const edge = toViewEdge(
            connection.from.source.node_id,
            connection.from.source.output_handle,
            connection.to.target.node_id,
            connection.to.target.input_handle,
          )
          this.#pendingDisconnects.set(edge.id, edge)
        }
        if (this.#disconnectTimer == null && this.#pendingDisconnects.size > 0) {
          // Wait for the Designer's deferred node deletion so one action does not persist redundant edge deletions.
          this.#disconnectTimer = setTimeout(() => this.#flushDisconnects(), 0)
        }
      },
      onDuplicate: async (nodeIds, offset) => {
        const positions = Object.fromEntries(
          nodeIds.flatMap((nodeId) => {
            const node = this.store.$.nodes.get(nodeId) ?? this.store.$.commentNodes?.get(nodeId)
            return node == null ? [] : [[nodeId, node.$.position.value] as const]
          }),
        )
        this.#callbacks.onDuplicate(nodeIds, offset, positions)
      },
      onPaste: (position) => this.#callbacks.onPaste(position),
      provideAddNodeMenuItems: (fromSource) => this.#menuItems(fromSource),
      provideAsyncAddNodeMenuItems: async (fromSource, searchTerm, signal) => {
        const items = await this.#callbacks.provideAddItems?.(searchTerm, signal)
        return items == null ? undefined : this.#items(items, fromSource)
      },
    })
    this.store.dispose.add(nodes)
    this.store.dispose.add(commentNodes)
    this.store.dispose.add(this.#language)
    this.#syncModel(model)
    designerUIStore.loadDesignerUIData({ layouts: model.layouts }, 'overview')
    designerUIStore.completeActiveLayout()
  }

  #cancelPendingDisconnects(): void {
    if (this.#disconnectTimer != null) clearTimeout(this.#disconnectTimer)
    this.#disconnectTimer = undefined
    this.#pendingDisconnects.clear()
  }

  mount(): () => void {
    if (this.#disposeTimer != null) clearTimeout(this.#disposeTimer)
    this.#disposeTimer = undefined
    return () => {
      this.#cancelPendingDisconnects()
      this.#disposeTimer = setTimeout(() => {
        this.#disposeTimer = undefined
        this.store.dispose()
      }, 0)
    }
  }

  setCallbacks(callbacks: ViewCallbacks): void {
    Object.assign(this.#callbacks, callbacks)
  }

  focusNode(nodeId: string, duration: number): void {
    this.store.rfCommand.send('focusNode', nodeId as NodeId, { duration })
  }

  #flushDisconnects(): void {
    this.#disconnectTimer = undefined
    const edges = [...this.#pendingDisconnects.values()]
    this.#pendingDisconnects.clear()
    for (const edge of edges) this.#callbacks.onDisconnect(edge)
  }

  reconcile(model: FlowDesignerViewModel, editable: boolean, language: string, addItems: readonly FlowDesignerViewAddItem[]): void {
    this.#addItems = addItems
    const editableChanged = this.store.$.editable.value != editable
    if (editableChanged) this.store.$$.editable.set(editable)
    if (this.#language.value != language) this.#language.set(language)
    this.#syncModel(model)
  }

  setSelection(selectedNodeIds: readonly string[]): void {
    const selected = new Set(selectedNodeIds)
    const selectionChanged = selected.size != this.#selectedNodeIds.size || [...selected].some((nodeId) => !this.#selectedNodeIds.has(nodeId))
    this.#selectedNodeIds = selected
    if (selectionChanged) {
      // Keep React Flow from observing and echoing an intermediate selection while nodes are updated.
      unstable_batchedUpdates(() => {
        for (const [nodeId, entry] of this.#entries) {
          const value = selected.has(nodeId)
          if (entry.store.$.selected.value != value) entry.store.$$.selected.set(value)
        }
      })
    }
  }

  #menuItems(fromSource?: IFromSource): IAddNodeMenuItem[] {
    return this.#items(this.#addItems, fromSource)
  }

  #items(items: readonly FlowDesignerViewAddItem[], fromSource?: IFromSource): IAddNodeMenuItem[] {
    const result: IAddNodeMenuItem[] = []
    let group: string | undefined
    const handles = (inputs: readonly FlowDesignerViewAddPort[], outputs: readonly FlowDesignerViewAddPort[]) =>
      fromSource == null
        ? undefined
        : (fromSource.side == 'left' ? outputs : inputs).map((port) => ({
            description: port.description,
            json_schema: port.jsonSchema,
            name: port.handle as HandleName,
          }))
    for (const item of items) {
      if (item.group != null && group != item.group) {
        group = item.group
        result.push({ type: 'divider', label: group })
      }
      result.push({
        type: item.type,
        data: item.choices?.length ? undefined : item.id,
        detail: item.description,
        disabled: item.disabled,
        icon: item.icon,
        choices: item.choices?.map((choice) => ({
          data: choice.id,
          description: choice.description,
          handles: handles(choice.inputs ?? item.inputs, choice.outputs ?? item.outputs),
          label: choice.label,
        })),
        handles: handles(item.inputs, item.outputs),
        label: item.label,
      })
    }
    return result
  }

  #syncModel(model: FlowDesignerViewModel): void {
    const runStatus = model.runStatus == 'running' ? FLOW_RUN_STATUS.Running : FLOW_RUN_STATUS.Idle
    if (this.#runStatus.value != runStatus) this.#runStatus.set(runStatus)
    this.#variableInputs.set(variableInputs(model.nodes))
    this.#variableNames.set(model.variableNames ?? [])
    const namesLoaded = model.variableNamesLoaded ?? false
    if (this.#variableNamesLoaded.value != namesLoaded) this.#variableNamesLoaded.set(namesLoaded)
    const namesLoading = model.variableNamesLoading ?? false
    if (this.#variableNamesLoading.value != namesLoading) this.#variableNamesLoading.set(namesLoading)
    if (
      this.#modelViewport == null ||
      this.#modelViewport.x != model.viewport.x ||
      this.#modelViewport.y != model.viewport.y ||
      this.#modelViewport.zoom != model.viewport.zoom
    ) {
      this.store.$$.viewport.set(model.viewport)
      this.#modelViewport = { ...model.viewport }
    }
    const connected = connectedOutputs(model.nodes)
    const nextEntries = new Map<string, NodeEntry>()
    const nextComments = new Map<NodeId, CommentNodeStore>()
    const nextStores = new Map<NodeId, NodeStore>()
    const nextPositions = new Map<string, FlowDesignerViewPosition>()

    for (const node of model.nodes) {
      const outputHandles = [...(connected.get(node.id) ?? [])].toSorted()
      const { position, ...content } = node
      const contentKey = JSON.stringify([content, outputHandles])
      let entry = this.#entries.get(node.id)
      let createdPosition = position
      let created = false
      if (entry?.kind != node.kind) entry = undefined
      if (entry != null && entry.kind != 'comment' && entry.editable != this.store.$.editable.value) {
        const previousPosition = this.#modelPositions.get(node.id)
        if (previousPosition?.x == position.x && previousPosition.y == position.y) createdPosition = entry.store.$.position.value
        entry = undefined
      }
      if (node.kind == 'comment') {
        if (entry?.kind != 'comment') {
          entry = createCommentNodeEntry(node, contentKey, this.store.designerUIStore, this.store, this.#callbacks)
          created = true
        } else {
          if (entry.contentKey != contentKey) entry = updateCommentNodeEntry(entry, node, contentKey)
          const previousPosition = this.#modelPositions.get(node.id)
          if (previousPosition == null || previousPosition.x != position.x || previousPosition.y != position.y) entry.store.$$.position.set(position)
        }
        nextComments.set(node.id as NodeId, entry.store)
      } else if (entry == null) {
        this.store.designerUIStore.setNodeUIData(node.id as NodeId, {
          rfNode: { position: createdPosition },
        })
        entry = createNodeEntry(node, outputHandles, contentKey, this.store.designerUIStore, this.store, this.#callbacks, this.#createSchemaEditor)
        created = true
      } else {
        if (entry.kind == 'comment') throw new Error('Unexpected Comment node entry.')
        if (entry.contentKey != contentKey) entry = updateNodeEntry(entry, node, outputHandles, contentKey)
        const previousPosition = this.#modelPositions.get(node.id)
        if (previousPosition == null || previousPosition.x != position.x || previousPosition.y != position.y) entry.store.$$.position.set(position)
      }
      if (created && this.#selectedNodeIds.has(node.id)) entry.store.$$.selected.set(true)
      nextEntries.set(node.id, entry)
      if (entry.kind != 'comment') nextStores.set(node.id as NodeId, entry.store)
      nextPositions.set(node.id, position)
    }

    if (nextStores.size != this.store.$.nodes.size || [...nextStores].some(([nodeId, store]) => this.store.$.nodes.get(nodeId) !== store)) {
      this.store.$$.nodes.replace(nextStores)
    }
    if (nextComments.size != this.store.$.commentNodes!.size || [...nextComments].some(([nodeId, store]) => this.store.$.commentNodes!.get(nodeId) !== store)) {
      this.store.$$.commentNodes!.replace(nextComments)
    }
    this.#entries = nextEntries
    this.#modelPositions = nextPositions
  }
}
