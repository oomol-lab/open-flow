import type { DisposableStore } from '@wopjs/disposable'
import type { ComputeGet, ReadonlyVal, Val } from 'value-enhancer'
import type { ResourceUriResolver } from '../../../base/common/resource.ts'
import type { HandleInputFrom, HandleName, HandleOutputFrom, InputHandleDef, NodeId, OutputHandleDef, TriggerDefinition } from '../../../schema/index.ts'
import type { BlockResourceName, SharedBlockType } from '../manifestTypes.ts'
import type { WritableNodeManifest } from '../writable/node/writableNodeManifest.ts'
import type { SharedBlockMeta } from './block/shared/sharedBlockMeta.ts'
import type { SubflowBlockMeta } from './block/subflowBlockMeta.ts'
import type { FlowLikeMeta } from './flowLike/flowLikeMeta.ts'

import { inertFilterMap } from '@wopjs/cast'
import { disposableStore } from '@wopjs/disposable'
import { isEqual } from 'radash'
import { arrayShallowEqual, attachSetter, combine, compute, derive, flatten, val } from 'value-enhancer'
import { isAbsolute, isParent, join } from '../../../base/common/posixPath.ts'
import { getHandleNames } from '../model/block/base/blockManifest.ts'
import { isConditionNodeManifest } from '../model/node/conditionNodeManifest.ts'
import { isSubflowNodeManifest } from '../model/node/subflowNodeManifest.ts'
import { isTaskNodeManifest } from '../model/node/taskNodeManifest.ts'
import { isTriggerNodeManifest } from '../model/node/triggerNodeManifest.ts'
import { isValueNodeManifest } from '../model/node/valueNodeManifest.ts'
import { scriptletDirectory } from '../scriptlet.ts'
import { WritableConditionBlockManifest } from '../writable/block/writableConditionBlockManifest.ts'
import { WritableInlineTaskBlockManifest } from '../writable/block/writableInlineTaskBlockManifest.ts'
import { WritableValueBlockManifest } from '../writable/block/writableValueBlockManifest.ts'
import { WritableTaskNodeManifest } from '../writable/node/writableTaskNodeManifest.ts'
import { CONDITION_BLOCK_ICON, ConditionBlockMeta } from './block/conditionBlockMeta.ts'
import { InlineTaskBlockMeta } from './block/inlineTaskBlockMeta.ts'
import { isSharedBlockMeta } from './block/shared/sharedBlockMeta.ts'
import { TaskBlockMeta } from './block/taskBlockMeta.ts'
import { toTaskBlockMeta } from './block/utils.ts'
import { VALUE_BLOCK_ICON, ValueBlockMeta } from './block/valueBlockMeta.ts'

const NodeMetaKind: unique symbol = Symbol('NodeMeta')
type NodeMetaKind = typeof NodeMetaKind

export interface ResolveSharedBlockMeta$ {
  (blockResourceName: BlockResourceName, blockType: 'task'): ReadonlyVal<TaskBlockMeta | undefined>
  (blockResourceName: BlockResourceName, blockType: 'subflow'): ReadonlyVal<SubflowBlockMeta | undefined>
  (blockResourceName: BlockResourceName, blockType: SharedBlockType): ReadonlyVal<SharedBlockMeta | undefined>
}

export type NodeRefBlockMeta = SharedBlockMeta | InlineTaskBlockMeta | ValueBlockMeta | ConditionBlockMeta

export interface NodeMeta$ {
  readonly blockMeta: ReadonlyVal<NodeRefBlockMeta | undefined>
  /** Resolved icon URI */
  readonly icon: ReadonlyVal<string | undefined>
  /** Resolved title */
  readonly title: ReadonlyVal<string | undefined>
  /** Resolved description */
  readonly description: ReadonlyVal<string | undefined>

  readonly inputHandleDefs: ReadonlyVal<InputHandleDef[] | undefined>
  readonly additionalInputDefs: ReadonlyVal<InputHandleDef[] | undefined>
  readonly additionalOutputDefs: ReadonlyVal<OutputHandleDef[] | undefined>
  readonly outputHandleDefs: ReadonlyVal<OutputHandleDef[] | undefined>
  /** `inputHandleDefs` + `additionalInputDefs` */
  readonly allInputHandleDefs: ReadonlyVal<InputHandleDef[] | undefined>
  readonly allInputHandleNames: ReadonlyVal<HandleName[]>
  /** `outputHandleDefs` + `additionalOutputDefs` */
  readonly allOutputHandleDefs: ReadonlyVal<OutputHandleDef[] | undefined>
  readonly allOutputHandleNames: ReadonlyVal<HandleName[]>

  readonly connectedOutputHandles: ReadonlyVal<HandleName[] | undefined>
  readonly triggerDefinition: ReadonlyVal<TriggerDefinition | undefined>

  /** Valid inputs_from entries after reference filtering. */
  readonly handleInputsFrom: ReadonlyVal<readonly HandleInputFrom[] | undefined>
  /** Absolute file path to scriptlet file, will be undefined if not inlined block. */
  readonly scriptletEntry: ReadonlyVal<string | undefined>
}

export interface NodeMeta$$ {
  readonly additionalInputDefs: Val<InputHandleDef[] | undefined>
  readonly additionalOutputDefs: Val<OutputHandleDef[] | undefined>
}

export class NodeMeta<TNodeManifest extends WritableNodeManifest = WritableNodeManifest> {
  public readonly KIND: Record<NodeMetaKind, boolean> = {
    [NodeMetaKind]: true,
  }

  public static is(nodeMeta: any): nodeMeta is NodeMeta {
    return nodeMeta?.KIND?.[NodeMetaKind] === true
  }

  public static to(nodeMeta: any): NodeMeta | undefined {
    if (NodeMeta.is(nodeMeta)) {
      return nodeMeta as NodeMeta
    }
  }

  public readonly dispose: DisposableStore = disposableStore()

  public readonly nodeId: NodeId

  public readonly $: NodeMeta$
  public readonly $$: NodeMeta$$

  public constructor(
    public readonly flowLikeMeta: FlowLikeMeta,
    public readonly manifest: TNodeManifest,
    private readonly isNodeOutputHandleExist$: (nodeId: NodeId, outputHandle: HandleName) => ReadonlyVal<boolean>,
    resolveResourceUri: ResourceUriResolver,
    resolveSharedBlockMeta$: ResolveSharedBlockMeta$,
  ) {
    this.dispose.add(manifest)
    this.nodeId = manifest.nodeId

    const blockMeta$ = this.dispose.add(
      compute((get) => {
        if (isSubflowNodeManifest(manifest)) {
          const subflow = get(manifest.$.subflow)
          if (subflow) {
            return get(resolveSharedBlockMeta$(subflow, 'subflow'))
          }
        }
        if (isTaskNodeManifest(manifest)) {
          const task = get(manifest.$.task)
          const inlineTask = WritableInlineTaskBlockManifest.to(task)
          if (inlineTask) {
            return new InlineTaskBlockMeta(this.flowLikeMeta.manifestPath, this.flowLikeMeta.searchPath, inlineTask, this.flowLikeMeta.packageMeta)
          }
          if (typeof task == 'string') {
            return get(resolveSharedBlockMeta$(task, 'task'))
          }
        } else if (isValueNodeManifest(manifest)) {
          const values = get(manifest.$.values)
          if (WritableValueBlockManifest.is(values)) {
            return new ValueBlockMeta({
              manifest: values,
              packageMeta: this.flowLikeMeta.packageMeta,
            })
          }
        } else if (isConditionNodeManifest(manifest)) {
          const conditions = get(manifest.$.conditions)
          if (WritableConditionBlockManifest.is(conditions)) {
            return new ConditionBlockMeta({
              manifest: conditions,
              packageMeta: this.flowLikeMeta.packageMeta,
              inputHandleDefs$: manifest.$.inputs_def,
            })
          }
        }
      }),
    )

    const inputHandleDefs$ = this.dispose.add(
      flatten(blockMeta$, (blockMeta) => (ValueBlockMeta.is(blockMeta) ? blockMeta.manifest.$.values : blockMeta?.$.inputHandleDefs)),
    )

    const additionalInputDefs$ = this.dispose.add(
      compute((get) => {
        if (!isTaskNodeManifest(manifest)) return

        const blockAdditionalInputs = get(toTaskBlockMeta(get(blockMeta$))?.manifest.$.additional_inputs)
        if (!blockAdditionalInputs) return

        const defs = get(manifest.$.inputs_def)
        if (!defs) return

        if (blockAdditionalInputs === true) return defs

        return defs.map((def) =>
          Object.assign({}, blockAdditionalInputs, {
            value: def.value,
            handle: def.handle,
            description: def.description,
          }),
        )
      }),
    )

    const additionalOutputDefs$ = this.dispose.add(
      compute((get) => {
        if (!isTaskNodeManifest(manifest)) return

        const blockAdditionalOutputs = get(toTaskBlockMeta(get(blockMeta$))?.manifest.$.additional_outputs)
        if (!blockAdditionalOutputs) return

        const defs = get(manifest.$.outputs_def)
        if (!defs) return

        if (blockAdditionalOutputs === true) return defs

        return defs.map((def) =>
          Object.assign({}, blockAdditionalOutputs, {
            handle: def.handle,
            description: def.description,
          }),
        )
      }),
    )

    const triggerDefinition$ = this.dispose.add(
      isTriggerNodeManifest(manifest) ? flowLikeMeta.triggerDefinition$(manifest.$.trigger) : val<TriggerDefinition | undefined>(),
    )

    const outputHandleDefs$ = this.dispose.add(
      isTriggerNodeManifest(manifest)
        ? derive(
            triggerDefinition$,
            (definition): OutputHandleDef[] | undefined =>
              definition == null ? undefined : definition.outputs.map((port) => ({ ...port, handle: port.handle as HandleName })),
            { equal: isEqual },
          )
        : flatten(blockMeta$, (blockMeta) => (ValueBlockMeta.is(blockMeta) ? blockMeta.manifest.$.values : blockMeta?.$.outputHandleDefs)),
    )

    const allInputHandleDefs$ = this.dispose.add(
      combine(
        [inputHandleDefs$, additionalInputDefs$],
        ([defs, additionalDefs]): InputHandleDef[] | undefined => {
          if (!defs) return additionalDefs
          if (!additionalDefs) return defs
          return defs.concat(additionalDefs)
        },
        { equal: arrayShallowEqual },
      ),
    )

    const allInputHandleNames$ = this.dispose.add(derive(allInputHandleDefs$, getHandleNames, { equal: arrayShallowEqual }))

    const allOutputHandleDefs$ = this.dispose.add(
      combine(
        [outputHandleDefs$, additionalOutputDefs$],
        ([defs, additionalDefs]): OutputHandleDef[] | undefined => {
          if (!defs) return additionalDefs
          if (!additionalDefs) return defs
          return defs.concat(additionalDefs)
        },
        { equal: arrayShallowEqual },
      ),
    )

    const allOutputHandleNames$ = this.dispose.add(derive(allOutputHandleDefs$, getHandleNames, { equal: arrayShallowEqual }))

    // This filters invalid input targets. Edge creation validates invalid sources.
    const handleInputsFrom$ = this.dispose.add(
      compute((get) => {
        const inputsFrom = get(manifest.$.inputs_from)
        if (!inputsFrom?.length) return

        const allInputNames = get(allInputHandleNames$)
        if (!allInputNames.length) return

        return inertFilterMap(inputsFrom, (inf) => (allInputNames.includes(inf.handle) ? this.sanitizeInputsFrom(inf, get) : undefined))
      }),
    )

    const connectedOutputHandles$ = this.dispose.add(
      compute(
        (get) => {
          const allOutputNames = get(allOutputHandleNames$)
          if (!allOutputNames.length) return

          let result: HandleName[] | undefined

          const extract = (inoutFrom?: readonly (HandleInputFrom | HandleOutputFrom)[] | undefined) => {
            if (inoutFrom) {
              for (const inf of inoutFrom) {
                if (inf.from_node) {
                  for (const fromNode of inf.from_node) {
                    if (fromNode.node_id === this.nodeId) {
                      if (allOutputNames.includes(fromNode.output_handle)) {
                        ;(result ??= []).push(fromNode.output_handle)
                      }
                    }
                  }
                }
              }
            }
          }

          for (const nodeMeta of get(flowLikeMeta.nodes).values()) {
            extract(get(nodeMeta.$.handleInputsFrom))
          }

          extract(get(flowLikeMeta.$.handleOutputsFrom))

          return result
        },
        { equal: isEqual },
      ),
    )

    const scriptletEntry$ = this.dispose.add(
      compute((get) => {
        const blockMeta = get(blockMeta$)
        if (InlineTaskBlockMeta.is(blockMeta)) {
          const executorOptions = get(blockMeta.manifest.$.executor)?.options as { source?: string; language?: string; entry?: string } | undefined

          const absoluteEntry =
            executorOptions?.entry && (isAbsolute(executorOptions.entry) ? executorOptions.entry : join(this.flowLikeMeta.manifestDir, executorOptions.entry))

          const isScriptlet = absoluteEntry && isParent(absoluteEntry, join(this.flowLikeMeta.manifestDir, scriptletDirectory))
          if (isScriptlet) return absoluteEntry
        }
      }),
    )

    this.$$ = {
      additionalInputDefs: attachSetter(additionalInputDefs$, (defs) => {
        if (!WritableTaskNodeManifest.is(manifest)) return

        const blockAdditionalInputs = toTaskBlockMeta(blockMeta$.value)?.manifest.$.additional_inputs.value
        if (!blockAdditionalInputs) {
          manifest.$$.inputs_def.set(undefined)
          return
        }

        if (blockAdditionalInputs === true) {
          manifest.$$.inputs_def.set(defs)
          return
        }

        manifest.$$.inputs_def.set(
          defs?.map((def) => ({
            value: def.value,
            handle: def.handle,
            description: def.description,
          })),
        )
      }),
      additionalOutputDefs: attachSetter(additionalOutputDefs$, (defs) => {
        if (!WritableTaskNodeManifest.is(manifest)) return

        const blockAdditionalOutputs = toTaskBlockMeta(blockMeta$.value)?.manifest.$.additional_outputs.value
        if (!blockAdditionalOutputs) {
          manifest.$$.outputs_def.set(undefined)
          return
        }

        if (blockAdditionalOutputs === true) {
          manifest.$$.outputs_def.set(defs)
          return
        }

        manifest.$$.outputs_def.set(
          defs?.map((def) => ({
            handle: def.handle,
            description: def.description,
          })),
        )
      }),
    }

    const icon$ = this.dispose.add(
      compute((get) => {
        const icon = get(manifest.$.icon)
        if (icon) {
          return resolveResourceUri(icon, this.flowLikeMeta.manifestPath, this.flowLikeMeta.searchPath)
        }

        const blockMeta = get(blockMeta$)
        if (blockMeta) {
          if (ValueBlockMeta.is(blockMeta)) {
            return VALUE_BLOCK_ICON
          }

          if (ConditionBlockMeta.is(blockMeta)) {
            return CONDITION_BLOCK_ICON
          }

          if (isSharedBlockMeta(blockMeta)) {
            return get(blockMeta.$.icon)
          }
        }
      }),
    )

    const explicitTitle$ = this.flowLikeMeta.packageMeta.l10n.display$(manifest.$.title)
    const title$ = isTriggerNodeManifest(manifest)
      ? this.dispose.add(
          compute((get) => {
            const title = get(explicitTitle$)
            return title || get(triggerDefinition$)?.name
          }),
        )
      : explicitTitle$
    if (title$ !== explicitTitle$) this.dispose.add(explicitTitle$)
    const description$ = this.dispose.add(this.flowLikeMeta.packageMeta.l10n.display$(manifest.$.description))

    this.$ = {
      inputHandleDefs: inputHandleDefs$,
      outputHandleDefs: outputHandleDefs$,
      handleInputsFrom: handleInputsFrom$,
      scriptletEntry: scriptletEntry$,
      additionalInputDefs: additionalInputDefs$,
      additionalOutputDefs: additionalOutputDefs$,
      allInputHandleNames: allInputHandleNames$,
      allOutputHandleNames: allOutputHandleNames$,
      allInputHandleDefs: allInputHandleDefs$,
      allOutputHandleDefs: allOutputHandleDefs$,
      connectedOutputHandles: connectedOutputHandles$,
      triggerDefinition: triggerDefinition$,
      icon: icon$,
      title: title$,
      description: description$,
      blockMeta: blockMeta$,
    }
  }

  public isScriptlet(): boolean {
    return !!this.$.scriptletEntry.value
  }

  private sanitizeInputsFrom(inf: HandleInputFrom, get: ComputeGet): HandleInputFrom {
    if (inf.from_node) {
      const fromNode = inertFilterMap(inf.from_node, (f) => {
        const outputDefFound = get(this.isNodeOutputHandleExist$(f.node_id, f.output_handle))

        if (!outputDefFound) return undefined

        return f
      })

      if (fromNode !== inf.from_node) {
        inf = {
          ...inf,
          from_node: fromNode,
        }
      }
    }

    if (inf.from_flow) {
      const inputHandleNames = get(this.flowLikeMeta.$.inputHandleDefs)?.map((def) => def.handle)

      const fromFlow = inertFilterMap(inf.from_flow, (f) => {
        if (!inputHandleNames?.includes(f.input_handle)) return undefined
        return f
      })

      if (fromFlow !== inf.from_flow) {
        inf = {
          ...inf,
          from_flow: fromFlow,
        }
      }
    }

    return inf
  }

  public toJSON(): object {
    return this.manifest.toJSON()
  }
}
