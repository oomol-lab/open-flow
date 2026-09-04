import type { DisposableStore } from '@wopjs/disposable'
import type { ReadonlyVal } from 'value-enhancer'
import type { ReactiveMap, ReadonlyReactiveMap } from 'value-enhancer/collections'
import type { ResourceUriResolver } from '../../../../base/common/resource.ts'
import type {
  ConditionNode,
  HandleInputFrom,
  HandleName,
  HandleOutputFrom,
  InputHandleDef,
  NodeId,
  OutputHandleDef,
  SubflowNode,
  TaskNode,
  TriggerDefinition,
  TriggerDescriptor,
  ValueNode,
} from '../../../../schema/index.ts'
import type { FlowLikeName, FlowLikePath, FlowLikeType, SearchPath, WSId } from '../../manifestTypes.ts'
import type { NodeType } from '../../model/node/nodeManifest.ts'
import type { WritableFlowLikeManifest } from '../../writable/flowLike/writableFlowLikeManifest.ts'
import type { WritableNodeManifest } from '../../writable/node/writableNodeManifest.ts'
import type { YamlMap } from '../../yaml.ts'
import type { ResolveSharedBlockMeta$ } from '../nodeMeta.ts'
import type { PackageMeta } from '../package/packageMeta.ts'

import { inertFilter, inertFilterMap } from '@wopjs/cast'
import { disposableStore, dispose } from '@wopjs/disposable'
import { compute, derive } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { Document } from 'yaml'
import { dirname } from '../../../../base/common/posixPath.ts'
import { getReactiveValue } from '../../../../base/common/reactivity.ts'
import { createWeakMemoizedFunction } from '../../../../base/common/weakMemoize.ts'
import { getManifestName } from '../../manifestName.ts'
import { WritableConditionNodeManifest } from '../../writable/node/writableConditionNodeManifest.ts'
import { WritableSubflowNodeManifest } from '../../writable/node/writableSubflowNodeManifest.ts'
import { WritableTaskNodeManifest } from '../../writable/node/writableTaskNodeManifest.ts'
import { WritableTriggerNodeManifest } from '../../writable/node/writableTriggerNodeManifest.ts'
import { WritableValueNodeManifest } from '../../writable/node/writableValueNodeManifest.ts'
import { getYamlNode } from '../../yaml.ts'
import { ValueBlockMeta } from '../block/valueBlockMeta.ts'
import { NodeMeta } from '../nodeMeta.ts'
import { FlowLikeMetaKind } from './internal.ts'

function stripHashIndex(name: string): string {
  return name.replace(/\s+#\d+$/, '')
}

export interface FlowLikeMeta$ {
  readonly title: ReadonlyVal<string | undefined>
  readonly icon: ReadonlyVal<string | undefined>

  /** Flow is undefined. Subflow uses the block input handles. */
  readonly inputHandleDefs: ReadonlyVal<InputHandleDef[] | undefined>
  /** Flow is undefined. Subflow uses the block output handles. */
  readonly outputHandleDefs: ReadonlyVal<OutputHandleDef[] | undefined>

  readonly inputHandleNames: ReadonlyVal<HandleName[]>
  readonly outputHandleNames: ReadonlyVal<HandleName[]>

  readonly handleOutputsFrom: ReadonlyVal<readonly HandleOutputFrom[] | undefined>

  readonly connectedInputHandles: ReadonlyVal<HandleName[] | undefined>
}

export abstract class FlowLikeMeta<TManifest extends WritableFlowLikeManifest = WritableFlowLikeManifest> {
  public readonly dispose: DisposableStore = disposableStore()

  public static readonly KIND: Record<FlowLikeMetaKind, boolean> = {
    [FlowLikeMetaKind]: true,
  }

  public abstract readonly KIND: Record<FlowLikeMetaKind, boolean>

  public readonly wsId: WSId

  public abstract readonly $: FlowLikeMeta$

  public readonly nodes: ReadonlyReactiveMap<NodeId, NodeMeta>

  public readonly manifestName: FlowLikeName
  public readonly manifestDir: string
  public readonly manifestType: FlowLikeType

  public constructor(
    public readonly flowLikeType: FlowLikeType,
    public readonly manifestPath: FlowLikePath,
    public readonly searchPath: SearchPath,
    public readonly packageMeta: PackageMeta,
    public readonly manifest: TManifest,
    public readonly resolveSharedBlockMeta$: ResolveSharedBlockMeta$,
    public readonly resolveResourceUri: ResourceUriResolver,
  ) {
    this.dispose.add(manifest)
    this.manifestType = flowLikeType
    this.manifestName = getManifestName(manifestPath, flowLikeType) as FlowLikeName
    this.manifestDir = dirname(manifestPath)
    this.wsId = `${packageMeta.packageId}/${flowLikeType}/${this.manifestName}` as WSId

    this.nodes = this.dispose.add(reactiveMap<NodeId, NodeMeta>(null, { onDeleted: dispose }))
  }

  protected setupMigrateNodes(): void {
    this.dispose.add(
      this.manifest.nodeManifests.$.subscribe((nodeManifests) => {
        let entries: [NodeId, NodeMeta][] | undefined
        for (const nodeManifest of nodeManifests.values()) {
          let nodeMeta = this.nodes.get(nodeManifest.nodeId)
          if (!nodeMeta || nodeMeta.manifest !== nodeManifest) {
            nodeMeta = new NodeMeta(this, nodeManifest, this.isNodeOutputHandleExist$, this.resolveResourceUri, this.resolveSharedBlockMeta$)
          }
          ;(entries ??= []).push([nodeMeta.nodeId, nodeMeta])
        }
        if (entries) {
          ;(this.nodes as ReactiveMap<NodeId, NodeMeta>).replace(entries)
        } else {
          ;(this.nodes as ReactiveMap<NodeId, NodeMeta>).clear()
        }
      }),
    )
  }

  public triggerDefinition$(trigger$: ReadonlyVal<TriggerDescriptor | undefined>): ReadonlyVal<TriggerDefinition | undefined> {
    return derive(trigger$, () => undefined)
  }

  public upsertNodes(options: UpsertNodeOptions[] | UpsertNodeOptions): void {
    const flowLikeManifest = this.manifest

    const entries: [NodeId, WritableNodeManifest][] = []

    for (const option of Array.isArray(options) ? options : [options]) {
      const { type, data } = option
      const doc = new Document({ data })
      const yamlParent = getYamlNode(doc, 'data').unwrap() as YamlMap
      switch (type) {
        case 'task': {
          let nodeManifest = WritableTaskNodeManifest.to(flowLikeManifest.nodes.get(data.node_id))
          if (nodeManifest) {
            nodeManifest.onYamlParentUpdated(yamlParent)
          } else {
            nodeManifest = new WritableTaskNodeManifest(data.node_id, yamlParent)
          }
          entries.push([data.node_id, nodeManifest])
          break
        }
        case 'subflow': {
          let nodeManifest = WritableSubflowNodeManifest.to(flowLikeManifest.nodes.get(data.node_id))
          if (nodeManifest) {
            nodeManifest.onYamlParentUpdated(yamlParent)
          } else {
            nodeManifest = new WritableSubflowNodeManifest(data.node_id, yamlParent)
          }
          entries.push([data.node_id, nodeManifest])
          break
        }
        case 'value': {
          let nodeManifest = WritableValueNodeManifest.to(flowLikeManifest.nodes.get(data.node_id))
          if (nodeManifest) {
            nodeManifest.onYamlParentUpdated(yamlParent)
          } else {
            nodeManifest = new WritableValueNodeManifest(data.node_id, yamlParent)
          }
          entries.push([data.node_id, nodeManifest])
          break
        }
        case 'condition': {
          let nodeManifest = WritableConditionNodeManifest.to(flowLikeManifest.nodes.get(data.node_id))
          if (nodeManifest) {
            nodeManifest.onYamlParentUpdated(yamlParent)
          } else {
            nodeManifest = new WritableConditionNodeManifest(data.node_id, yamlParent)
          }
          entries.push([data.node_id, nodeManifest])
          break
        }
      }
    }

    flowLikeManifest.nodeManifests.batchSet(entries)
  }

  public upsertNodeYamls(options: UpsertNodeYamlOptions[] | UpsertNodeYamlOptions): void {
    const flowLikeManifest = this.manifest

    const entries: [NodeId, WritableNodeManifest][] = []

    for (const option of Array.isArray(options) ? options : [options]) {
      const { nodeId, type, yamlMap } = option
      switch (type) {
        case 'task': {
          let taskNodeManifest = WritableTaskNodeManifest.to(flowLikeManifest.nodes.get(nodeId))
          if (taskNodeManifest) {
            taskNodeManifest.onYamlParentUpdated(yamlMap)
          } else {
            taskNodeManifest = new WritableTaskNodeManifest(nodeId, yamlMap)
          }
          entries.push([nodeId, taskNodeManifest])
          break
        }
        case 'subflow': {
          let subflowNodeManifest = WritableSubflowNodeManifest.to(flowLikeManifest.nodes.get(nodeId))
          if (subflowNodeManifest) {
            subflowNodeManifest.onYamlParentUpdated(yamlMap)
          } else {
            subflowNodeManifest = new WritableSubflowNodeManifest(nodeId, yamlMap)
          }
          entries.push([nodeId, subflowNodeManifest])
          break
        }
        case 'value': {
          let valueNodeManifest = WritableValueNodeManifest.to(flowLikeManifest.nodes.get(nodeId))
          if (valueNodeManifest) {
            valueNodeManifest.onYamlParentUpdated(yamlMap)
          } else {
            valueNodeManifest = new WritableValueNodeManifest(nodeId, yamlMap)
          }
          entries.push([nodeId, valueNodeManifest])
          break
        }
        case 'condition': {
          let conditionNodeManifest = WritableConditionNodeManifest.to(flowLikeManifest.nodes.get(nodeId))
          if (conditionNodeManifest) {
            conditionNodeManifest.onYamlParentUpdated(yamlMap)
          } else {
            conditionNodeManifest = new WritableConditionNodeManifest(nodeId, yamlMap)
          }
          entries.push([nodeId, conditionNodeManifest])
          break
        }
        case 'trigger': {
          let triggerNodeManifest = WritableTriggerNodeManifest.to(flowLikeManifest.nodes.get(nodeId))
          if (triggerNodeManifest) {
            triggerNodeManifest.onYamlParentUpdated(yamlMap)
          } else {
            triggerNodeManifest = new WritableTriggerNodeManifest(nodeId, yamlMap)
          }
          entries.push([nodeId, triggerNodeManifest])
          break
        }
      }
    }

    flowLikeManifest.nodeManifests.batchSet(entries)
  }

  public upsertNodeManifests(nodeManifests: WritableNodeManifest[] | WritableNodeManifest): void {
    const flowLikeManifest = this.manifest

    flowLikeManifest.nodeManifests.batchSet(
      (Array.isArray(nodeManifests) ? nodeManifests : [nodeManifests]).map((nodeManifest) => [nodeManifest.nodeId, nodeManifest] as const),
    )
  }

  /**
   * Removes nodes in response to an explicit user or program action.
   */
  public removeNodes(nodeMetaOrNodeMetas: NodeMeta[] | NodeMeta): boolean {
    const flowLikeManifest = this.manifest

    const nodeMetas = inertFilter(
      Array.isArray(nodeMetaOrNodeMetas) ? nodeMetaOrNodeMetas : [nodeMetaOrNodeMetas],
      (nodeMeta) => nodeMeta.flowLikeMeta.manifest === flowLikeManifest && flowLikeManifest.nodeManifests.has(nodeMeta.nodeId),
    )
    if (nodeMetas.length <= 0) return false

    for (const nodeMeta of nodeMetas) {
      // Remove this node ID from every from_node reference.
      this.#reconnectNode(nodeMeta.nodeId)
    }

    this.packageMeta.cleanupRemovedNodes(nodeMetas)

    return flowLikeManifest.nodeManifests.batchDelete(nodeMetas.map((nodeMeta) => nodeMeta.nodeId))
  }

  public renameNode(oldNodeId: NodeId, newNodeId: NodeId): boolean {
    const flowLikeManifest = this.manifest

    const oldNode = flowLikeManifest.nodeManifests.get(oldNodeId)
    if (!oldNode) return false

    const newNode = oldNode.clone(newNodeId)
    flowLikeManifest.nodeManifests.set(newNodeId, newNode)

    this.#reconnectNode(oldNodeId, newNodeId)

    flowLikeManifest.nodeManifests.delete(oldNodeId)

    return true
  }

  #nameIndexCache = new Map<string, number>()
  public produceNodeId(refName: string): [NodeId, number] {
    const name = stripHashIndex(refName)
    let index = this.#nameIndexCache.get(name) || 0
    let nodeId: NodeId
    do {
      nodeId = `${name}#${++index}` as NodeId
    } while (this.nodes.has(nodeId))
    this.#nameIndexCache.set(name, index)
    return [nodeId, index]
  }

  public produceNodeTitle(refTitle?: string, index?: number): string | undefined {
    if (!refTitle) return
    const name = stripHashIndex(refTitle)
    if (!index) return name
    return `${name} #${index}`
  }

  protected readonly isNodeOutputHandleExist$: (nodeId: NodeId, outputHandle: HandleName) => ReadonlyVal<boolean> = this.dispose.add(
    createWeakMemoizedFunction(
      (nodeId: NodeId, outputHandle: HandleName): ReadonlyVal<boolean> =>
        compute((get) => {
          const toCheckNodeMeta = get(getReactiveValue(this.nodes, nodeId))
          if (!toCheckNodeMeta) return false
          if (WritableTriggerNodeManifest.is(toCheckNodeMeta.manifest)) return outputHandle == 'payload'

          const blockMeta = get(toCheckNodeMeta.$.blockMeta)
          if (!blockMeta) {
            // Preserve connections to invalid nodes so the Designer can expose their handles through ErrorNode.
            return true
          }

          if (ValueBlockMeta.is(blockMeta)) {
            const handleDefs = get(blockMeta.manifest.$.values)
            return !!handleDefs?.some((def) => def.handle === outputHandle)
          }

          const outputHandleNames = get(toCheckNodeMeta.$.allOutputHandleNames)
          return outputHandleNames.includes(outputHandle)
        }),
      (nodeId, outputHandle) => `${nodeId}:${outputHandle}`,
    ),
  )

  #reconnectNode(oldNodeId: NodeId, newNodeId?: NodeId): void {
    const flowLikeManifest = this.manifest

    // Update this node ID in every from_node reference.
    for (const nodeManifest of flowLikeManifest.nodeManifests.values()) {
      const inputs_from$ = nodeManifest.$$.inputs_from
      if (inputs_from$.value) {
        inputs_from$.set(inertFilterMap(inputs_from$.value, (inputFrom) => inertMapNodeId(inputFrom, oldNodeId, newNodeId)))
      }
    }
    if (this.$.handleOutputsFrom.value?.length) {
      flowLikeManifest.$$.outputs_from.set(inertFilterMap(this.$.handleOutputsFrom.value, (outputFrom) => inertMapNodeId(outputFrom, oldNodeId, newNodeId)))
    }
  }

  public toJSON(): object {
    return this.manifest.toJSON()
  }
}

export const isFlowLikeMeta = (meta: any): meta is FlowLikeMeta => meta?.KIND?.[FlowLikeMetaKind] === true

export const toFlowLikeMeta = (meta: unknown): FlowLikeMeta | undefined => {
  if (isFlowLikeMeta(meta)) {
    return meta
  }
}

function inertMapNodeId<T extends HandleInputFrom | HandleOutputFrom>(inputFrom: T, oldNodeId: NodeId, newNodeId?: NodeId): T {
  if (inputFrom.from_node) {
    let from_node = inertFilterMap(inputFrom.from_node, (fromNode) => {
      if (fromNode.node_id === oldNodeId) {
        return newNodeId ? { ...fromNode, node_id: newNodeId } : undefined
      }
      return fromNode
    })
    if (from_node !== inputFrom.from_node) {
      return { ...inputFrom, from_node }
    }
  }
  return inputFrom
}

export interface UpsertTaskNodeOptions {
  type: 'task'
  data: TaskNode
}

export interface UpsertSubflowNodeOptions {
  type: 'subflow'
  data: SubflowNode
}

export interface UpsertValueNodeOptions {
  type: 'value'
  data: ValueNode
}

export interface UpsertConditionNodeOptions {
  type: 'condition'
  data: ConditionNode
}

export type UpsertNodeOptions = UpsertTaskNodeOptions | UpsertSubflowNodeOptions | UpsertValueNodeOptions | UpsertConditionNodeOptions

export interface UpsertNodeYamlOptions {
  nodeId: NodeId
  type: NodeType
  yamlMap: YamlMap
}

export const sanitizeHandleOutputsFrom$ = (
  outputsFrom$: ReadonlyVal<readonly HandleOutputFrom[] | undefined>,
  inputHandleDefs$: ReadonlyVal<readonly InputHandleDef[] | undefined>,
  outputHandleDefs$: ReadonlyVal<OutputHandleDef[] | undefined>,
  isNodeOutputHandleExist$: (nodeId: NodeId, outputHandle: HandleName) => ReadonlyVal<boolean>,
): ReadonlyVal<readonly HandleOutputFrom[] | undefined> => {
  return compute((get) => {
    const outputsFrom = get(outputsFrom$)
    if (!outputsFrom) return

    const outputHandleDefs = get(outputHandleDefs$)
    if (!outputHandleDefs) return

    return inertFilterMap(outputsFrom, (outputFrom) => {
      if (outputHandleDefs.every((def) => def.handle !== outputFrom.handle)) {
        return undefined
      }

      if (outputFrom.from_node) {
        const fromNode = inertFilter(outputFrom.from_node, (f) => get(isNodeOutputHandleExist$(f.node_id, f.output_handle)))
        if (fromNode !== outputFrom.from_node) {
          return {
            ...outputFrom,
            from_node: fromNode,
          }
        }
      }

      if (outputFrom.from_flow) {
        const inputHandleDefs = get(inputHandleDefs$)
        const fromFlow = inertFilter(outputFrom.from_flow, (f) => !inputHandleDefs?.every((def) => def.handle !== f.input_handle))
        if (fromFlow !== outputFrom.from_flow) {
          return {
            ...outputFrom,
            from_flow: fromFlow,
          }
        }
      }

      return outputFrom
    })
  })
}

export function createConnectedInputHandles$(
  nodes: ReadonlyReactiveMap<NodeId, NodeMeta>,
  inputHandleNames: ReadonlyVal<HandleName[]>,
  handleOutputsFrom: ReadonlyVal<readonly HandleOutputFrom[] | undefined>,
): ReadonlyVal<HandleName[] | undefined> {
  return compute((get) => {
    const allInputNames = get(inputHandleNames)
    if (!allInputNames.length) return

    let result: HandleName[] | undefined

    const extract = (inoutFrom?: readonly (HandleInputFrom | HandleOutputFrom)[] | undefined) => {
      if (inoutFrom) {
        for (const inf of inoutFrom) {
          if (inf.from_flow) {
            for (const fromFlow of inf.from_flow) {
              if (allInputNames.includes(fromFlow.input_handle)) {
                ;(result ??= []).push(fromFlow.input_handle)
              }
            }
          }
        }
      }
    }

    for (const nodeMeta of get(nodes).values()) {
      extract(get(nodeMeta.$.handleInputsFrom))
    }

    extract(get(handleOutputsFrom))

    return result
  })
}
