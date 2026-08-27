import type { I18n } from 'val-i18n'
import type { ReadonlyVal } from 'value-enhancer'
import type { ReactiveMap } from 'value-enhancer/collections'
import type { ConnectorCatalog } from '../../../connector/common/catalog.ts'
import type { BlockPath } from '../../../manifest/common/manifestTypes.ts'
import type { FlowLikeMeta } from '../../../manifest/common/meta/flowLike/flowLikeMeta.ts'
import type { GroupDividerDef, InputHandleDef, NodeId, OutputHandleDef } from '../../../schema/index.ts'
import type { TriggerCatalogCompatibleItem } from '../../../trigger/common/catalog.ts'
import type { PackageAuthoring } from '../../common/packageAuthoring.ts'
import type { XYPosition } from '../base/compare.ts'
import type { AddNodeType } from '../base/dragNDrop.ts'
import type { BrowserTheme } from '../browserTheme.ts'
import type { DesignerNotification } from '../notification.ts'
import type { CreateL10nMarkdownEditorFn } from '../services/designerService.ts'
import type { DesignerUIStore } from '../stores/designer/designerUI.store.ts'
import type { CommentNodeStore } from '../stores/node/commentNode.store.ts'
import type { NodeUIPersistedData } from '../stores/node/nodeUI.store.ts'

import { connectorActionNode, connectorActionTitle } from '../../../connector/common/actionNode.ts'
import { llmNode } from '../../../llm/common/node.ts'
import { FlowMeta } from '../../../manifest/common/meta/flowMeta.ts'
import { isGroupDividerDef } from '../../../manifest/common/model/block/base/blockManifest.ts'
import {
  applyIndentation,
  DEFAULT_SCRIPTLET_CONTENT_WIDTH,
  scriptletExtensions,
  scriptletIndentation,
  scriptletPresets,
  scriptletTemplates,
} from '../scriptletPresets.ts'
import { addCommentNodeStore } from './commentNodes.tsx'

export interface AddNodeStoreContext {
  readonly commentNodes: ReactiveMap<NodeId, CommentNodeStore>
  readonly connectorCatalog: ConnectorCatalog | undefined
  readonly createMarkdownEditor: CreateL10nMarkdownEditorFn
  readonly designerUIStore: DesignerUIStore
  readonly expandScriptletEditor: ReadonlyVal<boolean>
  readonly flowLikeMeta: FlowLikeMeta
  readonly i18n: I18n
  readonly notification: DesignerNotification
  readonly packageAuthoring: PackageAuthoring
  readonly theme: BrowserTheme
  readonly getTrigger?: (identity: string, signal?: AbortSignal) => Promise<TriggerCatalogCompatibleItem>
}

export async function addNodeStore(context: AddNodeStoreContext, type: AddNodeType, payload: string, position: XYPosition): Promise<NodeId | undefined> {
  const {
    commentNodes,
    connectorCatalog,
    createMarkdownEditor,
    designerUIStore,
    expandScriptletEditor,
    flowLikeMeta,
    i18n,
    notification,
    packageAuthoring,
    theme,
    getTrigger,
  } = context
  //#region Task, Subflow
  if (type === 'block') {
    const blockPath = payload as BlockPath

    const blockMeta = packageAuthoring.getLocalBlock(blockPath)
    if (!blockMeta) {
      throw new Error(`Block meta not found: ${blockPath}`)
    }
    const nodeId = packageAuthoring.addSharedBlockNode(flowLikeMeta, blockMeta)
    const contentWidth = blockMeta.manifest.$.ui.value?.default_width
    const inputDefs: readonly (InputHandleDef | GroupDividerDef)[] | undefined = blockMeta.manifest.$.inputs_def.value
    const outputDefs: readonly (OutputHandleDef | GroupDividerDef)[] | undefined = blockMeta.manifest.$.outputs_def.value

    designerUIStore.setNewNodeUIData(nodeId, {
      contentWidth,
      rfNode: { position },
      sections: {
        inputs: {
          groupCollapsed: getGroupCollapsed(inputDefs, 'default'),
        },
        outputs: {
          groupCollapsed: getGroupCollapsed(outputDefs, 'default'),
        },
      },
    })

    return nodeId
  }
  //#endregion
  //#region Connector
  else if (type === 'connector') {
    if (connectorCatalog == null) {
      notification.error(i18n.t('addNode.connectorUnavailable'))
      return
    }
    try {
      const selection = JSON.parse(payload) as
        | { readonly actionId: string; readonly manageConnection: string }
        | { readonly actionId: string; readonly connection: string }
      if ('manageConnection' in selection) {
        await openConnectionPage(connectorCatalog, selection.manageConnection, i18n)
        return
      }
      const action = await connectorCatalog.getAction(selection.actionId)
      const connection = (await connectorCatalog.listConnections(action.service)).find((item) => item.id == selection.connection)
      if (connection?.status != 'active') throw new Error(`Connector connection "${selection.connection}" is not active for service "${action.service}".`)
      const [nodeId, nodeIdIndex] = flowLikeMeta.produceNodeId(`+${action.name}`)
      const title = flowLikeMeta.produceNodeTitle(connectorActionTitle(action.name), nodeIdIndex)
      flowLikeMeta.upsertNodes({
        type: 'task',
        data: connectorActionNode(action, selection.connection, nodeId, title),
      })
      designerUIStore.setNewNodeUIData(nodeId, {
        contentWidth: 415,
        rfNode: { position },
      })
      return nodeId
    } catch (error) {
      notification.error(error instanceof Error ? error.message : String(error))
      return
    }
  }
  //#endregion
  //#region LLM
  else if (type === 'llm') {
    const mode = payload == 'json' ? 'json' : 'chat'
    const baseTitle = mode == 'chat' ? 'LLM Chat' : 'LLM Structured Output'
    const [nodeId, nodeIdIndex] = flowLikeMeta.produceNodeId(mode == 'chat' ? '+llm_chat' : '+llm_structured')
    const title = flowLikeMeta.produceNodeTitle(baseTitle, nodeIdIndex)
    const node = llmNode(mode, nodeId, title)
    flowLikeMeta.upsertNodes({ type: 'task', data: node })
    designerUIStore.setNewNodeUIData(nodeId, {
      contentWidth: 415,
      rfNode: { position },
      sections: {
        inputs: {
          collapsed: {
            model: { '[]': false },
            template: { '[]': false },
          },
          groupCollapsed: getGroupCollapsed(typeof node.task == 'string' ? undefined : node.task.inputs_def, 'default'),
        },
      },
    })
    return nodeId
  }
  //#endregion
  //#region Trigger
  else if (type === 'trigger') {
    if (!FlowMeta.is(flowLikeMeta) || getTrigger == null) {
      notification.error(i18n.t('trigger.catalogUnavailable'))
      return
    }
    try {
      const selection = JSON.parse(payload) as
        | { readonly identity: string; readonly manageConnection: string }
        | { readonly connection?: string; readonly identity: string }
      if ('manageConnection' in selection) {
        if (connectorCatalog == null) throw new Error('Connector connections are not available in this project host.')
        await openConnectionPage(connectorCatalog, selection.manageConnection, i18n)
        return
      }
      const item = await getTrigger(selection.identity)
      const connection = selection.connection
      if (item.trigger.definition.connector != null && connection == null) {
        throw new Error(`No active default Connector connection is available for service "${item.trigger.definition.connector.service_id}".`)
      }
      const baseId = item.type.replaceAll(/[^a-z0-9]+/gi, '_').replaceAll(/^_+|_+$/g, '') || 'trigger'
      const [nodeId, nodeIdIndex] = flowLikeMeta.produceNodeId(`+${baseId}`)
      const title = flowLikeMeta.produceNodeTitle(item.trigger.definition.name, nodeIdIndex)
      flowLikeMeta.upsertTriggerNode(
        {
          node_id: nodeId,
          title,
          description: item.description,
          icon: item.icon,
          trigger: {
            type: item.type,
            revision: item.revision,
            ...(connection == null ? {} : { connection }),
            config: item.trigger.config,
            ...(item.trigger.poll_times == null ? {} : { poll_times: item.trigger.poll_times }),
          },
        },
        {
          type: item.type,
          revision: item.revision,
          definition: item.trigger.definition,
        },
      )
      designerUIStore.setNewNodeUIData(nodeId, {
        contentWidth: 415,
        rfNode: { position },
      })
      return nodeId
    } catch (error) {
      notification.error(error instanceof Error ? error.message : String(error))
      return
    }
  }
  //#endregion
  //#region Scriptlet
  else if (type === 'scriptlet') {
    if (!packageAuthoring.canWriteScriptlets) {
      notification.error(i18n.t('addNode.scriptletUnsupported'))
      return
    }
    const scriptletConfig = scriptletPresets.get(payload)
    if (!scriptletConfig) {
      console.error('scriptlet not found', payload)
      return
    }

    const [nodeId, nodeIdIndex] = flowLikeMeta.produceNodeId(`+${scriptletConfig.id}`)
    const title = flowLikeMeta.produceNodeTitle(scriptletConfig.title || scriptletConfig.id, nodeIdIndex)

    const newEntry = await flowLikeMeta.packageMeta.scriptlets.writeNewScriptlet(
      flowLikeMeta.manifestDir,
      scriptletExtensions[scriptletConfig.id],
      applyIndentation(scriptletTemplates[scriptletConfig.id], scriptletIndentation[scriptletConfig.id], '  '),
    )

    const uiData: NodeUIPersistedData = {
      contentWidth: DEFAULT_SCRIPTLET_CONTENT_WIDTH,
      rfNode: { position },
      sections: expandScriptletEditor.value ? undefined : { scriptlet: { cardCollapsed: true } },
    }
    designerUIStore.setNewNodeUIData(nodeId, uiData)

    flowLikeMeta.upsertNodes({
      type: 'task',
      data: {
        node_id: nodeId,
        title,
        icon: scriptletConfig.icon,
        task: {
          ...scriptletConfig.task,
          executor: {
            ...scriptletConfig.task.executor,
            options: {
              ...scriptletConfig.task.executor.options,
              entry: newEntry,
            },
          },
        },
      },
    })
    return nodeId
  }

  //#endregion
  //#region Value
  else if (type === 'value') {
    const [nodeId, nodeIdIndex] = flowLikeMeta.produceNodeId(`+value`)
    const title = flowLikeMeta.produceNodeTitle('Value', nodeIdIndex)

    designerUIStore.setNewNodeUIData(nodeId, {
      contentWidth: 415,
      rfNode: { position },
    })

    flowLikeMeta.upsertNodes({
      type: 'value',
      data: { node_id: nodeId, title, values: [] },
    })
    return nodeId
  }
  //#endregion
  //#region Condition
  else if (type === 'condition') {
    const [nodeId, nodeIdIndex] = flowLikeMeta.produceNodeId(`+condition`)
    const title = flowLikeMeta.produceNodeTitle('Condition', nodeIdIndex)

    designerUIStore.setNewNodeUIData(nodeId, {
      rfNode: { position },
    })

    flowLikeMeta.upsertNodes({
      type: 'condition',
      data: { node_id: nodeId, title, conditions: {} },
    })
    return nodeId
  }
  //#endregion
  //#region Comment
  else if (type === 'comment') {
    return addCommentNodeStore({
      i18n,
      userLocales: flowLikeMeta.packageMeta.l10n.designerLocales,
      dark$: theme.darkMode$,
      readonly: false,
      designerUIStore,
      commentNodes,
      mountCodeEditor: createMarkdownEditor,
      position,
    })
  }
  //#endregion
}

async function openConnectionPage(catalog: ConnectorCatalog, service: string, i18n: I18n): Promise<void> {
  const tab = window.open('about:blank', '_blank')
  if (tab == null) throw new Error(i18n.t('addNode.connectorPopupBlocked'))
  tab.opener = null
  try {
    tab.location.href = await catalog.getConnectionPage(service)
  } catch (error) {
    tab.close()
    throw error
  }
}

export function getGroupCollapsed(
  defs: readonly (InputHandleDef | OutputHandleDef | GroupDividerDef)[] | undefined,
  userGroupsCollapsed: boolean | 'default' | undefined,
): Record<string, boolean> | undefined {
  if (!defs) return
  if (userGroupsCollapsed === false) return

  let result: Record<string, boolean> | undefined
  for (const def of defs) {
    if (isGroupDividerDef(def)) {
      if (userGroupsCollapsed === true || def.collapsed) {
        ;(result ||= {})[def.group] = true
      }
    }
  }

  return result
}
