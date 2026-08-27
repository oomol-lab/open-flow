import type { Val } from 'value-enhancer'
import type { BlockName } from '../../../manifest/common/manifestTypes.ts'
import type { SharedBlockMeta } from '../../../manifest/common/meta/block/shared/sharedBlockMeta.ts'
import type { NodeId } from '../../../schema/index.ts'
import type { Viewport } from '../base/compare.ts'
import type { FlowRunStatus } from '../stores/designer/typings.ts'
import type { NodeStatus } from '../stores/node/constants.ts'
import type { NodeShowSettings, NodeStore } from '../stores/node/node.store.ts'
import type { InlineTask } from '../stores/node/taskNode.store.ts'
import type { AbstractDesignerServiceProps } from './designerService.ts'

import { coalesce, noop } from '@wopjs/cast'
import { disposableStore, dispose } from '@wopjs/disposable'
import { attachSetter, derive, val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { TaskBlockMeta } from '../../../manifest/common/meta/block/taskBlockMeta.ts'
import { onTranslationKeyChanged } from '../../../manifest/common/meta/package/userLocaleCleaner.ts'
import { getGroupCollapsed } from '../actions/addNode.ts'
import { setupAutoSaveUIFile } from '../actions/autoSaveUiFile.ts'
import { openSharedTaskSource } from '../actions/taskSourceNavigation.ts'
import { validateSharedBlockName } from '../actions/validation.ts'
import { BlockDesignerStore } from '../stores/designer/blockDesigner.store.ts'
import { DesignerUIStore } from '../stores/designer/designerUI.store.ts'
import { createRFCommand } from '../stores/designer/rfCommand.ts'
import { FLOW_RUN_STATUS } from '../stores/designer/typings.ts'
import { NODE_STATUS } from '../stores/node/constants.ts'
import { ErrorNodeStore } from '../stores/node/errorNode.store.ts'
import { InputSectionStore } from '../stores/node/nodeSection/inputSection.store.ts'
import { OutputSectionStore } from '../stores/node/nodeSection/outputSection.store.ts'
import { TaskNodeStore } from '../stores/node/taskNode.store.ts'
import { AbstractDesignerService } from './designerService.ts'

export type ValidateRenameFn = (newName: string, oldName: string) => string | undefined

export type RenameFn = (oldBlockMeta: SharedBlockMeta, newName: BlockName) => void

export interface TaskBlockDesignerServiceProps extends AbstractDesignerServiceProps {
  readonly runStatus?: Val<FlowRunStatus>
}

export class TaskBlockDesignerService extends AbstractDesignerService {
  private readonly runStatus?: Val<FlowRunStatus>
  private readonly readyByStore = new WeakMap<BlockDesignerStore, Promise<void>>()

  public constructor(props: TaskBlockDesignerServiceProps) {
    super(props)
    this.runStatus = props.runStatus
  }

  // Designer stores own disposable values passed through their props.
  public createTaskBlockDesignerStore(blockMeta: TaskBlockMeta): BlockDesignerStore {
    const nodes = reactiveMap<NodeId, NodeStore>(null, { onDeleted: dispose })

    const viewport = val<Viewport | undefined>(undefined)

    const designerUIStore = new DesignerUIStore({
      viewport,
      nodeStores: nodes,
    })

    const readonly = !this.packageAuthoring.packageMeta.sharedBlocks.sharedBlocksByPath.has(blockMeta.blockPath)

    const miniMapExpanded$ = val<boolean | undefined>(undefined)

    const runStatus$ = this.runStatus ?? val<FlowRunStatus>(FLOW_RUN_STATUS.Idle)

    const blockDesignerStore = new BlockDesignerStore({
      focused$: derive(this.navigation.focusedResource$, (path) => path === blockMeta.blockPath),
      readonly,
      lang$: this.i18n.lang$,
      userLocales: blockMeta.packageMeta.l10n.designerLocales,
      rfCommand: createRFCommand(nodes),
      designerUIStore,
      nodes,
      viewport,
      settingsPanelWidth: val(),
      secretStore: this.secretStore,
      connectorConnections: this.connectorConnections,
      runStatus: runStatus$,
      miniMapExpanded: miniMapExpanded$,
      interactiveMode: this.interactiveMode.ref(true),
      showConfirmDialog: this.confirmation.confirm.bind(this.confirmation),
      validateDirName: validateSharedBlockName.bind(null, this.packageAuthoring, this.i18n),
      onRenameDirName: this.packageAuthoring.canRenameSharedBlocks
        ? (_oldName: string, newName: string) => this.renameTaskBlock(blockMeta, newName as BlockName)
        : undefined,
    })

    blockDesignerStore.dispose.add(blockDesignerStore.onDidChangeTranslateKey(onTranslationKeyChanged.bind(null, this.packageAuthoring.packageMeta)))

    blockDesignerStore.dispose.add([nodes, miniMapExpanded$, runStatus$])

    let disposed = false
    const disposedSignal = Promise.withResolvers<void>()
    blockDesignerStore.dispose.add(() => {
      disposed = true
      disposedSignal.resolve()
    })

    const initialize = async (): Promise<void> => {
      let uiFile: Awaited<ReturnType<TaskBlockDesignerService['loadUIFile']>> | undefined
      try {
        uiFile = await this.loadUIFile(blockMeta.manifestPath)
      } catch (error) {
        console.error(`Failed to load Designer UI data for ${blockMeta.manifestPath}.`, error)
      }
      if (disposed) return

      designerUIStore.loadDesignerUIData(uiFile?.data)
      const nodeStore = this.createNodeStore(designerUIStore, blockMeta, readonly)
      nodes.set(nodeStore.nodeId, nodeStore)

      const manifest = blockMeta.manifest
      if (!readonly) {
        blockDesignerStore.dispose.add(
          nodeStore.uiStore.$.contentWidth.reaction((width) => {
            manifest.$$.ui.set({ ...manifest.$$.ui.value, default_width: width })
          }),
        )
      }

      if (uiFile?.path) {
        const autoSave = blockDesignerStore.dispose.add(
          setupAutoSaveUIFile(this.dirtyResources, blockMeta.manifestPath, uiFile.path, designerUIStore, this.saveUIFile),
        )
        this.pendingSaveUIFiles.set(blockMeta.manifestPath, () => autoSave.flush())
        blockDesignerStore.dispose.add(() => this.pendingSaveUIFiles.delete(blockMeta.manifestPath))
      }
    }
    const ready = Promise.race([initialize(), disposedSignal.promise])
    this.readyByStore.set(blockDesignerStore, ready)

    return blockDesignerStore
  }

  public whenReady(blockDesignerStore: BlockDesignerStore): Promise<void> {
    return this.readyByStore.get(blockDesignerStore) ?? Promise.reject(new Error('Task Designer store was not created by this service.'))
  }

  private createNodeStore(designerUIStore: DesignerUIStore, blockMeta: SharedBlockMeta, readonly: boolean): NodeStore {
    if (TaskBlockMeta.is(blockMeta)) {
      return this.createTaskNodeStore(designerUIStore, blockMeta, readonly)
    }
    return this.createErrorNodeStore(designerUIStore, 'Error')
  }

  private createErrorNodeStore(designerUIStore: DesignerUIStore, blockPath: string, error?: string): ErrorNodeStore {
    return new ErrorNodeStore(blockPath as NodeId, {
      error: error || this.i18n.t('errorNode.blockManifestUnrenderable', { path: blockPath }),
      designerUIStore,
      outputHandles: val([]),
    })
  }

  // Designer stores own disposable values passed through their props.
  private createTaskNodeStore(designerUIStore: DesignerUIStore, blockMeta: TaskBlockMeta, readonly: boolean): TaskNodeStore {
    const subscriptions = disposableStore()
    const blockManifest = blockMeta.manifest
    const showSettings$ = subscriptions.add(val<NodeShowSettings | undefined>({ scope: 'node' }))

    //#region Sections
    const inputSectionStore = subscriptions.add(
      new InputSectionStore({
        lang: this.i18n.lang$,
        userLocales: blockMeta.packageMeta.l10n.designerLocales,
        role: readonly ? 'guest' : 'author',
        inputHandleDefs: blockManifest.$$.inputs_def.ref(true),
        additionalInputs: blockManifest.$.additional_inputs.ref(),
        additionalInputDefs: blockManifest.$$.additional_inputs_def.ref(true),
        initialUIState: {
          groupCollapsed: getGroupCollapsed(blockMeta.manifest.$.inputs_def.value, 'default'),
        },
        showSettings: showSettings$,
        createSchemaEditor: this.createSchemaEditor,
      }),
    )
    inputSectionStore.onDidHandleRename((data) => {
      this.packageAuthoring.propagateHandleRename(blockMeta, 'input', data)
    })

    const outputSectionStore = subscriptions.add(
      new OutputSectionStore({
        lang: this.i18n.lang$,
        userLocales: blockMeta.packageMeta.l10n.designerLocales,
        role: readonly ? 'guest' : 'author',
        outputHandleDefs: blockManifest.$$.outputs_def.ref(true),
        additionalOutputs: blockManifest.$.additional_outputs.ref(),
        additionalOutputDefs: blockManifest.$$.additional_outputs_def.ref(true),
        initialUIState: {
          groupCollapsed: getGroupCollapsed(blockMeta.manifest.$.outputs_def.value, 'default'),
        },
        showSettings: showSettings$,
        createSchemaEditor: this.createSchemaEditor,
      }),
    )
    outputSectionStore.onDidHandleRename((data) => {
      this.packageAuthoring.propagateHandleRename(blockMeta, 'output', data)
    })

    //#endregion

    // A block Designer has one node, so its block name is a stable node ID.
    const nodeId = blockMeta.blockName as string as NodeId
    const initialUIData = designerUIStore.peekNodeUIData(nodeId)
    designerUIStore.setNodeUIData(nodeId, {
      ...initialUIData,
      contentWidth: initialUIData?.contentWidth ?? blockManifest.$.ui.value?.default_width,
    })

    const taskNodeStore = new TaskNodeStore(nodeId, {
      manifest$: {
        icon: blockManifest.$$.icon.ref(true),
        title: blockManifest.$$.title.ref(true),
        description: blockManifest.$$.description.ref(true),
        task: attachSetter<InlineTask | undefined | string>(
          val({
            executor: blockManifest.$$.executor.ref(true),
          } as InlineTask),
          noop,
        ),
        additional_inputs: blockManifest.$$.additional_inputs.ref(true),
        additional_outputs: blockManifest.$$.additional_outputs.ref(true),
        private: blockManifest.$$.private.ref(true),
      },
      display$: {
        icon: blockMeta.$.icon.ref(),
        title: blockMeta.$.title.ref(),
        description: blockMeta.$.description.ref(),
        status: val<NodeStatus>(NODE_STATUS.Idle),
        progress: val(),
        showSettings: showSettings$,
        task: val(blockMeta.blockResourceName),
        executorName: blockMeta.$.executorName.ref(),
        sections: val(coalesce([inputSectionStore, outputSectionStore])),
        inputs_def: blockManifest.$.inputs_def.ref(),
        outputs_def: blockManifest.$.outputs_def.ref(),
        ignore: val(),
      },
      designerUIStore,

      openExecutorEntry: openSharedTaskSource.bind(null, this.packageAuthoring, this.navigation, this.notification, this.i18n, blockMeta),
    })

    taskNodeStore.dispose.add(subscriptions)
    return taskNodeStore
  }

  public async userRenameTaskBlock(oldBlockMeta: TaskBlockMeta, newName: BlockName): Promise<void> {
    const newBlockMeta = await this.packageAuthoring.packageMeta.sharedBlocks.renameSharedBlock(oldBlockMeta, newName)
    if (newBlockMeta) {
      await this.navigation.replace(oldBlockMeta.blockPath, newBlockMeta.blockPath)
      this.dirtyResources.rename(oldBlockMeta.blockPath, newBlockMeta.blockPath)
    }
  }

  private renameTaskBlock(blockMeta: TaskBlockMeta, newName: BlockName): void {
    void this.userRenameTaskBlock(blockMeta, newName).catch((error) => {
      this.notification.error(error instanceof Error ? error.message : String(error))
    })
  }
}
