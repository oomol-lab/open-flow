import type { DisposableStore } from '@wopjs/disposable'
import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { BlockResourceName } from '../../../manifest/common/manifestTypes.ts'
import type { FlowLikeMeta } from '../../../manifest/common/meta/flowLike/flowLikeMeta.ts'
import type { NodeMeta } from '../../../manifest/common/meta/nodeMeta.ts'
import type { HandleName, NodeId } from '../../../schema/index.ts'
import type { PackageAuthoring } from '../../common/packageAuthoring.ts'
import type { DesignerResourceService } from '../resourceService.ts'
import type { CreateScriptletEditorFn } from '../services/designerService.ts'
import type { DesignerStore } from '../stores/designer/designer.store.ts'
import type { DesignerUIStore } from '../stores/designer/designerUI.store.ts'
import type { FlowRunStatus } from '../stores/designer/typings.ts'
import type { NodeStatus } from '../stores/node/constants.ts'
import type { NodeStore } from '../stores/node/node.store.ts'
import type { InlineTask } from '../stores/node/taskNode.store.ts'

import { coalesce, isDefined, isString, toPlainObject, toString, toTrue } from '@wopjs/cast'
import { disposableStore } from '@wopjs/disposable'
import { WeakCache } from '@wopjs/weak-cache'
import { arrayShallowEqual, attachSetter, combine, compute, derive, val } from 'value-enhancer'
import { ConditionBlockMeta } from '../../../manifest/common/meta/block/conditionBlockMeta.ts'
import { InlineTaskBlockMeta } from '../../../manifest/common/meta/block/inlineTaskBlockMeta.ts'
import { SubflowBlockMeta } from '../../../manifest/common/meta/block/subflowBlockMeta.ts'
import { TaskBlockMeta } from '../../../manifest/common/meta/block/taskBlockMeta.ts'
import { ValueBlockMeta } from '../../../manifest/common/meta/block/valueBlockMeta.ts'
import { isTaskBlockManifest } from '../../../manifest/common/model/block/task/taskBlockManifest.ts'
import { isTaskNodeManifest } from '../../../manifest/common/model/node/taskNodeManifest.ts'
import { WritableConditionNodeManifest } from '../../../manifest/common/writable/node/writableConditionNodeManifest.ts'
import { WritableSubflowNodeManifest } from '../../../manifest/common/writable/node/writableSubflowNodeManifest.ts'
import { WritableTaskNodeManifest } from '../../../manifest/common/writable/node/writableTaskNodeManifest.ts'
import { WritableTriggerNodeManifest } from '../../../manifest/common/writable/node/writableTriggerNodeManifest.ts'
import { WritableValueNodeManifest } from '../../../manifest/common/writable/node/writableValueNodeManifest.ts'
import { FLOW_RUN_STATUS } from '../stores/designer/typings.ts'
import { ConditionNodeStore } from '../stores/node/conditionNode.store.ts'
import { NODE_STATUS } from '../stores/node/constants.ts'
import { ErrorNodeStore } from '../stores/node/errorNode.store.ts'
import { ConditionsSectionStore } from '../stores/node/nodeSection/conditionsSection.store.ts'
import { InputSectionStore } from '../stores/node/nodeSection/inputSection.store.ts'
import { OutputSectionStore } from '../stores/node/nodeSection/outputSection.store.ts'
import { ScriptletSectionStore } from '../stores/node/nodeSection/scriptletSection.store.ts'
import { TriggerSectionStore } from '../stores/node/nodeSection/triggerSection.store.ts'
import { ValueSectionStore } from '../stores/node/nodeSection/valueSection.store.ts'
import { SubflowNodeStore } from '../stores/node/subflowNode.store.ts'
import { TaskNodeStore } from '../stores/node/taskNode.store.ts'
import { TriggerNodeStore } from '../stores/node/triggerNode.store.ts'
import { ValueNodeStore } from '../stores/node/valueNode.store.ts'

export interface CreateNodeStoreContext {
  readonly i18n: I18n
  readonly dark: ReadonlyVal<boolean>
  readonly flowLikeMeta: FlowLikeMeta
  readonly designerStore: DesignerStore
  readonly readonly: boolean

  readonly resourceService: DesignerResourceService
  readonly packageAuthoring: PackageAuthoring

  readonly execute?: (nodeId: NodeId, withCache: boolean) => Promise<void>
  readonly openSharedTaskSource?: (blockMeta: TaskBlockMeta) => Promise<void>
  readonly openInlineTaskEntry?: (blockMeta: InlineTaskBlockMeta) => Promise<void>
  readonly openBlockDesigner?: (blockMeta: TaskBlockMeta | SubflowBlockMeta) => void

  readonly createSchemaEditor: (dom: HTMLDivElement, schema$: Val<string> | ReadonlyVal<string>) => () => void
  readonly createScriptletEditor?: CreateScriptletEditorFn
}

const cacheKey = /*#__PURE__*/ Symbol.for('nodeStoreCache')

function getCache(designerStore: DesignerStore): WeakCache<NodeId, NodeMeta> {
  return ((designerStore as any)[cacheKey] ??= new WeakCache<NodeId, NodeMeta>())
}

export function migrateNodeStores(ctx: CreateNodeStoreContext): void {
  const { designerStore, flowLikeMeta: flowMeta } = ctx
  const cache = getCache(designerStore)
  const nss = new Map<NodeId, NodeStore>()
  for (const nodeMeta of flowMeta.nodes.values()) {
    const origNodeStore = designerStore.$.nodes.get(nodeMeta.nodeId)
    const origNodeMeta = cache.get(nodeMeta.nodeId)
    if (!origNodeStore || origNodeMeta !== nodeMeta) {
      cache.set(nodeMeta.nodeId, nodeMeta)
      nss.set(nodeMeta.nodeId, createNodeStore(ctx, nodeMeta, flowMeta))
    } else {
      nss.set(nodeMeta.nodeId, origNodeStore)
    }
  }
  designerStore.$$.nodes.replace(nss)
}

export function createNodeStore(ctx: CreateNodeStoreContext, nodeMeta: NodeMeta, flowLikeMeta: FlowLikeMeta): NodeStore {
  if (WritableTriggerNodeManifest.is(nodeMeta.manifest)) {
    return createTriggerNodeStore(ctx, nodeMeta)
  }

  const blockMeta = nodeMeta.$.blockMeta.value

  if (!isDefined(blockMeta)) {
    return createErrorNodeStore(nodeMeta.nodeId, ctx.i18n.t('errorNode.blockNotFound'), ctx.designerStore.designerUIStore, flowLikeMeta)
  }

  if (ValueBlockMeta.is(blockMeta)) {
    return createValueNodeStore(ctx, nodeMeta, blockMeta)
  }

  if (ConditionBlockMeta.is(blockMeta)) {
    return createConditionNodeStore(ctx, nodeMeta, blockMeta)
  }

  if (SubflowBlockMeta.is(blockMeta)) {
    return createSubflowNodeStore(ctx, nodeMeta, blockMeta)
  }

  const nodeManifest = nodeMeta.manifest
  if (isTaskNodeManifest(nodeManifest) && (TaskBlockMeta.is(blockMeta) || InlineTaskBlockMeta.is(blockMeta))) {
    return createTaskNodeStore(ctx, nodeMeta, blockMeta)
  }

  return createErrorNodeStore(nodeMeta.nodeId, ctx.i18n.t('errorNode.unsupportedNode'), ctx.designerStore.designerUIStore, flowLikeMeta)
}

function createTriggerNodeStore(ctx: CreateNodeStoreContext, nodeMeta: NodeMeta): TriggerNodeStore {
  const subscriptions = disposableStore()
  const nodeManifest = nodeMeta.manifest
  if (!WritableTriggerNodeManifest.is(nodeManifest)) {
    throw new Error(`Expected a Trigger manifest for node "${nodeMeta.nodeId}".`)
  }
  const uiSectionsState = toPlainObject(ctx.designerStore.designerUIStore.peekNodeUIData(nodeMeta.nodeId))?.sections
  const showSettings$ = val()
  const triggerSectionStore = subscriptions.add(
    new TriggerSectionStore({
      createSchemaEditor: ctx.createSchemaEditor,
      definition: nodeMeta.$.triggerDefinition,
      initialUIState: toPlainObject(uiSectionsState?.[TriggerSectionStore.TYPE]),
      lang: ctx.i18n.lang$,
      showSettings: showSettings$,
      trigger: nodeManifest.$$.trigger.ref(true),
      userLocales: nodeMeta.flowLikeMeta.packageMeta.l10n.designerLocales,
    }),
  )
  const outputSectionStore = subscriptions.add(
    new OutputSectionStore({
      createSchemaEditor: ctx.createSchemaEditor,
      handleOutputsTo: nodeMeta.$.connectedOutputHandles.ref(),
      initialUIState: toPlainObject(uiSectionsState?.[OutputSectionStore.TYPE]),
      lang: ctx.i18n.lang$,
      outputHandleDefs: nodeMeta.$.allOutputHandleDefs.ref(),
      role: 'guest',
      showSettings: showSettings$,
      userLocales: nodeMeta.flowLikeMeta.packageMeta.l10n.designerLocales,
    }),
  )
  const nodeStore = new TriggerNodeStore(nodeMeta.nodeId, {
    manifest$: {
      description: nodeManifest.$$.description.ref(true),
      icon: nodeManifest.$$.icon.ref(true),
      title: nodeManifest.$$.title.ref(true),
      trigger: nodeManifest.$$.trigger.ref(true),
    },
    display$: {
      description: nodeMeta.$.description.ref(),
      icon: nodeMeta.$.icon.ref(),
      ignore: nodeManifest.$$.ignore.ref(true),
      inputs_def: val(),
      outputs_def: nodeMeta.$.allOutputHandleDefs.ref(),
      progress: val(),
      sections: val([triggerSectionStore, outputSectionStore]),
      showSettings: showSettings$,
      status: val<NodeStatus>(NODE_STATUS.Idle),
      title: nodeMeta.$.title.ref(),
      trigger: triggerSectionStore.trigger$,
    },
    designerUIStore: ctx.designerStore.designerUIStore,
    duplicateNode: toTrue(!ctx.readonly && ctx.designerStore.onDuplicate) && ctx.designerStore.duplicateNodes.bind(ctx.designerStore, [nodeMeta.nodeId]),
  })
  nodeStore.dispose.add(subscriptions)
  return nodeStore
}

function createErrorNodeStore(nodeId: NodeId, error: string, designerUIStore: DesignerUIStore, flowLikeMeta: FlowLikeMeta) {
  // Infer error-node output handles from the other nodes.
  const outputHandles$ = compute(
    (get) => {
      const outputHandles: HandleName[] = []
      for (const nodeMeta of get(flowLikeMeta.nodes).values()) {
        const inputsFrom = get(nodeMeta.$.handleInputsFrom)
        if (inputsFrom) {
          for (const f of inputsFrom) {
            if (f.from_node) {
              for (const n of f.from_node) {
                if (n.node_id === nodeId) {
                  outputHandles.push(n.output_handle)
                }
              }
            }
          }
        }
      }
      return outputHandles
    },
    { equal: arrayShallowEqual },
  )

  return new ErrorNodeStore(nodeId, {
    error: error,
    designerUIStore,
    outputHandles: outputHandles$,
  })
}

function createValueNodeStore(ctx: CreateNodeStoreContext, nodeMeta: NodeMeta, blockMeta: ValueBlockMeta) {
  const subscriptions = disposableStore()

  const nodeManifest = nodeMeta.manifest
  if (!WritableValueNodeManifest.is(nodeManifest)) {
    throw new Error(`Expected a value manifest for node "${nodeMeta.nodeId}".`)
  }
  const blockManifest = blockMeta.manifest

  const uiSectionsState = toPlainObject(toPlainObject(ctx.designerStore.designerUIStore.peekNodeUIData(nodeMeta.nodeId))?.sections)
  const showSettings$ = val()

  const valueSectionStore = subscriptions.add(
    new ValueSectionStore({
      handleOutputsTo: nodeMeta.$.connectedOutputHandles.ref(),
      lang: ctx.i18n.lang$,
      userLocales: blockMeta.packageMeta.l10n.designerLocales,
      role: ctx.readonly ? 'guest' : 'author',
      valueHandleDefs: blockManifest.$.values,
      initialUIState: toPlainObject(uiSectionsState?.[ValueSectionStore.TYPE]),
      showSettings: showSettings$,
      createSchemaEditor: ctx.createSchemaEditor,
    }),
  )
  subscriptions.add(
    valueSectionStore.onDidHandleRename((data) => {
      ctx.packageAuthoring.propagateHandleRename(blockMeta, 'output', data)
    }),
  )

  const nodeStore = new ValueNodeStore(nodeMeta.nodeId, {
    manifest$: {
      icon: nodeManifest.$$.icon.ref(true),
      title: nodeManifest.$$.title.ref(true),
      description: nodeManifest.$$.description.ref(true),
    },
    display$: {
      icon: nodeMeta.$.icon.ref(),
      title: nodeMeta.$.title.ref(),
      description: nodeMeta.$.description.ref(),
      // Value nodes have no runtime state.
      status: val<NodeStatus>(NODE_STATUS.Idle),
      progress: val(),
      showSettings: showSettings$,
      sections: val([valueSectionStore]),
      inputs_def: blockManifest.$.values,
      outputs_def: blockManifest.$.values,
      ignore: nodeManifest.$$.ignore.ref(true),
    },
    designerUIStore: ctx.designerStore.designerUIStore,
    duplicateNode: toTrue(!ctx.readonly && ctx.designerStore.onDuplicate) && ctx.designerStore.duplicateNodes.bind(ctx.designerStore, [nodeMeta.nodeId]),
  })

  nodeStore.dispose.add(subscriptions)

  return nodeStore
}

function createConditionNodeStore(ctx: CreateNodeStoreContext, nodeMeta: NodeMeta, blockMeta: ConditionBlockMeta) {
  const subscriptions = disposableStore()

  const nodeManifest = nodeMeta.manifest
  if (!WritableConditionNodeManifest.is(nodeManifest)) {
    throw new Error(`Expected a condition manifest for node "${nodeMeta.nodeId}".`)
  }
  const blockManifest = blockMeta.manifest

  const uiSectionsState = toPlainObject(toPlainObject(ctx.designerStore.designerUIStore.peekNodeUIData(nodeMeta.nodeId))?.sections)
  const showSettings$ = val()

  //#region Sections
  const inputSectionStore = subscriptions.add(
    new InputSectionStore({
      lang: ctx.i18n.lang$,
      userLocales: blockMeta.packageMeta.l10n.designerLocales,
      role: ctx.readonly ? 'guest' : 'author',
      handleInputsFrom: attachSetter(nodeMeta.$.handleInputsFrom.ref(), nodeManifest.$$.inputs_from.set),
      inputHandleDefs: nodeManifest.$$.inputs_def.ref(true),
      initialUIState: toPlainObject(uiSectionsState?.[InputSectionStore.TYPE]),
      showSettings: showSettings$,
      createSchemaEditor: ctx.createSchemaEditor,
    }),
  )

  const conditionsSectionStore = subscriptions.add(
    new ConditionsSectionStore({
      handleOutputsTo: nodeMeta.$.connectedOutputHandles.ref(),
      lang: ctx.i18n.lang$,
      userLocales: blockMeta.packageMeta.l10n.designerLocales,
      role: ctx.readonly ? 'guest' : 'author',
      inputHandleDefs: blockMeta.$.inputHandleDefs,
      conditionHandleDefs: blockManifest.$$.cases.ref(true),
      defaultConditionHandleDef: blockManifest.$$.default.ref(true),
      initialUIState: toPlainObject(uiSectionsState?.[ConditionsSectionStore.TYPE]),
      showSettings: showSettings$,
    }),
  )
  subscriptions.add(
    conditionsSectionStore.onDidHandleRename((data) => {
      ctx.packageAuthoring.propagateHandleRename(blockMeta, 'output', data)
    }),
  )
  //#endregion

  const nodeStore = new ConditionNodeStore(nodeMeta.nodeId, {
    manifest$: {
      icon: nodeManifest.$$.icon.ref(true),
      title: nodeManifest.$$.title.ref(true),
      description: nodeManifest.$$.description.ref(true),
      progressWeight: nodeManifest.$$.progress_weight.ref(true),
    },
    display$: {
      icon: nodeMeta.$.icon.ref(),
      title: nodeMeta.$.title.ref(),
      description: nodeMeta.$.description.ref(),
      progressWeight: nodeManifest.$.progress_weight.ref(),
      status: createNodeStatus$(ctx.designerStore.$.runStatus, subscriptions),
      progress: val(),
      successCount: val(),
      showSettings: showSettings$,
      sections: val(coalesce([inputSectionStore, conditionsSectionStore])),
      inputs_def: nodeManifest.$.inputs_def,
      outputs_def: blockMeta.$.outputHandleDefs,
      inputs_from: nodeMeta.$.handleInputsFrom.ref(),
      ignore: nodeManifest.$$.ignore.ref(true),
    },
    designerUIStore: ctx.designerStore.designerUIStore,
    duplicateNode: toTrue(!ctx.readonly && ctx.designerStore.onDuplicate) && ctx.designerStore.duplicateNodes.bind(ctx.designerStore, [nodeMeta.nodeId]),
  })

  nodeStore.dispose.add(subscriptions)

  return nodeStore
}

function createSubflowNodeStore(ctx: CreateNodeStoreContext, subflowNodeMeta: NodeMeta, subflowBlockMeta: SubflowBlockMeta) {
  const subscriptions = disposableStore()

  const nodeManifest = subflowNodeMeta.manifest
  if (!WritableSubflowNodeManifest.is(nodeManifest)) {
    throw new Error(`Expected a subflow manifest for node "${subflowNodeMeta.nodeId}".`)
  }
  const blockManifest = subflowBlockMeta.manifest

  const uiSectionsState = toPlainObject(toPlainObject(ctx.designerStore.designerUIStore.peekNodeUIData(subflowNodeMeta.nodeId))?.sections)
  const showSettings$ = val()

  //#region Sections
  const inputSectionStore = subscriptions.add(
    new InputSectionStore({
      lang: ctx.i18n.lang$,
      userLocales: subflowBlockMeta.packageMeta.l10n.designerLocales,
      role: ctx.readonly ? 'guest' : 'user',
      handleInputsFrom: attachSetter(subflowNodeMeta.$.handleInputsFrom.ref(), nodeManifest.$$.inputs_from.set),
      inputHandleDefs: blockManifest.$$.inputs_def.ref(true),
      initialUIState: toPlainObject(uiSectionsState?.[InputSectionStore.TYPE]),
      showSettings: showSettings$,
      createSchemaEditor: ctx.createSchemaEditor,
    }),
  )

  const outputSectionStore = subscriptions.add(
    new OutputSectionStore({
      lang: ctx.i18n.lang$,
      userLocales: subflowBlockMeta.packageMeta.l10n.designerLocales,
      role: ctx.readonly ? 'guest' : 'user',
      handleOutputsTo: subflowNodeMeta.$.connectedOutputHandles.ref(),
      outputHandleDefs: blockManifest.$$.outputs_def.ref(true),
      initialUIState: toPlainObject(uiSectionsState?.[OutputSectionStore.TYPE]),
      showSettings: showSettings$,
      createSchemaEditor: ctx.createSchemaEditor,
    }),
  )

  subscriptions.add(
    outputSectionStore.onDidHandleRename((data) => {
      ctx.packageAuthoring.propagateHandleRename(subflowBlockMeta, 'output', data)
    }),
  )

  //#endregion

  const nodeStatus$ = createNodeStatus$(ctx.designerStore.$.runStatus, subscriptions)

  const subflowNodeStore = new SubflowNodeStore(subflowNodeMeta.nodeId, {
    manifest$: {
      icon: nodeManifest.$$.icon.ref(true),
      title: nodeManifest.$$.title.ref(true),
      description: nodeManifest.$$.description.ref(true),
      timeout: nodeManifest.$$.timeout.ref(true),
      concurrency: nodeManifest.$$.concurrency.ref(true),
      progressWeight: nodeManifest.$$.progress_weight.ref(true),
    },
    display$: {
      icon: subflowNodeMeta.$.icon.ref(),
      title: subflowNodeMeta.$.title.ref(),
      description: subflowNodeMeta.$.description.ref(),
      timeout: nodeManifest.$.timeout.ref(),
      concurrency: nodeManifest.$.concurrency.ref(),
      progressWeight: nodeManifest.$.progress_weight.ref(),
      status: nodeStatus$,
      progress: val(),
      successCount: val(),
      showSettings: showSettings$,
      sections: compute(() => coalesce([inputSectionStore, outputSectionStore]), { equal: arrayShallowEqual }),
      inputs_def: blockManifest.$.inputs_def.ref(),
      outputs_def: blockManifest.$.outputs_def.ref(),
      inputs_from: subflowNodeMeta.$.handleInputsFrom.ref(),
      subflow: nodeManifest.$.subflow.ref(),
      ignore: nodeManifest.$$.ignore.ref(true),
    },
    designerUIStore: ctx.designerStore.designerUIStore,
    duplicateNode: toTrue(!ctx.readonly && ctx.designerStore.onDuplicate) && ctx.designerStore.duplicateNodes.bind(ctx.designerStore, [subflowNodeMeta.nodeId]),
    execute: ctx.execute?.bind(null, subflowNodeMeta.nodeId),
    openBlockDesigner: ctx.openBlockDesigner?.bind(null, subflowBlockMeta),
  })

  subflowNodeStore.dispose.add(subscriptions)

  return subflowNodeStore
}

function createTaskNodeStore(ctx: CreateNodeStoreContext, nodeMeta: NodeMeta, blockMeta: TaskBlockMeta | InlineTaskBlockMeta) {
  const subscriptions = disposableStore()

  const nodeManifest = nodeMeta.manifest
  if (!WritableTaskNodeManifest.is(nodeManifest)) {
    throw new Error(`Expected a task manifest for node "${nodeMeta.nodeId}".`)
  }
  const blockManifest = blockMeta.manifest
  const taskBlockManifest = isTaskBlockManifest(blockManifest) ? blockManifest : undefined
  const canDuplicate = !ctx.readonly && (!InlineTaskBlockMeta.is(blockMeta) || !nodeMeta.$.scriptletEntry.value || ctx.packageAuthoring.canWriteScriptlets)

  const role = InlineTaskBlockMeta.is(blockMeta) ? 'author' : 'user'
  const uiSectionsState = toPlainObject(toPlainObject(ctx.designerStore.designerUIStore.peekNodeUIData(nodeMeta.nodeId))?.sections)
  const showSettings$ = val()

  //#region Sections
  const inputSectionStore = subscriptions.add(
    new InputSectionStore({
      lang: ctx.i18n.lang$,
      userLocales: blockMeta.packageMeta.l10n.designerLocales,
      role: ctx.readonly ? 'guest' : role,
      handleInputsFrom: attachSetter(nodeMeta.$.handleInputsFrom.ref(), nodeManifest.$$.inputs_from.set),
      inputHandleDefs: blockManifest.$$.inputs_def.ref(true),
      additionalInputs: taskBlockManifest?.$.additional_inputs.ref(),
      additionalInputDefs: nodeMeta.$$.additionalInputDefs.ref(true),
      initialUIState: toPlainObject(uiSectionsState?.[InputSectionStore.TYPE]),
      showSettings: showSettings$,
      createSchemaEditor: ctx.createSchemaEditor,
    }),
  )

  const outputSectionStore = subscriptions.add(
    new OutputSectionStore({
      lang: ctx.i18n.lang$,
      userLocales: blockMeta.packageMeta.l10n.designerLocales,
      role: ctx.readonly ? 'guest' : role,
      handleOutputsTo: nodeMeta.$.connectedOutputHandles.ref(),
      outputHandleDefs: blockManifest.$$.outputs_def.ref(true),
      additionalOutputs: taskBlockManifest?.$.additional_outputs.ref(),
      additionalOutputDefs: nodeMeta.$$.additionalOutputDefs.ref(true),
      initialUIState: toPlainObject(uiSectionsState?.[OutputSectionStore.TYPE]),
      showSettings: showSettings$,
      createSchemaEditor: ctx.createSchemaEditor,
    }),
  )
  const scriptletEntry = InlineTaskBlockMeta.is(blockMeta) ? blockMeta.getScriptletEntryPath() : undefined
  const scriptletSectionStore =
    scriptletEntry && ctx.createScriptletEditor
      ? subscriptions.add(
          new ScriptletSectionStore({
            createEditor: ctx.createScriptletEditor,
            entryPath: scriptletEntry,
            initialUIState: toPlainObject(uiSectionsState?.[ScriptletSectionStore.TYPE]),
            readonly: ctx.readonly,
            typing: blockMeta.$.typing,
          }),
        )
      : undefined
  subscriptions.add(
    outputSectionStore.onDidHandleRename((data) => {
      ctx.packageAuthoring.propagateHandleRename(blockMeta, 'output', data)
    }),
  )

  const nodeStatus$ = createNodeStatus$(ctx.designerStore.$.runStatus, subscriptions)

  const taskNodeStore = new TaskNodeStore(nodeMeta.nodeId, {
    manifest$: {
      icon: nodeManifest.$$.icon.ref(true),
      title: nodeManifest.$$.title.ref(true),
      description: nodeManifest.$$.description.ref(true),
      timeout: nodeManifest.$$.timeout.ref(true),
      concurrency: nodeManifest.$$.concurrency.ref(true),
      progressWeight: nodeManifest.$$.progress_weight.ref(true),
      task: attachSetter(
        derive(nodeManifest.$.task, (task): string | InlineTask | undefined => {
          if (!isDefined(task) || isString(task)) {
            return task
          } else {
            return { executor: task.$$.executor.ref(true) }
          }
        }),
        (task) => {
          if (isString(task)) {
            nodeManifest.$$.task.set(task as BlockResourceName)
          } else {
            console.error(new Error('Should not change task to inline task'))
          }
        },
      ),
    },
    display$: {
      icon: nodeMeta.$.icon.ref(),
      title: nodeMeta.$.title.ref(),
      description: nodeMeta.$.description.ref(),
      task: derive(nodeManifest.$.task, toString),
      executorName: blockMeta.$.executorName.ref(),
      timeout: nodeManifest.$.timeout.ref(),
      concurrency: nodeManifest.$.concurrency.ref(),
      progressWeight: nodeManifest.$.progress_weight.ref(),
      status: nodeStatus$,
      progress: val(),
      successCount: val(),
      showSettings: showSettings$,
      sections: val(coalesce([inputSectionStore, outputSectionStore, scriptletSectionStore]), { equal: arrayShallowEqual }),
      inputs_def: nodeMeta.$.allInputHandleDefs.ref(),
      outputs_def: nodeMeta.$.allOutputHandleDefs.ref(),
      inputs_from: nodeMeta.$.handleInputsFrom.ref(),
      ignore: nodeManifest.$$.ignore.ref(true),
    },
    designerUIStore: ctx.designerStore.designerUIStore,
    duplicateNode: toTrue(canDuplicate && ctx.designerStore.onDuplicate) && ctx.designerStore.duplicateNodes.bind(ctx.designerStore, [nodeMeta.nodeId]),
    execute: ctx.execute?.bind(null, nodeMeta.nodeId),
    openSharedTaskSource: TaskBlockMeta.is(blockMeta) ? ctx.openSharedTaskSource?.bind(null, blockMeta) : undefined,
    openExecutorEntry: InlineTaskBlockMeta.is(blockMeta) ? ctx.openInlineTaskEntry?.bind(null, blockMeta) : undefined,
    openBlockDesigner: TaskBlockMeta.is(blockMeta) ? ctx.openBlockDesigner?.bind(null, blockMeta) : undefined,
  })

  taskNodeStore.dispose.add(subscriptions)

  return taskNodeStore
}

function isNodeRunningOrWaiting(status: NodeStatus): boolean {
  return status === NODE_STATUS.Running || status === NODE_STATUS.Waiting
}

// Stop the node state when the whole flow stops.
function createNodeStatus$(runStatus$: ReadonlyVal<FlowRunStatus>, subscriptions: DisposableStore): Val<NodeStatus> {
  const nodePreferStatus$ = subscriptions.add(val<NodeStatus>(NODE_STATUS.Idle))
  subscriptions.add(
    runStatus$.subscribe((runStatus) => {
      if (runStatus !== FLOW_RUN_STATUS.Running && isNodeRunningOrWaiting(nodePreferStatus$.value)) {
        nodePreferStatus$.set(NODE_STATUS.Idle)
      }
    }),
  )

  const nodeStatus$ = attachSetter(
    combine([runStatus$, nodePreferStatus$], ([runStatus, preferStatus]): NodeStatus => {
      if (runStatus !== FLOW_RUN_STATUS.Running && isNodeRunningOrWaiting(preferStatus)) {
        return NODE_STATUS.Idle
      }
      return preferStatus
    }),
    nodePreferStatus$.set,
  )

  return nodeStatus$
}
