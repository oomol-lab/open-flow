import type { DisposableStore, Disposer } from '@wopjs/disposable'
import type { I18n } from 'val-i18n'
import type { ReadonlyVal, Val } from 'value-enhancer'
import type { ReactiveMap } from 'value-enhancer/collections'
import type { ConnectorCatalog } from '../../../connector/common/catalog.ts'
import type { ConnectorConnection } from '../../../connector/common/model.ts'
import type { LocaleTextStore } from '../../../localization/common/localization.ts'
import type { FlowLikePath } from '../../../manifest/common/manifestTypes.ts'
import type { SubflowBlockMeta } from '../../../manifest/common/meta/block/subflowBlockMeta.ts'
import type { TaskBlockMeta } from '../../../manifest/common/meta/block/taskBlockMeta.ts'
import type { CompareResult, CompareSchemaInfo } from '../../../manifest/common/schemaCompare.ts'
import type { HandleName } from '../../../schema/index.ts'
import type { TriggerCatalogCompatibleItem, TriggerCatalogItem } from '../../../trigger/common/catalog.ts'
import type { DesignerHost } from '../../common/designerHost.ts'
import type { FlowDisplayMode } from '../../common/flowDisplay.ts'
import type { PackageAuthoring } from '../../common/packageAuthoring.ts'
import type { BrowserTheme } from '../browserTheme.ts'
import type { DesignerConfirmation } from '../confirmation.ts'
import type { DirtyResourceTracker } from '../dirtyResourceTracker.ts'
import type { DesignerNotification } from '../notification.ts'
import type { ResourceNavigation } from '../resourceNavigation.ts'
import type { DesignerResourceService } from '../resourceService.ts'
import type { DesignerStore, IAddNodeMenuItem, IFromSource, InteractiveMode } from '../stores/designer/designer.store.ts'

import { disposableStore } from '@wopjs/disposable'
import { val } from 'value-enhancer'
import { jsonTryParse, jsonTryStringify } from '../../../base/common/parse.ts'
import { connectorActionIcon, connectorActionTitle } from '../../../connector/common/actionNode.ts'
import { connectorActionPorts } from '../../../connector/common/actionSchema.ts'
import { defaultConnection } from '../../../connector/common/model.ts'
import { WEBHOOK_TYPE } from '../../../trigger/common/builtins.ts'
import { encodeTriggerCatalogIdentity } from '../../../trigger/common/catalog.ts'
import { provideAddNodeMenuItems } from '../actions/addNodeMenuItems.ts'
import { ConnectorConnectionStore } from '../stores/designer/connectorConnection.store.ts'

export interface UIFile {
  readonly path: string
  readonly data: unknown
}

export interface CreateSchemaEditorOptions {
  readonly ariaLabel?: string
}

export interface CreateSchemaEditorFn {
  (dom: HTMLDivElement, schema$: Val<string> | ReadonlyVal<string>, options?: CreateSchemaEditorOptions): Disposer
}

// Comment nodes use the locale-aware editor.
export interface CreateL10nMarkdownEditorFn {
  (dom: HTMLDivElement, content$: Val<string | undefined>, lang$: ReadonlyVal<string>, userLocales?: LocaleTextStore): Disposer
}

export interface ScriptletEditorOptions {
  readonly path: string
  readonly readonly: boolean
  readonly typing: ReadonlyVal<readonly [language: string, content: string] | undefined>
}

export interface CreateScriptletEditorFn {
  (dom: HTMLDivElement, options: ScriptletEditorOptions): Disposer | void
}

export type SaveUIFile = () => Promise<void>

export interface AbstractDesignerServiceProps {
  readonly i18n: I18n
  readonly service: DesignerHost
  readonly designerStores: ReactiveMap<FlowLikePath, DesignerStore>
  readonly confirmation: DesignerConfirmation
  readonly dirtyResources: DirtyResourceTracker
  readonly expandScriptletEditor: ReadonlyVal<boolean>
  readonly defaultFlowDisplayMode?: ReadonlyVal<FlowDisplayMode>
  readonly navigation: ResourceNavigation
  readonly notification: DesignerNotification
  readonly resourceService: DesignerResourceService
  readonly packageAuthoring: PackageAuthoring
  readonly interactiveMode: Val<InteractiveMode>
  readonly theme: BrowserTheme
  readonly createSchemaEditor: CreateSchemaEditorFn
  readonly createL10nMarkdownEditor: CreateL10nMarkdownEditorFn
  readonly createScriptletEditor?: CreateScriptletEditorFn
  readonly connectorCatalog?: ConnectorCatalog
  readonly getTrigger?: (identity: string, signal?: AbortSignal) => Promise<TriggerCatalogCompatibleItem>
  readonly searchTriggers?: (query: string, signal?: AbortSignal) => Promise<readonly TriggerCatalogItem[]>
}

// This class shares host operations across the concrete designer modes.
export abstract class AbstractDesignerService {
  public readonly dispose: DisposableStore = disposableStore()

  protected readonly designerStores: ReactiveMap<FlowLikePath, DesignerStore>
  protected readonly service: DesignerHost
  protected readonly confirmation: DesignerConfirmation
  protected readonly dirtyResources: DirtyResourceTracker
  protected readonly expandScriptletEditor: ReadonlyVal<boolean>
  protected readonly defaultFlowDisplayMode: ReadonlyVal<FlowDisplayMode>
  protected readonly navigation: ResourceNavigation
  protected readonly notification: DesignerNotification
  protected readonly resourceService: DesignerResourceService
  protected readonly packageAuthoring: PackageAuthoring
  protected readonly interactiveMode: Val<InteractiveMode>
  protected readonly theme: BrowserTheme
  protected readonly i18n: I18n
  protected readonly connectorCatalog: ConnectorCatalog | undefined
  protected readonly connectorConnections: ConnectorConnectionStore | undefined
  protected readonly getTrigger: AbstractDesignerServiceProps['getTrigger']
  protected readonly searchTriggers: AbstractDesignerServiceProps['searchTriggers']
  public readonly createSchemaEditor: CreateSchemaEditorFn
  public readonly createL10nMarkdownEditor: CreateL10nMarkdownEditorFn
  public readonly createScriptletEditor: CreateScriptletEditorFn | undefined

  public readonly pendingSaveUIFiles: Map<string, SaveUIFile> = new Map()
  private readonly uiFileRevisions: Map<string, string | undefined> = new Map()
  private readonly uiFileSaves: Map<string, Promise<void>> = new Map()

  public constructor(props: AbstractDesignerServiceProps) {
    this.i18n = props.i18n
    this.theme = props.theme
    this.service = props.service
    this.designerStores = props.designerStores
    this.confirmation = props.confirmation
    this.dirtyResources = props.dirtyResources
    this.expandScriptletEditor = props.expandScriptletEditor
    this.defaultFlowDisplayMode = props.defaultFlowDisplayMode ?? this.dispose.add(val<FlowDisplayMode>('overview'))
    this.navigation = props.navigation
    this.notification = props.notification
    this.resourceService = props.resourceService
    this.packageAuthoring = props.packageAuthoring
    this.interactiveMode = props.interactiveMode
    this.createSchemaEditor = props.createSchemaEditor
    this.createL10nMarkdownEditor = props.createL10nMarkdownEditor
    this.createScriptletEditor = props.createScriptletEditor
    this.connectorCatalog = props.connectorCatalog
    this.connectorConnections = props.connectorCatalog == null ? undefined : new ConnectorConnectionStore(props.connectorCatalog)
    if (this.connectorConnections != null) {
      const connectorConnections = this.connectorConnections
      this.dispose.add(() => connectorConnections.dispose())
    }
    this.getTrigger = props.getTrigger
    this.searchTriggers = props.searchTriggers
  }

  //#region Node Service

  public readonly loadUIFile = async (manifestPath: string): Promise<UIFile> => {
    const { path, revision, source } = await this.service.locateAndReadUIFile(manifestPath)
    this.uiFileRevisions.set(path, revision)
    this.uiFileSaves.delete(path)

    let data: unknown
    if (source) {
      data = jsonTryParse(source)
    }

    return { path, data }
  }

  public readonly saveUIFile = (path: string, data: unknown): Promise<void> => {
    if (!this.uiFileRevisions.has(path)) {
      return Promise.reject(new Error(`Designer UI file ${path} must be read before it can be saved.`))
    }
    let content = ''
    if (data) {
      content = jsonTryStringify(data, true, true) || ''
    }
    const previous = this.uiFileSaves.get(path)
    const ready = previous ? previous.catch(() => undefined) : Promise.resolve()
    const save = ready.then(async () => {
      const result = await this.service.writeUIFile(path, {
        source: content || null,
        expectedRevision: this.uiFileRevisions.get(path),
      })
      if (result.status === 'conflict') {
        throw new Error(`Designer UI file ${path} changed outside this session.`)
      }
      this.uiFileRevisions.set(path, result.snapshot.revision)
    })
    this.uiFileSaves.set(path, save)
    const clearSave = () => {
      if (this.uiFileSaves.get(path) === save) this.uiFileSaves.delete(path)
    }
    void save.then(clearSave, clearSave)
    return save
  }

  protected readonly compareJSONSchema = (fromSchema: CompareSchemaInfo, toSchema: CompareSchemaInfo): Promise<CompareResult> =>
    this.service.compareJSONSchema(fromSchema, toSchema)

  //#endregion

  protected provideAddNodeMenuItems(fromSource?: IFromSource): IAddNodeMenuItem[] | undefined {
    const raw = this.packageAuthoring.getAddNodeItems()
    const result = provideAddNodeMenuItems(this.i18n, raw, fromSource, this.packageAuthoring.canWriteScriptlets)
    return result
  }

  protected async provideAsyncAddNodeMenuItems(
    fromSource: IFromSource | undefined,
    searchTerm: string,
    signal: AbortSignal,
  ): Promise<IAddNodeMenuItem[] | undefined> {
    if (this.connectorCatalog == null || searchTerm.trim().length == 0) return
    const catalog = this.connectorCatalog
    const actions = await catalog.searchActions(searchTerm, signal)
    const items: IAddNodeMenuItem[] = [{ type: 'divider', label: this.i18n.t('addNode.connectorActions') }]
    const connectionsByService = new Map(
      [...new Set(actions.map((action) => action.service))].map((service) => [service, catalog.listConnections(service, signal)]),
    )
    for (const action of actions) {
      const ports = connectorActionPorts(action.inputSchema, action.outputSchema)
      const handles = fromSource == null ? undefined : fromSource.side == 'left' ? ports.outputs : ports.inputs
      const connections = (await connectionsByService.get(action.service)!).filter((connection) => connection.status == 'active')
      const connection = defaultConnection(connections)
      items.push({
        type: 'connector',
        data: connection == null ? undefined : JSON.stringify({ actionId: action.actionId, connection: connection.id }),
        label: connectorActionTitle(action.name),
        detail: [action.service, action.actionId, ...connections.flatMap((item) => [item.displayName, item.id])].join(' '),
        description: connection == null ? this.i18n.t('addNode.connectorNoActiveConnection') : connection.displayName,
        icon: connectorActionIcon(action),
        choices:
          connection == null
            ? [
                {
                  data: JSON.stringify({ actionId: action.actionId, manageConnection: action.service }),
                  description: connectorActionTitle(action.service),
                  label: this.i18n.t('addNode.connectorNewConnection'),
                },
              ]
            : undefined,
        handles:
          connection == null
            ? undefined
            : handles?.map((handle) => ({
                description: handle.description,
                json_schema: handle.json_schema,
                name: handle.handle as HandleName,
              })),
      })
    }
    return actions.length == 0 ? [] : items
  }

  protected async provideTriggerAddNodeMenuItems(fromSource: IFromSource | undefined, searchTerm: string, signal: AbortSignal): Promise<IAddNodeMenuItem[]> {
    if (fromSource?.side == 'right') return []
    if (this.searchTriggers == null) {
      return [
        {
          type: 'trigger',
          disabled: true,
          detail: searchTerm,
          label: this.i18n.t('trigger.catalogUnavailable'),
          description: this.i18n.t('trigger.catalogUnavailableHelp'),
        },
      ]
    }
    let catalogItems: readonly TriggerCatalogItem[]
    try {
      catalogItems = await this.searchTriggers(searchTerm, signal)
    } catch {
      return [
        {
          type: 'trigger',
          disabled: true,
          detail: searchTerm,
          label: this.i18n.t('trigger.catalogUnavailable'),
          description: this.i18n.t('trigger.catalogUnavailableHelp'),
        },
      ]
    }

    const items: IAddNodeMenuItem[] = []
    const connectionsByService =
      this.connectorCatalog == null
        ? new Map<string, Promise<readonly ConnectorConnection[]>>()
        : new Map(
            [
              ...new Set(
                catalogItems.flatMap((item) =>
                  item.compatible && item.trigger.definition.connector != null ? [item.trigger.definition.connector.service_id] : [],
                ),
              ),
            ].map((service) => [service, this.connectorCatalog!.listConnections(service, signal)]),
          )
    for (const item of catalogItems) {
      if (!item.compatible) {
        items.push({
          type: 'trigger',
          disabled: true,
          label: item.name,
          detail: `${item.serviceName} ${item.type} ${item.revision}`,
          description: item.reason,
          icon: item.icon,
        })
        continue
      }
      const service = item.trigger.definition.connector?.service_id
      const connection = service == null ? undefined : defaultConnection((await connectionsByService.get(service)) ?? [])
      items.push(this.triggerAddNodeMenuItem(item, fromSource, connection))
    }
    if (catalogItems.length == 0) {
      items.push({
        type: 'trigger',
        disabled: true,
        detail: searchTerm,
        label: this.i18n.t('trigger.catalogEmpty'),
        description: this.i18n.t('trigger.catalogEmptyHelp'),
      })
    }
    return items
  }

  protected triggerAddNodeMenuItem(item: TriggerCatalogCompatibleItem, fromSource?: IFromSource, connection?: ConnectorConnection): IAddNodeMenuItem {
    const service = item.trigger.definition.connector?.service_id
    const requiresConnection = service != null
    const identity = encodeTriggerCatalogIdentity(item)
    return {
      type: 'trigger',
      data: requiresConnection && connection == null ? undefined : JSON.stringify({ identity, ...(connection == null ? {} : { connection: connection.id }) }),
      label: item.trigger.definition.name,
      detail: `${item.trigger.definition.service_name} ${item.type} ${item.revision}${connection == null ? '' : ` ${connection.displayName} ${connection.id}`}`,
      description:
        requiresConnection && connection == null
          ? this.i18n.t('addNode.connectorNoActiveConnection')
          : item.type == WEBHOOK_TYPE
            ? this.i18n.t('trigger.webhookDescription')
            : (connection?.displayName ?? item.description ?? item.trigger.definition.service_name),
      icon: item.icon,
      choices:
        service == null || connection != null
          ? undefined
          : [
              {
                data: JSON.stringify({ identity, manageConnection: service }),
                description: item.trigger.definition.service_name,
                label: this.i18n.t('addNode.connectorNewConnection'),
              },
            ],
      handles:
        fromSource == null || (requiresConnection && connection == null)
          ? undefined
          : [
              {
                name: 'payload' as HandleName,
                json_schema: item.trigger.definition.payload_schema,
              },
            ],
    }
  }

  protected readonly openBlockDesigner = (blockMeta: TaskBlockMeta | SubflowBlockMeta): void => {
    void this.navigation.open(blockMeta.blockPath)
  }
}
