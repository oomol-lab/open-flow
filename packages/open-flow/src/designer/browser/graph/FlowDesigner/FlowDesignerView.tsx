import 'virtual:uno.css'
import '../../styles/root.scss'
import '../../../../ui/browser/styles.css'
import type { IsValidConnection, OnMoveEnd, OnNodeDrag, OnSelectionChangeFunc, Edge as RFEdge, Node as RFNode } from '@xyflow/react'
import type { ReactElement, ReactNode } from 'react'
import type { Val } from 'value-enhancer'
import type {
  ConditionExpression,
  ConditionHandleDef,
  DefaultConditionHandleDef,
  GroupDividerDef,
  HandleInputFrom,
  HandleName,
  InputHandleDef,
  NodeId,
  OutputHandleDef,
  TriggerDescriptor,
  ValueHandleDef,
} from '../../../../schema/index.ts'
import type { FlowDisplayMode } from '../../../common/flowDisplay.ts'
import type { RFHandleName, RFNodeId } from '../../base/rfHelpers.ts'
import type { IAddNodeMenuItem, IFromSource } from '../../stores/designer/designer.store.ts'
import type { InteractiveMode } from '../../stores/designer/designer.store.ts'
import type { DesignerUILayout, DesignerUIStore } from '../../stores/designer/designerUI.store.ts'
import type { FlowRunStatus } from '../../stores/designer/typings.ts'
import type { NodeStatus } from '../../stores/node/constants.ts'
import type { NodeStore } from '../../stores/node/node.store.ts'
import type { InlineTask } from '../../stores/node/taskNode.store.ts'

import { dispose } from '@wopjs/disposable'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { unstable_batchedUpdates } from 'react-dom'
import { derive, val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { toManifestHandleName, toManifestNodeId } from '../../base/rfHelpers.ts'
import { MarkdownPreview } from '../../preview/markdownPreview.tsx'
import { DesignerUIStore as DesignerUIStoreImpl } from '../../stores/designer/designerUI.store.ts'
import { FlowDesignerStore } from '../../stores/designer/flowDesigner.store.ts'
import { createRFCommand } from '../../stores/designer/rfCommand.ts'
import { FLOW_RUN_STATUS } from '../../stores/designer/typings.ts'
import { CommentNodeStore } from '../../stores/node/commentNode.store.ts'
import { ConditionNodeStore } from '../../stores/node/conditionNode.store.ts'
import { isHandleDef, NODE_STATUS } from '../../stores/node/constants.ts'
import { ConditionsSectionStore } from '../../stores/node/nodeSection/conditionsSection.store.ts'
import { InputSectionStore } from '../../stores/node/nodeSection/inputSection.store.ts'
import { OutputSectionStore } from '../../stores/node/nodeSection/outputSection.store.ts'
import { ValueSectionStore } from '../../stores/node/nodeSection/valueSection.store.ts'
import { SubflowNodeStore } from '../../stores/node/subflowNode.store.ts'
import { TaskNodeStore } from '../../stores/node/taskNode.store.ts'
import { TriggerNodeStore } from '../../stores/node/triggerNode.store.ts'
import { ValueNodeStore } from '../../stores/node/valueNode.store.ts'
import { FlowDesigner } from './FlowDesigner.tsx'

export interface FlowDesignerViewSource {
  readonly nodeId: string
  readonly output: string
}

export interface FlowDesignerViewInput {
  readonly defaultValue?: unknown
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable?: boolean
  readonly sources?: readonly FlowDesignerViewSource[]
  readonly value?: unknown
  readonly variable?: string
  readonly variableCompatible?: boolean
  readonly variableEnabled?: boolean
}

export interface FlowDesignerViewOutput {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable?: boolean
}

export interface FlowDesignerViewValue extends FlowDesignerViewOutput {
  readonly value?: unknown
}

export type FlowDesignerViewConditionOperator =
  | '!='
  | '<'
  | '<='
  | '=='
  | '>'
  | '>='
  | 'contains'
  | 'ends with'
  | 'has key'
  | 'has value'
  | 'is empty'
  | 'is false'
  | 'is not empty'
  | 'is not null'
  | 'is null'
  | 'is true'
  | 'not contains'
  | 'not has key'
  | 'not has value'
  | 'starts with'

export interface FlowDesignerViewConditionCase {
  readonly expressions: readonly {
    readonly input: string
    readonly operator: FlowDesignerViewConditionOperator
    readonly value?: unknown
  }[]
  readonly output: string
  readonly relation: 'all' | 'any'
}

export interface FlowDesignerViewConditionChange {
  readonly cases: readonly FlowDesignerViewConditionCase[]
  readonly defaultOutput?: string
  readonly input: FlowDesignerViewInput
}

export interface FlowDesignerViewNodeRun {
  readonly progress?: number
  readonly status: 'error' | 'idle' | 'running' | 'success' | 'waiting'
  readonly successCount?: number
}

export interface FlowDesignerViewPosition {
  readonly x: number
  readonly y: number
}

export interface FlowDesignerViewViewport extends FlowDesignerViewPosition {
  readonly zoom: number
}

interface FlowDesignerViewNodeBase {
  readonly concurrency?: number
  readonly description?: string
  readonly diagnostics?: number
  readonly icon?: string
  readonly id: string
  readonly inputs: readonly (FlowDesignerViewInput | GroupDividerDef)[]
  readonly outputs: readonly (FlowDesignerViewOutput | GroupDividerDef)[]
  readonly position: FlowDesignerViewPosition
  readonly rawIcon?: string
  readonly rawTitle?: string
  readonly run?: FlowDesignerViewNodeRun
  readonly timeoutSeconds?: number
  readonly title: string
}

export interface FlowDesignerViewTaskNode extends FlowDesignerViewNodeBase {
  readonly editablePorts?: boolean
  readonly executorName?: string
  readonly kind: 'task'
  readonly reference: string
}

export interface FlowDesignerViewSubflowNode extends FlowDesignerViewNodeBase {
  readonly kind: 'subflow'
  readonly reference: string
}

export interface FlowDesignerViewConditionNode extends FlowDesignerViewNodeBase {
  readonly cases: readonly FlowDesignerViewConditionCase[]
  readonly defaultOutput?: string
  readonly kind: 'condition'
}

export interface FlowDesignerViewValueNode extends FlowDesignerViewNodeBase {
  readonly kind: 'value'
  readonly values: readonly FlowDesignerViewValue[]
}

export type FlowDesignerViewTriggerSchedule =
  | { readonly expression: string; readonly timezone: string; readonly type: 'cron' }
  | { readonly type: 'every'; readonly unit: 'day' | 'hour' | 'minute' | 'month' | 'week'; readonly value: number }

interface FlowDesignerViewTriggerFieldBase {
  readonly description?: string
  readonly label: string
  readonly name: string
  readonly required: boolean
  readonly source: string
}

export type FlowDesignerViewTriggerField =
  | (FlowDesignerViewTriggerFieldBase & { readonly kind: 'boolean' | 'integer' | 'number' | 'string' })
  | (FlowDesignerViewTriggerFieldBase & { readonly kind: 'json' })
  | (FlowDesignerViewTriggerFieldBase & {
      readonly kind: 'multi-select'
      readonly options: readonly { readonly label: string; readonly source: string; readonly value: unknown }[]
      readonly selected: readonly string[]
    })
  | (FlowDesignerViewTriggerFieldBase & {
      readonly kind: 'select'
      readonly options: readonly { readonly label: string; readonly source: string; readonly value: unknown }[]
    })

export interface FlowDesignerViewTriggerPresentation {
  readonly config?: readonly FlowDesignerViewTriggerField[]
  readonly kind: 'cron' | 'integration' | 'poll' | 'webhook'
  readonly schedules: readonly FlowDesignerViewTriggerSchedule[]
  readonly source?: string
  readonly webhook?: {
    readonly inputs: readonly FlowDesignerViewWebhookInput[]
    readonly options: FlowDesignerViewWebhookOptions
  }
}

export interface FlowDesignerViewWebhookInput {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable: boolean
  readonly value?: unknown
}

export interface FlowDesignerViewWebhookOptions {
  readonly allowedMethods?: readonly string[]
  readonly allowedOrigins?: readonly string[]
  readonly noResponseBody?: boolean
  readonly responseData?: string
  readonly responseHeaders?: Readonly<Record<string, string>>
  readonly responseStatusCode?: number
}

export interface FlowDesignerViewWebhook {
  readonly inputs: readonly FlowDesignerViewWebhookInput[]
  readonly options: FlowDesignerViewWebhookOptions
}

export interface FlowDesignerViewTriggerNode extends FlowDesignerViewNodeBase {
  readonly kind: 'trigger'
  readonly presentation?: FlowDesignerViewTriggerPresentation
}

export interface FlowDesignerViewCommentNode {
  readonly content: string
  readonly id: string
  readonly kind: 'comment'
  readonly position: FlowDesignerViewPosition
  readonly title: string
}

export type FlowDesignerViewNode =
  | FlowDesignerViewCommentNode
  | FlowDesignerViewConditionNode
  | FlowDesignerViewSubflowNode
  | FlowDesignerViewTaskNode
  | FlowDesignerViewTriggerNode
  | FlowDesignerViewValueNode

type FlowDesignerViewSemanticNode = Exclude<FlowDesignerViewNode, FlowDesignerViewCommentNode>

export interface FlowDesignerViewModel {
  readonly layouts?: Partial<Record<FlowDisplayMode, DesignerUILayout>>
  readonly nodes: readonly FlowDesignerViewNode[]
  readonly runStatus?: 'idle' | 'running'
  readonly viewport: FlowDesignerViewViewport
  readonly variableNames?: readonly string[]
  readonly variableNamesLoaded?: boolean
  readonly variableNamesLoading?: boolean
}

export interface FlowDesignerViewAddItem {
  readonly choices?: readonly {
    readonly description?: string
    readonly id: string
    readonly inputs?: readonly FlowDesignerViewAddPort[]
    readonly label: string
    readonly outputs?: readonly FlowDesignerViewAddPort[]
  }[]
  readonly description?: string
  readonly disabled?: boolean
  readonly group?: string
  readonly icon?: string
  readonly id: string
  readonly inputs: readonly FlowDesignerViewAddPort[]
  readonly label: string
  readonly outputs: readonly FlowDesignerViewAddPort[]
  readonly type: 'block' | 'comment' | 'condition' | 'connector' | 'llm' | 'scriptlet' | 'trigger' | 'value'
}

export interface FlowDesignerViewAddPort {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
}

export interface FlowDesignerViewEdge {
  readonly id: string
  readonly source: string
  readonly sourceHandle: string
  readonly target: string
  readonly targetHandle: string
}

export interface FlowDesignerViewProps {
  readonly addNodeRequest?: { readonly position: FlowDesignerViewPosition }
  readonly addItems: readonly FlowDesignerViewAddItem[]
  readonly className?: string
  readonly dark?: boolean
  readonly editable: boolean
  readonly focusNodeRequest?: { readonly nodeId: string; readonly requestId: number }
  readonly identity: string
  readonly isValidConnection?: (edge: Omit<FlowDesignerViewEdge, 'id'>) => boolean
  readonly language?: string
  readonly model: FlowDesignerViewModel
  readonly onAddNode: (
    itemId: string,
    position: FlowDesignerViewPosition,
    connection?: (nodeId: string) => Omit<FlowDesignerViewEdge, 'id'>,
  ) => Promise<string | undefined> | string | undefined
  readonly onConnect: (edge: Omit<FlowDesignerViewEdge, 'id'>) => void
  readonly onChangeComment?: (nodeId: string, value: { readonly content: string; readonly title: string }) => void
  readonly onChangeCondition?: (nodeId: string, value: FlowDesignerViewConditionChange) => void
  readonly onChangeNodeDescription?: (nodeId: string, description: string | undefined) => void
  readonly onChangeNodeIcon?: (nodeId: string, icon: string | undefined) => void
  readonly onChangeNodeTitle?: (nodeId: string, title: string | undefined) => void
  readonly onChangeInput?: (nodeId: string, handle: string, value: unknown) => void
  readonly onChangeInputVariable?: (nodeId: string, handle: string, name: string | undefined) => void
  readonly onChangeTaskPorts?: (
    nodeId: string,
    inputs: readonly (FlowDesignerViewInput | GroupDividerDef)[],
    outputs: readonly (FlowDesignerViewOutput | GroupDividerDef)[],
  ) => void
  readonly onChangeTriggerConfig?: (triggerId: string, name: string, value: unknown | undefined) => void
  readonly onChangeTriggerSchedule?: (triggerId: string, schedule: readonly FlowDesignerViewTriggerSchedule[]) => void
  readonly onChangeWebhook?: (triggerId: string, webhook: FlowDesignerViewWebhook) => void
  readonly onChangeValue?: (nodeId: string, values: readonly FlowDesignerViewValue[]) => void
  readonly onDeleteNodes: (nodeIds: readonly string[]) => void
  readonly onDisconnect: (edge: FlowDesignerViewEdge) => void
  readonly onDuplicate: (nodeIds: readonly string[], offset?: FlowDesignerViewPosition, positions?: Readonly<Record<string, FlowDesignerViewPosition>>) => void
  readonly onMoveNodes: (positions: Readonly<Record<string, FlowDesignerViewPosition>>, displayMode: FlowDisplayMode) => void
  readonly onMoveViewport: (viewport: FlowDesignerViewViewport, displayMode: FlowDisplayMode) => void
  readonly onPaste: (position: FlowDesignerViewPosition) => void
  readonly onSelectionChange: (nodeIds: readonly string[], edge: FlowDesignerViewEdge | undefined) => void
  readonly provideAddItems?: (searchTerm: string, signal: AbortSignal) => Promise<readonly FlowDesignerViewAddItem[] | undefined>
  readonly onOpenVariables?: () => void
  readonly selectedNodeIds: readonly string[]
}

interface NodeValues {
  conditionCases?: Val<ConditionHandleDef[]>
  defaultCondition?: Val<DefaultConditionHandleDef | undefined>
  readonly concurrency: Val<number | undefined>
  readonly description: Val<string | undefined>
  readonly diagnostics: Val<boolean>
  readonly executorName: Val<string | undefined>
  readonly icon: Val<string | undefined>
  readonly inputDefs: Val<(InputHandleDef | GroupDividerDef)[]>
  readonly inputsFrom: Val<readonly HandleInputFrom[] | undefined>
  readonly outputDefs: Val<(OutputHandleDef | GroupDividerDef)[]>
  readonly outputsTo: Val<HandleName[]>
  readonly progress: Val<number | undefined>
  readonly rawIcon: Val<string | undefined>
  readonly rawTitle: Val<string | undefined>
  readonly reference: Val<string | undefined>
  readonly status: Val<NodeStatus>
  readonly successCount: Val<number | undefined>
  readonly timeout: Val<number | undefined>
  readonly title: Val<string>
  syncingCondition?: boolean
  syncingPorts?: boolean
  triggerPresentation?: Val<FlowDesignerViewTriggerPresentation | undefined>
  syncingInput?: boolean
  syncingMetadata?: boolean
  syncingValue?: boolean
  valueDefs?: Val<ValueHandleDef[] | undefined>
}

interface SemanticNodeEntry {
  readonly contentKey: string
  readonly editable: boolean
  readonly kind: Exclude<FlowDesignerViewNode['kind'], 'comment'>
  readonly store: NodeStore
  readonly values: NodeValues
}

interface CommentNodeEntry {
  readonly contentKey: string
  readonly kind: 'comment'
  readonly store: CommentNodeStore
  syncing: boolean
}

type NodeEntry = CommentNodeEntry | SemanticNodeEntry

interface ViewCallbacks {
  readonly onAddNode: FlowDesignerViewProps['onAddNode']
  readonly onConnect: FlowDesignerViewProps['onConnect']
  readonly onChangeComment: FlowDesignerViewProps['onChangeComment']
  readonly onChangeCondition: FlowDesignerViewProps['onChangeCondition']
  readonly onChangeNodeDescription: FlowDesignerViewProps['onChangeNodeDescription']
  readonly onChangeNodeIcon: FlowDesignerViewProps['onChangeNodeIcon']
  readonly onChangeNodeTitle: FlowDesignerViewProps['onChangeNodeTitle']
  readonly onChangeInput: FlowDesignerViewProps['onChangeInput']
  readonly onChangeInputVariable: FlowDesignerViewProps['onChangeInputVariable']
  readonly onChangeTaskPorts: FlowDesignerViewProps['onChangeTaskPorts']
  readonly onChangeTriggerConfig: FlowDesignerViewProps['onChangeTriggerConfig']
  readonly onChangeTriggerSchedule: FlowDesignerViewProps['onChangeTriggerSchedule']
  readonly onChangeWebhook: FlowDesignerViewProps['onChangeWebhook']
  readonly onChangeValue: FlowDesignerViewProps['onChangeValue']
  readonly onDeleteNodes: FlowDesignerViewProps['onDeleteNodes']
  readonly onDisconnect: FlowDesignerViewProps['onDisconnect']
  readonly onDuplicate: FlowDesignerViewProps['onDuplicate']
  readonly onPaste: FlowDesignerViewProps['onPaste']
  readonly provideAddItems: FlowDesignerViewProps['provideAddItems']
  readonly onOpenVariables: FlowDesignerViewProps['onOpenVariables']
}

function variableInputs(
  nodes: readonly FlowDesignerViewNode[],
): ReadonlyMap<string, { readonly compatible: boolean; readonly enabled?: false; readonly name?: string }> {
  const inputs = new Map<string, { readonly compatible: boolean; readonly enabled?: false; readonly name?: string }>()
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

class FlowDesignerViewAdapter {
  readonly store: FlowDesignerStore

  #addItems: readonly FlowDesignerViewAddItem[]
  readonly #callbacks: ViewCallbacks
  #disconnectTimer: ReturnType<typeof setTimeout> | undefined
  #disposeTimer: ReturnType<typeof setTimeout> | undefined
  #entries = new Map<string, NodeEntry>()
  #language: Val<string>
  #modelPositions = new Map<string, FlowDesignerViewPosition>()
  #modelViewport: FlowDesignerViewViewport | undefined
  #pendingDisconnects = new Map<string, FlowDesignerViewEdge>()
  #runStatus: Val<FlowRunStatus>
  #selectedNodeIds = new Set<string>()
  #variableInputs: Val<ReadonlyMap<string, { readonly compatible: boolean; readonly enabled?: false; readonly name?: string }>>
  #variableNames: Val<readonly string[]>
  #variableNamesLoaded: Val<boolean>
  #variableNamesLoading: Val<boolean>

  constructor(model: FlowDesignerViewModel, editable: boolean, language: string, addItems: readonly FlowDesignerViewAddItem[], callbacks: ViewCallbacks) {
    this.#addItems = addItems
    this.#callbacks = callbacks
    this.#language = val(language)

    const nodes = reactiveMap<NodeId, NodeStore>(null, { onDeleted: dispose })
    const commentNodes = reactiveMap<NodeId, CommentNodeStore>(null, { onDeleted: dispose })
    const viewport = val<FlowDesignerViewViewport | undefined>(model.viewport)
    this.#runStatus = val<FlowRunStatus>(model.runStatus == 'running' ? FLOW_RUN_STATUS.Running : FLOW_RUN_STATUS.Idle)
    this.#variableInputs = val(variableInputs(model.nodes))
    this.#variableNames = val(model.variableNames ?? [])
    this.#variableNamesLoaded = val(model.variableNamesLoaded ?? false)
    this.#variableNamesLoading = val(model.variableNamesLoading ?? false)
    const designerUIStore = new DesignerUIStoreImpl({ commentNodeStores: commentNodes, viewport, nodeStores: nodes })
    this.store = new FlowDesignerStore({
      readonly: !editable,
      displayMode: val<FlowDisplayMode>('detail'),
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
    designerUIStore.loadDesignerUIData({ layouts: model.layouts }, 'detail')
    this.store.switchDisplayMode('overview')
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
    const inputs = variableInputs(model.nodes)
    const currentInputs = this.#variableInputs.value
    if (
      inputs.size != currentInputs.size ||
      [...inputs].some(([key, input]) => {
        const current = currentInputs.get(key)
        return current == null || current.compatible != input.compatible || current.enabled != input.enabled || current.name != input.name
      })
    ) {
      this.#variableInputs.set(inputs)
    }
    const names = model.variableNames ?? []
    const currentNames = this.#variableNames.value
    if (names.length != currentNames.length || names.some((name, index) => name != currentNames[index])) this.#variableNames.set(names)
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
      let created = false
      if (entry?.kind != node.kind) entry = undefined
      if (entry?.kind != 'comment' && entry?.editable != this.store.$.editable.value) entry = undefined
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
        this.store.designerUIStore.setNodeUIData(node.id as NodeId, { rfNode: { position } })
        entry = createNodeEntry(node, outputHandles, contentKey, this.store.designerUIStore, this.store, this.#callbacks)
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

function connectedOutputs(nodes: readonly FlowDesignerViewNode[]): ReadonlyMap<string, ReadonlySet<HandleName>> {
  const result = new Map<string, Set<HandleName>>()
  for (const node of nodes) {
    if (node.kind == 'comment') continue
    for (const input of node.inputs) {
      if (!('handle' in input)) continue
      for (const source of input.sources ?? []) {
        const handles = result.get(source.nodeId) ?? new Set<HandleName>()
        handles.add(source.output as HandleName)
        result.set(source.nodeId, handles)
      }
    }
  }
  return result
}

function inputDefs(node: FlowDesignerViewNode): (InputHandleDef | GroupDividerDef)[] {
  if (node.kind == 'comment') return []
  return node.inputs.map((input) =>
    'group' in input
      ? input
      : {
          handle: input.handle as HandleName,
          description: input.description,
          json_schema: input.jsonSchema,
          nullable: input.nullable,
          value: input.defaultValue,
        },
  )
}

function inputsFrom(node: FlowDesignerViewNode): HandleInputFrom[] {
  if (node.kind == 'comment') return []
  return node.inputs.flatMap((input) => {
    if (!('handle' in input)) return []
    const fromNode = input.sources?.map((source) => ({ node_id: source.nodeId as NodeId, output_handle: source.output as HandleName }))
    if (input.value === undefined && fromNode?.length == null) return []
    return [
      {
        handle: input.handle as HandleName,
        ...(input.value === undefined ? {} : { value: input.value }),
        ...(fromNode?.length ? { from_node: fromNode } : {}),
      },
    ]
  })
}

function outputDefs(node: FlowDesignerViewNode): (OutputHandleDef | GroupDividerDef)[] {
  if (node.kind == 'comment') return []
  return node.outputs.map((output) =>
    'group' in output
      ? output
      : {
          handle: output.handle as HandleName,
          description: output.description,
          json_schema: output.jsonSchema,
          nullable: output.nullable,
        },
  )
}

function taskInputs(defs: readonly (InputHandleDef | GroupDividerDef)[]): (FlowDesignerViewInput | GroupDividerDef)[] {
  const inputs: (FlowDesignerViewInput | GroupDividerDef)[] = []
  for (const input of defs) {
    if (!isHandleDef(input)) {
      inputs.push(input)
      continue
    }
    inputs.push({
      ...(Object.hasOwn(input, 'value') ? { defaultValue: input.value } : {}),
      description: input.description,
      handle: input.handle,
      jsonSchema: input.json_schema,
      nullable: input.nullable,
    })
  }
  return inputs
}

function taskOutputs(defs: readonly (OutputHandleDef | GroupDividerDef)[]): (FlowDesignerViewOutput | GroupDividerDef)[] {
  const outputs: (FlowDesignerViewOutput | GroupDividerDef)[] = []
  for (const output of defs) {
    if (!isHandleDef(output)) {
      outputs.push(output)
      continue
    }
    outputs.push({
      description: output.description,
      handle: output.handle,
      jsonSchema: output.json_schema,
      nullable: output.nullable,
    })
  }
  return outputs
}

function conditionCases(node: FlowDesignerViewConditionNode): ConditionHandleDef[] {
  return node.cases.map((item) => ({
    handle: item.output as HandleName,
    logical: item.relation == 'all' ? 'AND' : 'OR',
    expressions: item.expressions.map(
      (expression): ConditionExpression => ({
        input_handle: expression.input as HandleName,
        operator: expression.operator,
        value: expression.value,
      }),
    ),
  }))
}

function conditionChange(values: NodeValues): FlowDesignerViewConditionChange {
  const input = values.inputDefs.value.find(isHandleDef)
  if (input == null) throw new Error('Condition input is missing.')
  return {
    cases: values.conditionCases!.value.map((item) => ({
      expressions: (item.expressions ?? []).map((expression) =>
        Object.assign(
          {
            input: expression.input_handle,
            operator: expression.operator as FlowDesignerViewConditionOperator,
          },
          Object.hasOwn(expression, 'value') ? { value: expression.value } : {},
        ),
      ),
      output: item.handle,
      relation: item.logical == 'OR' ? 'any' : 'all',
    })),
    ...(values.defaultCondition!.value == null ? {} : { defaultOutput: values.defaultCondition!.value.handle }),
    input: Object.assign(
      {
        description: input.description,
        handle: input.handle,
        jsonSchema: input.json_schema,
        nullable: input.nullable,
      },
      'value' in input ? { defaultValue: input.value } : {},
    ),
  }
}

function valueDefs(node: FlowDesignerViewValueNode): ValueHandleDef[] {
  return node.values.map((item) => ({
    handle: item.handle as HandleName,
    description: item.description,
    json_schema: item.jsonSchema,
    nullable: item.nullable,
    value: item.value,
  }))
}

function createDiagnosticSection(diagnostics: Val<boolean>) {
  const uiState = val<undefined>()
  return {
    type: 'view-diagnostics',
    hasError$: diagnostics,
    uiState$: uiState,
    dispose: () => {
      diagnostics.dispose()
      uiState.dispose()
    },
  }
}

function createCommentNodeEntry(
  node: FlowDesignerViewCommentNode,
  contentKey: string,
  designerUIStore: DesignerUIStore,
  designerStore: FlowDesignerStore,
  callbacks: ViewCallbacks,
): CommentNodeEntry {
  designerUIStore.setCommentNodeUIData(node.id as NodeId, {
    content: node.content,
    contentWidth: 350,
    rfNode: { position: node.position },
    title: node.title,
  })
  const dark = val(false)
  const preview = val<ReactNode>()
  const store = new CommentNodeStore(node.id as NodeId, {
    lang: val('en'),
    designerUIStore,
    duplicateNode: (offset) => designerStore.onDuplicate?.([node.id as NodeId], offset),
    mountCodeEditor: (container, content$) => {
      const editor = document.createElement('textarea')
      editor.className = 'nodrag nowheel'
      editor.value = content$.value ?? ''
      Object.assign(editor.style, {
        background: 'transparent',
        border: '0',
        boxSizing: 'border-box',
        color: 'inherit',
        font: 'inherit',
        minHeight: '120px',
        outline: 'none',
        padding: '12px',
        resize: 'vertical',
        width: '100%',
      })
      const input = () => content$.set(editor.value)
      const save = () => callbacks.onChangeComment?.(node.id, { content: content$.value ?? '', title: store.$$.title.value ?? 'Comment' })
      editor.addEventListener('input', input)
      editor.addEventListener('blur', save)
      container.append(editor)
      editor.focus()
      return () => {
        editor.removeEventListener('input', input)
        editor.removeEventListener('blur', save)
        editor.remove()
      }
    },
    preview,
  })
  const entry: CommentNodeEntry = { contentKey, kind: 'comment', store, syncing: false }
  const renderPreview = (content = '') => preview.set(<MarkdownPreview content={content} dark$={dark} draggable onDoubleClick={store.togglePreview} />)
  renderPreview(node.content)
  store.dispose.add(store.$.content.reaction(renderPreview))
  store.dispose.add(
    store.$$.title.reaction((title) => {
      if (!entry.syncing) callbacks.onChangeComment?.(node.id, { content: store.$$.content.value ?? '', title: title ?? 'Comment' })
    }, true),
  )
  store.dispose.add([dark, preview])
  return entry
}

function updateCommentNodeEntry(entry: CommentNodeEntry, node: FlowDesignerViewCommentNode, contentKey: string): CommentNodeEntry {
  entry.syncing = true
  entry.store.$$.content.set(node.content)
  entry.store.$$.title.set(node.title)
  entry.syncing = false
  return { ...entry, contentKey }
}

function createNodeEntry(
  node: FlowDesignerViewSemanticNode,
  connected: readonly HandleName[],
  contentKey: string,
  designerUIStore: DesignerUIStore,
  designerStore: FlowDesignerStore,
  callbacks: ViewCallbacks,
): SemanticNodeEntry {
  const nodeInputsFrom = inputsFrom(node)
  const variablePrefix = `${node.id}\0`
  const boundHandles = derive(designerStore.$.variableInputs, (inputs) => {
    const handles = new Set<HandleName>()
    for (const [key, input] of inputs) {
      if (key.startsWith(variablePrefix) && input.name != null) handles.add(key.slice(variablePrefix.length) as HandleName)
    }
    return handles
  })
  const values: NodeValues = {
    concurrency: val(node.concurrency),
    description: val(node.description),
    diagnostics: val((node.diagnostics ?? 0) > 0),
    executorName: val(node.kind == 'task' ? node.executorName : undefined),
    icon: val(node.icon),
    inputDefs: val(inputDefs(node)),
    inputsFrom: val<readonly HandleInputFrom[] | undefined>(nodeInputsFrom),
    outputDefs: val(outputDefs(node)),
    outputsTo: val([...connected]),
    progress: val(node.run?.progress),
    rawIcon: val(node.rawIcon),
    rawTitle: val(node.rawTitle),
    reference: val(node.kind == 'task' || node.kind == 'subflow' ? node.reference : undefined),
    status: val<NodeStatus>(node.run?.status ?? NODE_STATUS.Idle),
    successCount: val(node.run?.successCount),
    timeout: val(node.timeoutSeconds),
    title: val(node.title),
  }
  const showSettings = val()
  let inputRole: 'author' | 'guest' | 'user' = 'guest'
  if (designerStore.$.editable.value) inputRole = node.kind == 'task' && node.editablePorts ? 'author' : 'user'
  const inputSection = new InputSectionStore({
    role: inputRole,
    lang: designerStore.lang$,
    boundHandles,
    handleInputsFrom: values.inputsFrom,
    inputHandleDefs: values.inputDefs,
    showSettings,
    createSchemaEditor: () => undefined,
  })
  inputSection.dispose.add(boundHandles)
  let previousInputValues = new Map(nodeInputsFrom.flatMap((input) => (Object.hasOwn(input, 'value') ? [[input.handle, input.value] as const] : [])))
  inputSection.dispose.add(
    values.inputsFrom.reaction((inputs) => {
      const inputValues = new Map((inputs ?? []).flatMap((input) => (Object.hasOwn(input, 'value') ? [[input.handle, input.value] as const] : [])))
      if (!values.syncingInput && designerStore.$.editable.value) {
        for (const handle of new Set([...previousInputValues.keys(), ...inputValues.keys()])) {
          if (previousInputValues.has(handle) == inputValues.has(handle) && Object.is(previousInputValues.get(handle), inputValues.get(handle))) continue
          callbacks.onChangeInput?.(node.id, handle, inputValues.get(handle))
        }
      }
      previousInputValues = inputValues
    }, true),
  )
  const diagnosticSection = createDiagnosticSection(values.diagnostics)
  const duplicateNode = (offset?: FlowDesignerViewPosition) => designerStore.onDuplicate?.([node.id as NodeId], offset)
  const manifest$ = { description: values.description, icon: values.rawIcon, title: values.rawTitle }
  const metadataDisposables = [
    values.description.reaction((description) => {
      if (!values.syncingMetadata && designerStore.$.editable.value) callbacks.onChangeNodeDescription?.(node.id, description)
    }),
    values.rawIcon.reaction((icon) => {
      if (!values.syncingMetadata && designerStore.$.editable.value) callbacks.onChangeNodeIcon?.(node.id, icon)
    }),
    values.rawTitle.reaction((title) => {
      if (!values.syncingMetadata && designerStore.$.editable.value) callbacks.onChangeNodeTitle?.(node.id, title)
    }),
  ]
  const changeDescription =
    callbacks.onChangeNodeDescription == null
      ? undefined
      : (description: string | undefined) => {
          if (designerStore.$.editable.value) values.description.set(description)
        }
  const commonDisplay = {
    icon: values.icon,
    title: values.title,
    description: values.description,
    timeout: values.timeout,
    concurrency: values.concurrency,
    progressWeight: val<number | undefined>(),
    status: values.status,
    progress: values.progress,
    successCount: values.successCount,
    showSettings,
    inputs_def: values.inputDefs,
    outputs_def: values.outputDefs,
    inputs_from: values.inputsFrom,
    ignore: val<boolean | undefined>(),
  }

  let store: NodeStore
  switch (node.kind) {
    case 'condition': {
      values.conditionCases = val(conditionCases(node))
      values.defaultCondition = val(node.defaultOutput == null ? undefined : { handle: node.defaultOutput as HandleName })
      const conditionInputs = derive(values.inputDefs, (defs) => defs.filter(isHandleDef))
      const conditionsSection = new ConditionsSectionStore({
        role: designerStore.$.editable.value ? 'author' : 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        inputHandleDefs: conditionInputs,
        conditionHandleDefs: values.conditionCases,
        defaultConditionHandleDef: values.defaultCondition,
        showSettings,
      })
      const notifyChange = () => {
        if (values.syncingCondition || !designerStore.$.editable.value) return
        callbacks.onChangeCondition?.(node.id, conditionChange(values))
      }
      store = new ConditionNodeStore(node.id as NodeId, {
        changeDescription,
        display$: { ...commonDisplay, sections: val([inputSection, conditionsSection, diagnosticSection]) },
        designerUIStore,
        duplicateNode,
        manifest$,
      })
      store.dispose.add(values.conditionCases.reaction(notifyChange, true))
      store.dispose.add(values.defaultCondition.reaction(notifyChange, true))
      store.dispose.add([values.conditionCases, values.defaultCondition, conditionInputs])
      break
    }
    case 'subflow': {
      const outputSection = new OutputSectionStore({
        role: 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        outputHandleDefs: values.outputDefs,
        showSettings,
        createSchemaEditor: () => undefined,
      })
      store = new SubflowNodeStore(node.id as NodeId, {
        changeDescription,
        display$: {
          ...commonDisplay,
          sections: val([inputSection, outputSection, diagnosticSection]),
          subflow: values.reference,
        },
        designerUIStore,
        duplicateNode,
        manifest$,
      })
      break
    }
    case 'task': {
      const outputSection = new OutputSectionStore({
        role: designerStore.$.editable.value && node.editablePorts ? 'author' : 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        outputHandleDefs: values.outputDefs,
        showSettings,
        createSchemaEditor: () => undefined,
      })
      store = new TaskNodeStore(node.id as NodeId, {
        changeDescription,
        display$: {
          ...commonDisplay,
          sections: val([inputSection, outputSection, diagnosticSection]),
          task: values.reference,
          executorName: values.executorName,
        },
        designerUIStore,
        duplicateNode,
        manifest$: { ...manifest$, task: val<string | InlineTask | undefined>(node.reference) },
      })
      if (node.editablePorts) {
        const changePorts = () => {
          if (values.syncingPorts || !designerStore.$.editable.value) return
          callbacks.onChangeTaskPorts?.(node.id, taskInputs(values.inputDefs.value), taskOutputs(values.outputDefs.value))
        }
        store.dispose.add(values.inputDefs.reaction(changePorts, true))
        store.dispose.add(values.outputDefs.reaction(changePorts, true))
      }
      break
    }
    case 'trigger': {
      inputSection.dispose()
      values.triggerPresentation = val(node.presentation)
      const outputSection = new OutputSectionStore({
        role: 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        outputHandleDefs: values.outputDefs,
        showSettings,
        createSchemaEditor: () => undefined,
      })
      store = new TriggerNodeStore(node.id as NodeId, {
        changeDescription,
        changeConfig:
          callbacks.onChangeTriggerConfig == null
            ? undefined
            : (name, value) => {
                if (designerStore.$.editable.value) callbacks.onChangeTriggerConfig?.(node.id, name, value)
              },
        changeSchedule:
          callbacks.onChangeTriggerSchedule == null
            ? undefined
            : (schedule) => {
                if (designerStore.$.editable.value) callbacks.onChangeTriggerSchedule?.(node.id, schedule)
              },
        changeWebhook:
          callbacks.onChangeWebhook == null
            ? undefined
            : (webhook) => {
                if (designerStore.$.editable.value) callbacks.onChangeWebhook?.(node.id, webhook)
              },
        display$: {
          ...commonDisplay,
          editable: designerStore.$.editable,
          presentation: values.triggerPresentation,
          sections: val([outputSection, diagnosticSection]),
          trigger: val(undefined),
        },
        designerUIStore,
        manifest$: { ...manifest$, trigger: val<TriggerDescriptor | undefined>(undefined) },
      })
      break
    }
    case 'value': {
      const defs = (values.valueDefs = val<ValueHandleDef[] | undefined>(valueDefs(node)))
      const valueSection = new ValueSectionStore({
        role: designerStore.$.editable.value ? 'author' : 'guest',
        lang: designerStore.lang$,
        handleOutputsTo: values.outputsTo,
        valueHandleDefs: defs,
        showSettings,
        createSchemaEditor: () => undefined,
      })
      store = new ValueNodeStore(node.id as NodeId, {
        changeDescription,
        display$: {
          ...commonDisplay,
          sections: val([valueSection, diagnosticSection]),
          inputs_def: defs,
          outputs_def: defs,
        },
        designerUIStore,
        duplicateNode,
        manifest$,
      })
      store.dispose.add(
        valueSection.$.valueHandleDefs.reaction((nextDefs) => {
          if (values.syncingValue || !designerStore.$.editable.value) return
          callbacks.onChangeValue?.(
            node.id,
            (nextDefs ?? []).map((def) =>
              Object.assign(
                {
                  handle: def.handle,
                  description: def.description,
                  jsonSchema: def.json_schema,
                  nullable: def.nullable,
                },
                Object.hasOwn(def, 'value') ? { value: def.value } : {},
              ),
            ),
          )
        }, true),
      )
      store.dispose.add(defs)
      break
    }
  }
  store.dispose.add(metadataDisposables)
  store.dispose.add(values.outputsTo)
  return { contentKey, editable: designerStore.$.editable.value, kind: node.kind, store, values }
}

function updateNodeEntry(
  entry: SemanticNodeEntry,
  node: FlowDesignerViewSemanticNode,
  connected: readonly HandleName[],
  contentKey: string,
): SemanticNodeEntry {
  if (node.kind == 'condition') entry.values.syncingCondition = true
  entry.values.syncingMetadata = true
  entry.values.description.set(node.description)
  entry.values.diagnostics.set((node.diagnostics ?? 0) > 0)
  entry.values.concurrency.set(node.concurrency)
  entry.values.executorName.set(node.kind == 'task' ? node.executorName : undefined)
  entry.values.icon.set(node.icon)
  entry.values.rawIcon.set(node.rawIcon)
  entry.values.rawTitle.set(node.rawTitle)
  const nextInputDefs = inputDefs(node)
  const nextOutputDefs = outputDefs(node)
  entry.values.syncingPorts = true
  if (JSON.stringify(entry.values.inputDefs.value) != JSON.stringify(nextInputDefs)) entry.values.inputDefs.set(nextInputDefs)
  entry.values.syncingInput = true
  entry.values.inputsFrom.set(inputsFrom(node))
  entry.values.syncingInput = false
  if (JSON.stringify(entry.values.outputDefs.value) != JSON.stringify(nextOutputDefs)) entry.values.outputDefs.set(nextOutputDefs)
  entry.values.syncingPorts = false
  entry.values.outputsTo.set([...connected])
  entry.values.progress.set(node.run?.progress)
  entry.values.reference.set(node.kind == 'task' || node.kind == 'subflow' ? node.reference : undefined)
  entry.values.status.set(node.run?.status ?? NODE_STATUS.Idle)
  entry.values.successCount.set(node.run?.successCount)
  entry.values.timeout.set(node.timeoutSeconds)
  entry.values.title.set(node.title)
  entry.values.syncingMetadata = false
  if (node.kind == 'condition') {
    entry.values.conditionCases!.set(conditionCases(node))
    entry.values.defaultCondition!.set(node.defaultOutput == null ? undefined : { handle: node.defaultOutput as HandleName })
    entry.values.syncingCondition = false
  }
  if (node.kind == 'value') {
    entry.values.syncingValue = true
    entry.values.valueDefs!.set(valueDefs(node))
    entry.values.syncingValue = false
  }
  if (node.kind == 'trigger') entry.values.triggerPresentation!.set(node.presentation)
  return { ...entry, contentKey }
}

function toViewEdge(source: string, sourceHandle: string, target: string, targetHandle: string): FlowDesignerViewEdge {
  return {
    id: JSON.stringify([source, sourceHandle, target, targetHandle]),
    source,
    sourceHandle,
    target,
    targetHandle,
  }
}

function callbacksFromProps(props: FlowDesignerViewProps): ViewCallbacks {
  return {
    onAddNode: props.onAddNode,
    onChangeComment: props.onChangeComment,
    onChangeCondition: props.onChangeCondition,
    onChangeNodeDescription: props.onChangeNodeDescription,
    onChangeNodeIcon: props.onChangeNodeIcon,
    onChangeNodeTitle: props.onChangeNodeTitle,
    onChangeInput: props.onChangeInput,
    onChangeInputVariable: props.onChangeInputVariable,
    onChangeTaskPorts: props.onChangeTaskPorts,
    onChangeTriggerConfig: props.onChangeTriggerConfig,
    onChangeTriggerSchedule: props.onChangeTriggerSchedule,
    onChangeWebhook: props.onChangeWebhook,
    onConnect: props.onConnect,
    onChangeValue: props.onChangeValue,
    onDeleteNodes: props.onDeleteNodes,
    onDisconnect: props.onDisconnect,
    onDuplicate: props.onDuplicate,
    onPaste: props.onPaste,
    provideAddItems: props.provideAddItems,
    onOpenVariables: props.onOpenVariables,
  }
}

export function FlowDesignerView(props: FlowDesignerViewProps): ReactElement {
  const adapter = useMemo(
    () => new FlowDesignerViewAdapter(props.model, props.editable, props.language ?? 'en', props.addItems, callbacksFromProps(props)),
    [props.identity],
  )
  const propsRef = useRef(props)
  const selectedEdge = useRef<string>()
  propsRef.current = props

  const onMoveEnd = useCallback<OnMoveEnd>((_, viewport) => propsRef.current.onMoveViewport(viewport, adapter.store.$.displayMode.value), [adapter])
  const onNodeDragStop = useCallback<OnNodeDrag<RFNode<any>>>(
    (_, node, nodes) => {
      const moved = nodes.length > 0 ? nodes : [node]
      propsRef.current.onMoveNodes(
        Object.fromEntries(
          moved.flatMap((item) => {
            const store = item.data?.store as NodeStore | CommentNodeStore | undefined
            return store == null ? [] : [[store.nodeId, item.position]]
          }),
        ),
        adapter.store.$.displayMode.value,
      )
    },
    [adapter],
  )
  const onSelectionChange = useCallback<OnSelectionChangeFunc<RFNode<any>, RFEdge<any>>>(({ edges, nodes }) => {
    const nodeIds = nodes.flatMap((node) => {
      const store = node.data?.store as NodeStore | CommentNodeStore | undefined
      return store == null ? [] : [store.nodeId]
    })
    const connection = edges[0]?.data?.store?.connection
    const edge =
      connection?.from.type == 'from_node' && connection.to.type == 'to_node'
        ? toViewEdge(connection.from.source.node_id, connection.from.source.output_handle, connection.to.target.node_id, connection.to.target.input_handle)
        : undefined
    const selected = new Set(propsRef.current.selectedNodeIds)
    const selectionChanged = nodeIds.length != selected.size || nodeIds.some((nodeId) => !selected.has(nodeId))
    const edgeChanged = selectedEdge.current != edge?.id
    selectedEdge.current = edge?.id
    if (selectionChanged || edgeChanged) propsRef.current.onSelectionChange(nodeIds, edge)
  }, [])
  const isValidConnection = useCallback<IsValidConnection<RFEdge<any>>>((edge) => {
    if (edge.sourceHandle == null || edge.targetHandle == null) return true
    return (
      propsRef.current.isValidConnection?.({
        source: toManifestNodeId(edge.source as RFNodeId),
        sourceHandle: toManifestHandleName(edge.sourceHandle as RFHandleName),
        target: toManifestNodeId(edge.target as RFNodeId),
        targetHandle: toManifestHandleName(edge.targetHandle as RFHandleName),
      }) ?? true
    )
  }, [])
  const onDropAddItem = useCallback((itemId: string, position: FlowDesignerViewPosition) => {
    void propsRef.current.onAddNode(itemId, position)
  }, [])

  useEffect(() => adapter.mount(), [adapter])
  useLayoutEffect(() => adapter.setCallbacks(callbacksFromProps(props)))
  useLayoutEffect(() => {
    adapter.reconcile(props.model, props.editable, props.language ?? 'en', props.addItems)
  }, [adapter, props.addItems, props.editable, props.language, props.model])
  useLayoutEffect(() => adapter.setSelection(props.selectedNodeIds), [adapter, props.selectedNodeIds])
  useEffect(() => {
    if (props.focusNodeRequest != null) {
      const reducedMotion =
        typeof window != 'undefined' && typeof window.matchMedia == 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      adapter.focusNode(props.focusNodeRequest.nodeId, reducedMotion ? 0 : 150)
    }
  }, [adapter, props.focusNodeRequest])

  return (
    <FlowDesigner
      addNodeRequest={props.addNodeRequest}
      className={props.className}
      dark={props.dark ?? false}
      fitView={false}
      flowDesignerStore={adapter.store}
      isValidConnection={isValidConnection}
      key={props.identity}
      onMoveEnd={onMoveEnd}
      onNodeDragStop={onNodeDragStop}
      onDropAddItem={onDropAddItem}
      onSelectionChange={onSelectionChange}
    />
  )
}
