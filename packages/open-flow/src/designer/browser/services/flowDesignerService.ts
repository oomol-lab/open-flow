import type { Val } from 'value-enhancer'
import type { FlowMeta } from '../../../manifest/common/meta/flowMeta.ts'
import type { NodeId } from '../../../schema/index.ts'
import type { CreateNodeStoreContext } from '../actions/createNodeStore.ts'
import type { Viewport, XYPosition } from '../base/compare.ts'
import type { IFromSource } from '../stores/designer/designer.store.ts'
import type { FlowRunStatus } from '../stores/designer/typings.ts'
import type { CommentNodeStore } from '../stores/node/commentNode.store.ts'
import type { NodeStore } from '../stores/node/node.store.ts'
import type { AbstractDesignerServiceProps } from './designerService.ts'

import { dispose } from '@wopjs/disposable'
import { event, send } from '@wopjs/event'
import { derive, val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { watchReactiveMap } from '../../../base/common/reactivity.ts'
import { onTranslationKeyChanged } from '../../../manifest/common/meta/package/userLocaleCleaner.ts'
import { builtInTriggers, findBuiltInTrigger } from '../../../trigger/common/builtins.ts'
import { decodeTriggerCatalogIdentity } from '../../../trigger/common/catalog.ts'
import { addNodeStore } from '../actions/addNode.ts'
import { setupAutoSaveUIFile } from '../actions/autoSaveUiFile.ts'
import { setupCommentNodes } from '../actions/commentNodes.tsx'
import { setupOnCopyListener, setupOnPasteListener } from '../actions/copyPaste.ts'
import { createNodeStore, migrateNodeStores } from '../actions/createNodeStore.ts'
import { duplicateNodes } from '../actions/duplicateNodes.ts'
import { autoSetNewNodePositions } from '../actions/newNodePosition.ts'
import { connect, disconnectEdges } from '../actions/nodeConnection.ts'
import { removeNodes } from '../actions/removeNodes.ts'
import { renameNode } from '../actions/renameNode.ts'
import { openInlineTaskEntry, openSharedTaskSource } from '../actions/taskSourceNavigation.ts'
import { bindValidateConnection } from '../actions/validateConnection.ts'
import { validateNodeId } from '../actions/validation.ts'
import { DesignerUIStore } from '../stores/designer/designerUI.store.ts'
import { FlowDesignerStore } from '../stores/designer/flowDesigner.store.ts'
import { createRFCommand } from '../stores/designer/rfCommand.ts'
import { FLOW_RUN_STATUS } from '../stores/designer/typings.ts'
import { AbstractDesignerService } from './designerService.ts'

export interface FlowDesignerServiceProps extends AbstractDesignerServiceProps {
  readonly runNode?: (nodeId: NodeId, useCache: boolean) => Promise<void>
  readonly runStatus?: Val<FlowRunStatus>
}

export class FlowDesignerService extends AbstractDesignerService {
  private readonly runNode?: (nodeId: NodeId, cache: boolean) => Promise<void>
  private readonly runStatus?: Val<FlowRunStatus>
  private readonly readyByStore = new WeakMap<FlowDesignerStore, Promise<void>>()

  public constructor(props: FlowDesignerServiceProps) {
    super(props)
    this.runNode = props.runNode
    this.runStatus = props.runStatus
  }

  // Designer stores own disposable values passed through their props.
  public createFlowDesignerStore(flowMeta: FlowMeta): FlowDesignerStore {
    const manifest = flowMeta.manifest

    const nodes = reactiveMap<NodeId, NodeStore>(null, {
      onDeleted: dispose,
    })
    const commentNodes = reactiveMap<NodeId, CommentNodeStore>(null, {
      onDeleted: dispose,
    })

    const runStatus$ = this.runStatus ?? val(FLOW_RUN_STATUS.Idle)

    const viewport = val<Viewport | undefined>(undefined)
    const miniMapExpanded = val<boolean | undefined>(undefined)
    const settingsPanelWidth = val<number | undefined>(undefined)
    const displayMode = val(this.defaultFlowDisplayMode.value)

    const rfCommand = createRFCommand(nodes)
    const designerUIStore = new DesignerUIStore({
      viewport,
      nodeStores: nodes,
      commentNodeStores: commentNodes,
    })

    const readonly = !this.packageAuthoring.packageMeta.flows.flowsByPath.has(flowMeta.flowPath)

    const onPaste = event<XYPosition>()

    const flowDesignerStore = new FlowDesignerStore({
      focused$: derive(this.navigation.focusedResource$, (path) => path === flowMeta.flowPath),
      readonly,
      lang$: this.i18n.lang$,
      userLocales: flowMeta.packageMeta.l10n.designerLocales,
      rfCommand,
      designerUIStore,
      nodes,
      commentNodes,
      displayMode,
      viewport: designerUIStore.viewport$,
      manifest$: {
        icon: manifest.$$.icon.ref(true),
        title: manifest.$$.title.ref(true),
        description: manifest.$$.description.ref(true),
      },
      display$: {
        icon: flowMeta.$.icon.ref(),
        title: flowMeta.$.title.ref(),
        description: flowMeta.$.description.ref(),
      },
      settingsPanelWidth,
      connectorConnections: this.connectorConnections,
      runStatus: runStatus$,
      miniMapExpanded,
      interactiveMode: this.interactiveMode.ref(true),
      showConfirmDialog: this.confirmation.confirm.bind(this.confirmation),
      bindValidateConnection: bindValidateConnection.bind(null, flowMeta, this.compareJSONSchema, this.i18n.t$),
      onConnect: connect.bind(null, flowMeta),
      onDisconnect: disconnectEdges.bind(null, flowMeta),
      onDeleteNodes: removeNodes.bind(null, flowMeta, commentNodes, designerUIStore),
      onAddNode: addNodeStore.bind(null, {
        commentNodes,
        connectorCatalog: this.connectorCatalog,
        createMarkdownEditor: this.createL10nMarkdownEditor,
        designerUIStore,
        expandScriptletEditor: this.expandScriptletEditor,
        flowLikeMeta: flowMeta,
        i18n: this.i18n,
        notification: this.notification,
        packageAuthoring: this.packageAuthoring,
        theme: this.theme,
        getTrigger: this.resolveTrigger,
      }),
      onDuplicate: duplicateNodes.bind(this, this.packageAuthoring, flowMeta, nodes, designerUIStore),
      onPaste: send.bind(null, onPaste),
      validateNodeId: validateNodeId.bind(null, nodes, this.i18n),
      onRenameNodeId: renameNode.bind(null, nodes, designerUIStore, flowMeta),
      provideAddNodeMenuItems: this.provideFlowAddNodeMenuItems,
      provideAsyncAddNodeMenuItems: this.provideFlowAsyncAddNodeMenuItems,
    })

    flowDesignerStore.dispose.add(flowDesignerStore.onDidChangeTranslateKey(onTranslationKeyChanged.bind(null, this.packageAuthoring.packageMeta)))

    flowDesignerStore.dispose.add(setupOnCopyListener(flowDesignerStore, flowMeta, this.i18n.t, this.notification))
    if (!readonly) {
      flowDesignerStore.dispose.add(
        setupOnPasteListener(
          flowDesignerStore,
          designerUIStore,
          flowMeta,
          this.theme,
          this.createL10nMarkdownEditor,
          onPaste,
          this.i18n,
          this.notification,
          this.packageAuthoring.canWriteScriptlets,
        ),
      )
    }

    flowDesignerStore.dispose.add([nodes, commentNodes])

    let disposed = false
    const disposedSignal = Promise.withResolvers<void>()
    flowDesignerStore.dispose.add(() => {
      disposed = true
      disposedSignal.resolve()
    })

    const initialize = async (): Promise<void> => {
      let uiFile: Awaited<ReturnType<FlowDesignerService['loadUIFile']>> | undefined
      try {
        uiFile = await this.loadUIFile(flowMeta.flowPath)
      } catch (error) {
        console.error(`Failed to load Designer UI data for ${flowMeta.flowPath}.`, error)
      }
      if (disposed) return

      const uiPath = uiFile?.path
      const uiData = uiFile?.data
      designerUIStore.loadDesignerUIData(uiData, displayMode.value)
      setupCommentNodes(this.i18n, this.theme.darkMode$, flowDesignerStore, commentNodes, this.createL10nMarkdownEditor)

      const ctx = Object.freeze<CreateNodeStoreContext>({
        readonly,
        i18n: this.i18n,
        dark: this.theme.darkMode$,
        flowLikeMeta: flowMeta,
        designerStore: flowDesignerStore,
        resourceService: this.resourceService,
        packageAuthoring: this.packageAuthoring,
        execute: this.runNode,
        openSharedTaskSource: openSharedTaskSource.bind(null, this.packageAuthoring, this.navigation, this.notification, this.i18n),
        openInlineTaskEntry: openInlineTaskEntry.bind(null, this.navigation, this.notification, this.i18n),
        openBlockDesigner: this.openBlockDesigner,
        createSchemaEditor: this.createSchemaEditor,
        createScriptletEditor: this.createScriptletEditor,
      })
      flowDesignerStore.dispose.add(
        flowMeta.nodes.$.subscribe((nodeMetas) => {
          autoSetNewNodePositions(nodeMetas, nodes, designerUIStore)
          migrateNodeStores(ctx)
        }),
      )
      flowDesignerStore.dispose.add(
        // Recreate the node store when its resolved block changes.
        watchReactiveMap(flowMeta.nodes, (nodeMeta) => {
          return nodeMeta.$.blockMeta.reaction(() => {
            const oldNodeStore = flowDesignerStore.$$.nodes.get(nodeMeta.nodeId)
            if (oldNodeStore) {
              flowDesignerStore.designerUIStore.setNodeUIData(oldNodeStore.nodeId, oldNodeStore.uiStore.toUIData())
            }
            flowDesignerStore.$$.nodes.set(nodeMeta.nodeId, createNodeStore(ctx, nodeMeta, flowMeta))
          })
        }),
      )

      if (uiPath) {
        const autoSave = flowDesignerStore.dispose.add(
          setupAutoSaveUIFile(this.dirtyResources, flowMeta.manifestPath, uiPath, designerUIStore, this.saveUIFile),
        )
        this.pendingSaveUIFiles.set(flowMeta.manifestPath, () => autoSave.flush())
        flowDesignerStore.dispose.add(() => this.pendingSaveUIFiles.delete(flowMeta.manifestPath))
      }
    }
    const ready = Promise.race([initialize(), disposedSignal.promise])
    this.readyByStore.set(flowDesignerStore, ready)

    const disposeByMeta = () => {
      this.designerStores.delete(flowMeta.flowPath)
    }
    flowMeta.dispose.add(disposeByMeta)
    flowDesignerStore.dispose.add(() => {
      flowMeta.dispose.remove(disposeByMeta)
    })

    return flowDesignerStore
  }

  private readonly provideFlowAsyncAddNodeMenuItems = async (fromSource: IFromSource | undefined, searchTerm: string, signal: AbortSignal) => {
    const [connectorItems, triggerItems] = await Promise.all([
      this.provideAsyncAddNodeMenuItems(fromSource, searchTerm, signal).catch(() => []),
      this.provideTriggerAddNodeMenuItems(fromSource, searchTerm, signal),
    ])
    return [...triggerItems, ...(connectorItems ?? [])]
  }

  private readonly provideFlowAddNodeMenuItems = (fromSource?: IFromSource) => {
    const items = this.provideAddNodeMenuItems(fromSource) ?? []
    if (fromSource?.side == 'right') return items
    return [
      ...items,
      { type: 'divider' as const, label: this.i18n.t('addNode.triggers') },
      ...builtInTriggers.map((item) => this.triggerAddNodeMenuItem(item, fromSource)),
    ]
  }

  private readonly resolveTrigger = async (identitySource: string, signal?: AbortSignal) => {
    const builtIn = findBuiltInTrigger(decodeTriggerCatalogIdentity(identitySource))
    if (builtIn != null) return builtIn
    if (this.getTrigger == null) throw new Error(this.i18n.t('trigger.catalogUnavailable'))
    return this.getTrigger(identitySource, signal)
  }

  public whenReady(flowDesignerStore: FlowDesignerStore): Promise<void> {
    return this.readyByStore.get(flowDesignerStore) ?? Promise.reject(new Error('Flow Designer store was not created by this service.'))
  }
}
