import type { ComputeGet, ReadonlyVal, Val } from 'value-enhancer'
import type { HandleName, InlineTaskBlock, InputHandleDef, NodeId, OutputHandleDef } from '../../../../schema/index.ts'
import type { CommentNodeStore } from './commentNode.store.ts'
import type { GroupedInputHandleDef, GroupedOutputHandleDef } from './constants.ts'
import type { NodeStoreManifest$, NodeStoreDisplay$, NodeStoreProps } from './node.store.ts'

import { isDefined } from '@wopjs/cast'
import { isVal } from 'value-enhancer'
import { NODE_TYPE } from './constants.ts'
import { NodeStore } from './node.store.ts'
import { InputSectionStore } from './nodeSection/inputSection.store.ts'
import { OutputSectionStore } from './nodeSection/outputSection.store.ts'

export interface InlineTask {
  readonly executor: Val<InlineTaskBlock['executor'] | undefined>
}

export interface TaskNodeStoreManifest$ extends NodeStoreManifest$ {
  // Flow Designer uses a string for a shared Task block and an object for an inline Task.
  // Block Designer exposes its Task block through the same shape while metadata stays in
  // the NodeStore manifest fields.
  readonly task: Val<string | InlineTask | undefined>

  // Block Designer controls whether users may add custom input handles.
  readonly additional_inputs?: Val<boolean | InputHandleDef | undefined>

  // Block Designer controls whether users may add custom output handles.
  readonly additional_outputs?: Val<boolean | OutputHandleDef | undefined>
}

export interface TaskNodeStoreDisplay$ extends NodeStoreDisplay$ {
  readonly task: ReadonlyVal<string | undefined>
  readonly executorName: ReadonlyVal<string | undefined>
  readonly notice?: ReadonlyVal<{ readonly icon?: string; readonly text: string } | undefined>
}

export interface TaskNodeStoreProps extends NodeStoreProps<TaskNodeStoreManifest$, TaskNodeStoreDisplay$> {
  /** Opens the executor entry shown in node settings. */
  readonly openExecutorEntry?: () => void
  /** Opens the source for a shared Task block. */
  readonly openSharedTaskSource?: () => void
  /** Opens the shared block Designer. */
  readonly openBlockDesigner?: () => void
}

export class TaskNodeStore extends NodeStore<TaskNodeStoreManifest$, TaskNodeStoreDisplay$> {
  public readonly openExecutorEntry: (() => void) | undefined
  public readonly openSharedTaskSource: (() => void) | undefined
  public readonly openBlockDesigner: (() => void) | undefined

  public static override is(store: unknown): store is TaskNodeStore {
    return NodeStore.is(store) && store.nodeType === NODE_TYPE.TaskNode
  }

  public constructor(nodeId: NodeId, props: TaskNodeStoreProps) {
    super(nodeId, NODE_TYPE.TaskNode, props)
    this.openExecutorEntry = props.openExecutorEntry
    this.openSharedTaskSource = props.openSharedTaskSource
    this.openBlockDesigner = props.openBlockDesigner
  }

  /** @internal */
  public handleHasValueNodeConnected(handleName: HandleName): boolean {
    if (!this.edges?.value) return false
    for (const edge of Object.values(this.edges.value)) {
      if (edge.connection.to.type === 'to_node' && edge.connection.to.target.input_handle === handleName) {
        if (edge.$.connectionMeta.value?.fromValueNode) return true
      }
    }
    return false
  }

  /** @internal */
  public getInputHandleDef(handle: HandleName, get: ComputeGet = (v) => (isVal(v) ? v.value : v)): InputHandleDef | undefined {
    return get(this.display$.inputs_def)?.find((def: GroupedInputHandleDef): def is InputHandleDef => def.handle === handle)
  }

  /** @internal */
  public getOutputHandleDef(handle: HandleName, get: ComputeGet = (v) => (isVal(v) ? v.value : v)): OutputHandleDef | undefined {
    return get(this.display$.outputs_def)?.find((def: GroupedOutputHandleDef): def is OutputHandleDef => def.handle === handle)
  }

  /** @internal */
  public getInputFrom(handle: HandleName): unknown {
    for (const input of this.display$.inputs_from?.value ?? []) {
      if (input.handle === handle && isDefined(input.value)) {
        return input.value
      }
    }
  }

  /** @internal */
  public setupInputHandle(handle: HandleName, def: InputHandleDef): void {
    this.display$.sections.value.find(InputSectionStore.is)?.assignHandleDef(handle, def)
  }

  /** @internal */
  public setupOutputHandle(handle: HandleName, def: OutputHandleDef): void {
    this.display$.sections.value.find(OutputSectionStore.is)?.assignHandleDef(handle, def)
  }
}

export function toTaskNodeStore(nodeStore: NodeStore | CommentNodeStore | undefined): TaskNodeStore | undefined {
  return TaskNodeStore.is(nodeStore) ? nodeStore : undefined
}

export function isInlineTask(task: string | InlineTask | undefined): task is InlineTask {
  return !!task && typeof task === 'object'
}
