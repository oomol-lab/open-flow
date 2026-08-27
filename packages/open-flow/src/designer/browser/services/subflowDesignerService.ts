// A Subflow is an internal graph and an externally callable block.
// Its pseudo input and output nodes derive from the Subflow handle definitions.
import type { Val } from 'value-enhancer'
import type { BlockName } from '../../../manifest/common/manifestTypes.ts'
import type { HandleName, NodeId } from '../../../schema/index.ts'
import type { CreateNodeStoreContext } from '../actions/createNodeStore.ts'
import type { Viewport, XYPosition } from '../base/compare.ts'
import type { SubflowViewMode } from '../stores/designer/subflowDesigner.store.ts'
import type { FlowRunStatus } from '../stores/designer/typings.ts'
import type { CommentNodeStore } from '../stores/node/commentNode.store.ts'
import type { NodeStatus } from '../stores/node/constants.ts'
import type { NodeShowSettings, NodeStore } from '../stores/node/node.store.ts'
import type { AbstractDesignerServiceProps } from './designerService.ts'

import { coalesce, inertFilterMap, toPlainObject } from '@wopjs/cast'
import { disposableStore, dispose } from '@wopjs/disposable'
import { event, send } from '@wopjs/event'
import { attachSetter, derive, val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { watchReactiveMap } from '../../../base/common/reactivity.ts'
import { SubflowBlockMeta } from '../../../manifest/common/meta/block/subflowBlockMeta.ts'
import { onTranslationKeyChanged } from '../../../manifest/common/meta/package/userLocaleCleaner.ts'
import { addNodeStore, getGroupCollapsed } from '../actions/addNode.ts'
import { setupAutoSaveUIFile } from '../actions/autoSaveUiFile.ts'
import { setupCommentNodes } from '../actions/commentNodes.tsx'
import { setupOnCopyListener, setupOnPasteListener } from '../actions/copyPaste.ts'
import { createNodeStore, migrateNodeStores } from '../actions/createNodeStore.ts'
import { duplicateNodes } from '../actions/duplicateNodes.ts'
import { autoSetNewNodePositions } from '../actions/newNodePosition.ts'
import { connect, disconnectEdges } from '../actions/nodeConnection.ts'
import { setupPseudoNodesPositioning } from '../actions/pseudoNodePosition.ts'
import { removeNodes } from '../actions/removeNodes.ts'
import { renameNode } from '../actions/renameNode.ts'
import { openInlineTaskEntry, openSharedTaskSource } from '../actions/taskSourceNavigation.ts'
import { bindValidateConnection } from '../actions/validateConnection.ts'
import { validateNodeId, validateSharedBlockName } from '../actions/validation.ts'
import { DesignerUIStore } from '../stores/designer/designerUI.store.ts'
import { createRFCommand } from '../stores/designer/rfCommand.ts'
import { SUBFLOW_VIEW_MODE, SubflowDesignerStore } from '../stores/designer/subflowDesigner.store.ts'
import { FLOW_RUN_STATUS } from '../stores/designer/typings.ts'
import { INPUT_NODE_ID, NODE_STATUS, OUTPUT_NODE_ID } from '../stores/node/constants.ts'
import { InputNodeStore } from '../stores/node/inputNode.store.ts'
import { InputSectionStore } from '../stores/node/nodeSection/inputSection.store.ts'
import { OutputSectionStore } from '../stores/node/nodeSection/outputSection.store.ts'
import { SubflowInputSectionStore } from '../stores/node/nodeSection/subflowInputSection.store.ts'
import { SubflowOutputSectionStore } from '../stores/node/nodeSection/subflowOutputSection.store.ts'
import { OutputNodeStore } from '../stores/node/outputNode.store.ts'
import { SubflowNodeStore } from '../stores/node/subflowNode.store.ts'
import { AbstractDesignerService } from './designerService.ts'

export interface SubflowDesignerServiceProps extends AbstractDesignerServiceProps {
  readonly runNode?: (nodeId: NodeId, useCache: boolean) => Promise<void>
  readonly runStatus?: Val<FlowRunStatus>
}

export class SubflowBlockDesignerService extends AbstractDesignerService {
  private readonly runNode?: (nodeId: NodeId, useCache: boolean) => Promise<void>
  private readonly runStatus?: Val<FlowRunStatus>
  private readonly readyByStore = new WeakMap<SubflowDesignerStore, Promise<void>>()

  public constructor(props: SubflowDesignerServiceProps) {
    super(props)
    this.runNode = props.runNode
    this.runStatus = props.runStatus
  }

  public createSubflowDesignerStore(subflowMeta: SubflowBlockMeta): SubflowDesignerStore {
    const manifest = subflowMeta.manifest

    // migrateNodeStores populates the node map.
    const nodes = reactiveMap<NodeId, NodeStore>(null, {
      onDeleted: dispose,
    })
    const pseudoNodes = reactiveMap<NodeId, NodeStore>(null, {
      onDeleted: dispose,
    })
    const commentNodes = reactiveMap<NodeId, CommentNodeStore>(null, {
      onDeleted: dispose,
    })

    const runStatus$ = this.runStatus ?? val<FlowRunStatus>(FLOW_RUN_STATUS.Idle)

    const viewMode = val<SubflowViewMode>(SUBFLOW_VIEW_MODE.Flow)
    const viewport = val<Viewport | undefined>(undefined)
    const miniMapExpanded = val<boolean | undefined>(undefined)
    const settingsPanelWidth = val<number | undefined>(undefined)
    const displayMode = val(this.defaultFlowDisplayMode.value)

    const rfCommand = createRFCommand(nodes)
    const designerUIStore = new DesignerUIStore({
      viewport,
      nodeStores: nodes,
      pseudoNodeStores: pseudoNodes,
      commentNodeStores: commentNodes,
    })

    const readonly = !this.packageAuthoring.packageMeta.sharedBlocks.sharedBlocksByPath.has(subflowMeta.blockPath)

    const showSettings$ = val<NodeShowSettings | undefined>({ scope: 'node' })
    const {
      subflowNodeStore: flowNode,
      inputGroupCollapsed,
      outputGroupCollapsed,
    } = this.createSubflowNodeStore(designerUIStore, subflowMeta, readonly, showSettings$)

    const onPaste = event<XYPosition>()

    const subflowDesignerStore = new SubflowDesignerStore({
      flowNode,
      pseudoNodes,

      focused$: derive(this.navigation.focusedResource$, (path) => path === subflowMeta.blockPath),
      readonly,
      lang$: this.i18n.lang$,
      userLocales: subflowMeta.packageMeta.l10n.designerLocales,
      rfCommand,
      designerUIStore,
      nodes,
      commentNodes,
      displayMode,
      viewMode,
      viewport: designerUIStore.viewport$,
      manifest$: {
        icon: manifest.$$.icon.ref(true),
        title: manifest.$$.title.ref(true),
        description: manifest.$$.description.ref(true),
        forward_previews: attachSetter(subflowMeta.$.forwardPreviews.ref(), manifest.$$.forward_previews.set),
        private: manifest.$$.private.ref(true),
      },
      display$: {
        icon: subflowMeta.$.icon.ref(),
        title: subflowMeta.$.title.ref(),
        description: subflowMeta.$.description.ref(),
        forward_previews: subflowMeta.$.forwardPreviews.ref(),
      },
      settingsPanelWidth,
      connectorConnections: this.connectorConnections,
      runStatus: runStatus$,
      miniMapExpanded,
      interactiveMode: this.interactiveMode.ref(true),
      showConfirmDialog: this.confirmation.confirm.bind(this.confirmation),
      bindValidateConnection: bindValidateConnection.bind(null, subflowMeta, this.compareJSONSchema, this.i18n.t$),
      onConnect: connect.bind(null, subflowMeta),
      onDisconnect: disconnectEdges.bind(null, subflowMeta),
      onDeleteNodes: removeNodes.bind(null, subflowMeta, commentNodes, designerUIStore),
      onAddNode: addNodeStore.bind(null, {
        commentNodes,
        connectorCatalog: this.connectorCatalog,
        createMarkdownEditor: this.createL10nMarkdownEditor,
        designerUIStore,
        expandScriptletEditor: this.expandScriptletEditor,
        flowLikeMeta: subflowMeta,
        i18n: this.i18n,
        notification: this.notification,
        packageAuthoring: this.packageAuthoring,
        theme: this.theme,
      }),
      onDuplicate: duplicateNodes.bind(null, this.packageAuthoring, subflowMeta, nodes, designerUIStore),
      onPaste: send.bind(null, onPaste),
      validateDirName: validateSharedBlockName.bind(null, this.packageAuthoring, this.i18n),
      validateNodeId: validateNodeId.bind(null, nodes, this.i18n),
      onRenameNodeId: renameNode.bind(null, nodes, designerUIStore, subflowMeta),
      provideAddNodeMenuItems: this.provideAddNodeMenuItems.bind(this),
      provideAsyncAddNodeMenuItems: this.provideAsyncAddNodeMenuItems.bind(this),
      onRenameDirName: this.packageAuthoring.canRenameSharedBlocks
        ? (_oldName: string, newName: string) => this.renameSubflowBlock(subflowMeta, newName as BlockName)
        : undefined,
    })

    subflowDesignerStore.dispose.add(subflowDesignerStore.onDidChangeTranslateKey(onTranslationKeyChanged.bind(null, this.packageAuthoring.packageMeta)))
    if (!readonly) {
      subflowDesignerStore.dispose.add(
        flowNode.uiStore.$.contentWidth.reaction((width) => {
          manifest.$$.ui.set({ ...manifest.$$.ui.value, default_width: width })
        }),
      )
    }

    subflowDesignerStore.dispose.add(setupOnCopyListener(subflowDesignerStore, subflowMeta, this.i18n.t, this.notification))
    if (!readonly) {
      subflowDesignerStore.dispose.add(
        setupOnPasteListener(
          subflowDesignerStore,
          designerUIStore,
          subflowMeta,
          this.theme,
          this.createL10nMarkdownEditor,
          onPaste,
          this.i18n,
          this.notification,
          this.packageAuthoring.canWriteScriptlets,
        ),
      )
    }

    subflowDesignerStore.dispose.add([nodes, pseudoNodes, commentNodes])

    let disposed = false
    const disposedSignal = Promise.withResolvers<void>()
    subflowDesignerStore.dispose.add(() => {
      disposed = true
      disposedSignal.resolve()
    })

    const initialize = async (): Promise<void> => {
      let uiFile: Awaited<ReturnType<SubflowBlockDesignerService['loadUIFile']>> | undefined
      try {
        uiFile = await this.loadUIFile(subflowMeta.manifestPath)
      } catch (error) {
        console.error(`Failed to load Designer UI data for ${subflowMeta.manifestPath}.`, error)
      }
      if (disposed) return

      const uiPath = uiFile?.path
      const uiData = uiFile?.data
      designerUIStore.loadDesignerUIData(uiData, displayMode.value)
      setupCommentNodes(this.i18n, this.theme.darkMode$, subflowDesignerStore, commentNodes, this.createL10nMarkdownEditor)

      const inputNode = this.createInputNodeStore(designerUIStore, subflowMeta, readonly, showSettings$, inputGroupCollapsed)
      pseudoNodes.set(INPUT_NODE_ID, inputNode)

      const outputNode = this.createOutputNodeStore(designerUIStore, subflowMeta, readonly, showSettings$, outputGroupCollapsed)
      pseudoNodes.set(OUTPUT_NODE_ID, outputNode)

      const ctx = Object.freeze<CreateNodeStoreContext>({
        readonly,
        i18n: this.i18n,
        dark: this.theme.darkMode$,
        flowLikeMeta: subflowMeta,
        designerStore: subflowDesignerStore,
        resourceService: this.resourceService,
        packageAuthoring: this.packageAuthoring,
        execute: this.runNode,
        openSharedTaskSource: openSharedTaskSource.bind(null, this.packageAuthoring, this.navigation, this.notification, this.i18n),
        openInlineTaskEntry: openInlineTaskEntry.bind(null, this.navigation, this.notification, this.i18n),
        openBlockDesigner: this.openBlockDesigner,
        createSchemaEditor: this.createSchemaEditor,
        createScriptletEditor: this.createScriptletEditor,
      })

      subflowDesignerStore.dispose.add(
        subflowMeta.nodes.$.subscribe((nodeMetas) => {
          autoSetNewNodePositions(nodeMetas, nodes, designerUIStore)
          migrateNodeStores(ctx)
        }),
      )

      setupPseudoNodesPositioning(subflowDesignerStore)

      subflowDesignerStore.dispose.add(
        // Recreate the node store when its resolved block changes.
        watchReactiveMap(subflowMeta.nodes, (nodeMeta) => {
          return nodeMeta.$.blockMeta.reaction(() => {
            const oldNodeStore = subflowDesignerStore.$$.nodes.get(nodeMeta.nodeId)
            if (oldNodeStore) {
              subflowDesignerStore.designerUIStore.setNodeUIData(oldNodeStore.nodeId, oldNodeStore.uiStore.toUIData())
            }
            subflowDesignerStore.$$.nodes.set(nodeMeta.nodeId, createNodeStore(ctx, nodeMeta, subflowMeta))
          })
        }),
      )

      if (uiPath) {
        const autoSave = subflowDesignerStore.dispose.add(
          setupAutoSaveUIFile(this.dirtyResources, subflowMeta.manifestPath, uiPath, designerUIStore, this.saveUIFile),
        )
        this.pendingSaveUIFiles.set(subflowMeta.manifestPath, () => autoSave.flush())
        subflowDesignerStore.dispose.add(() => this.pendingSaveUIFiles.delete(subflowMeta.manifestPath))
      }
    }
    const ready = Promise.race([initialize(), disposedSignal.promise])
    this.readyByStore.set(subflowDesignerStore, ready)

    const disposeByMeta = () => {
      this.designerStores.delete(subflowMeta.blockPath)
    }
    subflowMeta.dispose.add(disposeByMeta)
    subflowDesignerStore.dispose.add(() => {
      subflowMeta.dispose.remove(disposeByMeta)
    })

    return subflowDesignerStore
  }

  public whenReady(subflowDesignerStore: SubflowDesignerStore): Promise<void> {
    return this.readyByStore.get(subflowDesignerStore) ?? Promise.reject(new Error('Subflow Designer store was not created by this service.'))
  }

  // Designer stores own disposable values passed through their props.
  private createSubflowNodeStore(
    designerUIStore: DesignerUIStore,
    subflowMeta: SubflowBlockMeta,
    readonly: boolean,
    showSettings$: Val<NodeShowSettings | undefined>,
  ): {
    subflowNodeStore: SubflowNodeStore
    inputGroupCollapsed: Val<Record<PropertyKey, true> | undefined>
    outputGroupCollapsed: Val<Record<PropertyKey, true> | undefined>
  } {
    const subscriptions = disposableStore()
    const manifest = subflowMeta.manifest

    //#region SubflowNode Sections
    const inputSectionStore = subscriptions.add(
      new InputSectionStore({
        lang: this.i18n.lang$,
        userLocales: subflowMeta.packageMeta.l10n.designerLocales,
        role: readonly ? 'guest' : 'author',
        inputHandleDefs: manifest.$$.inputs_def.ref(true),
        initialUIState: {
          groupCollapsed: getGroupCollapsed(subflowMeta.manifest.$.inputs_def.value, 'default'),
        },
        showSettings: showSettings$,
        createSchemaEditor: this.createSchemaEditor,
      }),
    )
    inputSectionStore.onDidHandleRename((data) => {
      this.packageAuthoring.propagateHandleRename(subflowMeta, 'input', data)
    })

    const outputSectionStore = subscriptions.add(
      new OutputSectionStore({
        lang: this.i18n.lang$,
        userLocales: subflowMeta.packageMeta.l10n.designerLocales,
        role: readonly ? 'guest' : 'author',
        outputHandleDefs: manifest.$$.outputs_def.ref(true),
        initialUIState: {
          groupCollapsed: getGroupCollapsed(subflowMeta.manifest.$.outputs_def.value, 'default'),
        },
        showSettings: showSettings$,
        createSchemaEditor: this.createSchemaEditor,
      }),
    )
    outputSectionStore.onDidHandleRename((data) => {
      this.onRenameOutputHandle(subflowMeta, data)
      this.packageAuthoring.propagateHandleRename(subflowMeta, 'output', data)
    })

    //#endregion

    const nodeId = subflowMeta.blockName as string as NodeId
    designerUIStore.setNodeUIData(nodeId, {
      contentWidth: manifest.$.ui.value?.default_width,
    })
    const subflowNodeStore = new SubflowNodeStore(nodeId, {
      manifest$: {
        icon: manifest.$$.icon.ref(true),
        title: manifest.$$.title.ref(true),
        description: manifest.$$.description.ref(true),
        private: manifest.$$.private.ref(true),
      },
      display$: {
        icon: subflowMeta.$.icon.ref(),
        title: subflowMeta.$.title.ref(),
        description: subflowMeta.$.description.ref(),
        subflow: val(subflowMeta.blockResourceName),
        status: val<NodeStatus>(NODE_STATUS.Idle),
        progress: val(),
        showSettings: showSettings$.ref(true),
        sections: val(coalesce([inputSectionStore, outputSectionStore])),
        inputs_def: manifest.$.inputs_def.ref(),
        outputs_def: manifest.$.outputs_def.ref(),
        outputs_from: subflowMeta.$.handleOutputsFrom.ref(),
        ignore: val(),
      },
      designerUIStore,
    })

    subflowNodeStore.dispose.add(subscriptions)

    return {
      subflowNodeStore,
      inputGroupCollapsed: inputSectionStore.$$.groupCollapsed,
      outputGroupCollapsed: outputSectionStore.$$.groupCollapsed,
    }
  }

  private createInputNodeStore(
    designerUIStore: DesignerUIStore,
    subflowMeta: SubflowBlockMeta,
    readonly: boolean,
    showSettings$: Val<NodeShowSettings | undefined>,
    groupCollapsed: Val<Record<PropertyKey, true> | undefined>,
  ): InputNodeStore {
    const subscriptions = disposableStore()
    const manifest = subflowMeta.manifest

    const uiSectionsState = toPlainObject(toPlainObject(designerUIStore.peekPseudoNodeUIData(INPUT_NODE_ID))?.sections)

    const inputSectionStore = subscriptions.add(
      new SubflowInputSectionStore({
        lang: this.i18n.lang$,
        userLocales: subflowMeta.packageMeta.l10n.designerLocales,
        role: readonly ? 'guest' : 'author',
        initialUIState: toPlainObject(uiSectionsState?.[InputSectionStore.TYPE]),
        handleOutputsTo: subflowMeta.$.connectedInputHandles.ref(),
        inputHandleDefs: manifest.$$.inputs_def.ref(true),
        groupCollapsed,
        showSettings: showSettings$,
        createSchemaEditor: this.createSchemaEditor,
      }),
    )
    subscriptions.add(
      inputSectionStore.onDidHandleRename((data) => {
        this.packageAuthoring.propagateHandleRename(subflowMeta, 'input', data)
      }),
    )

    const inputNodeStore = new InputNodeStore({
      manifest$: {
        icon: manifest.$$.icon.ref(true),
        title: manifest.$$.title.ref(true),
        description: manifest.$$.description.ref(true),
        private: manifest.$$.private.ref(true),
      },
      display$: {
        icon: subflowMeta.$.icon.ref(),
        title: subflowMeta.$.title.ref(),
        description: subflowMeta.$.description.ref(),
        status: val<NodeStatus>(NODE_STATUS.Idle),
        progress: val(),
        showSettings: showSettings$.ref(true),
        sections: val([inputSectionStore]),
        inputs_def: manifest.$.inputs_def.ref(),
        outputs_def: manifest.$.inputs_def.ref(),
        ignore: val(),
      },
      designerUIStore,
    })

    inputNodeStore.dispose.add(subscriptions)
    return inputNodeStore
  }

  private createOutputNodeStore(
    designerUIStore: DesignerUIStore,
    subflowMeta: SubflowBlockMeta,
    readonly: boolean,
    showSettings$: Val<NodeShowSettings | undefined>,
    groupCollapsed: Val<Record<PropertyKey, true> | undefined>,
  ): OutputNodeStore {
    const subscriptions = disposableStore()
    const manifest = subflowMeta.manifest

    const uiSectionsState = toPlainObject(toPlainObject(designerUIStore.peekPseudoNodeUIData(OUTPUT_NODE_ID))?.sections)

    const outputSectionStore = subscriptions.add(
      new SubflowOutputSectionStore({
        lang: this.i18n.lang$,
        userLocales: subflowMeta.packageMeta.l10n.designerLocales,
        role: readonly ? 'guest' : 'author',
        initialUIState: toPlainObject(uiSectionsState?.[InputSectionStore.TYPE]),
        outputHandleDefs: manifest.$$.outputs_def.ref(true),
        handleOutputsFrom: attachSetter(subflowMeta.$.handleOutputsFrom.ref(), manifest.$$.outputs_from.set),
        groupCollapsed,
        showSettings: showSettings$,
        createSchemaEditor: this.createSchemaEditor,
      }),
    )

    subscriptions.add(
      outputSectionStore.onDidHandleRename((data) => {
        this.onRenameOutputHandle(subflowMeta, data)
        this.packageAuthoring.propagateHandleRename(subflowMeta, 'output', data)
      }),
    )

    const outputNodeStore = new OutputNodeStore({
      manifest$: {
        icon: manifest.$$.icon.ref(true),
        title: manifest.$$.title.ref(true),
        description: manifest.$$.description.ref(true),
        private: manifest.$$.private.ref(true),
      },
      display$: {
        icon: subflowMeta.$.icon.ref(),
        title: subflowMeta.$.title.ref(),
        description: subflowMeta.$.description.ref(),
        status: val<NodeStatus>(NODE_STATUS.Idle),
        progress: val(),
        showSettings: showSettings$.ref(true),
        sections: val([outputSectionStore]),
        inputs_def: manifest.$.outputs_def.ref(),
        outputs_def: manifest.$.outputs_def.ref(),
        outputs_from: subflowMeta.$.handleOutputsFrom.ref(),
        ignore: val(),
      },
      designerUIStore,
    })

    outputNodeStore.dispose.add(subscriptions)
    return outputNodeStore
  }

  private onRenameOutputHandle(subflowMeta: SubflowBlockMeta, [oldName, newName]: [oldName: HandleName, newName: HandleName]) {
    // Update outputs_from here; the Designer updates ordinary inputs_from directly.
    // Use the manifest value because the meta projection filters invalid references.
    const outputsFrom$ = subflowMeta.manifest.$$.outputs_from
    if (outputsFrom$.value) {
      outputsFrom$.set(
        inertFilterMap(outputsFrom$.value, (outputFrom) => {
          if (outputFrom.handle === oldName) {
            return { ...outputFrom, handle: newName }
          }
          return outputFrom
        }),
      )
    }
  }

  public async userRenameSubflowBlock(oldBlockMeta: SubflowBlockMeta, newName: BlockName): Promise<void> {
    const newBlockMeta = await this.packageAuthoring.packageMeta.sharedBlocks.renameSharedBlock(oldBlockMeta, newName)
    if (newBlockMeta) {
      await this.navigation.replace(oldBlockMeta.blockPath, newBlockMeta.blockPath)
      this.dirtyResources.rename(oldBlockMeta.blockPath, newBlockMeta.blockPath)
      this.designerStores.delete(oldBlockMeta.blockPath)
    }
  }

  private renameSubflowBlock(blockMeta: SubflowBlockMeta, newName: BlockName): void {
    void this.userRenameSubflowBlock(blockMeta, newName).catch((error) => {
      this.notification.error(error instanceof Error ? error.message : String(error))
    })
  }
}
