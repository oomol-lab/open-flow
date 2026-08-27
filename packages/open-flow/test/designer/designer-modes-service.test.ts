import type { Revision } from '../../src/base/common/revision.ts'
import type { ConnectorCatalog } from '../../src/connector/common/catalog.ts'
import type { AbstractDesignerServiceProps } from '../../src/designer/browser/services/designerService.ts'
import type { DesignerStore, InteractiveMode } from '../../src/designer/browser/stores/designer/designer.store.ts'
import type { BlockPath, FlowLikePath, FlowPath, PackagePath, SearchPath } from '../../src/manifest/common/manifestTypes.ts'
import type { HandleName, NodeId } from '../../src/schema/index.ts'
import type { TriggerCatalogCompatibleItem } from '../../src/trigger/common/catalog.ts'

import { dispose } from '@wopjs/disposable'
import { readFile } from 'node:fs/promises'
import { I18n } from 'val-i18n'
import { val } from 'value-enhancer'
import { reactiveMap } from 'value-enhancer/collections'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserTheme } from '../../src/designer/browser/browserTheme.ts'
import { BrowserDesignerConfirmation } from '../../src/designer/browser/confirmation.ts'
import { BrowserDirtyResourceTracker } from '../../src/designer/browser/dirtyResourceTracker.ts'
import { BrowserDesignerNotification } from '../../src/designer/browser/notification.ts'
import { BrowserResourceNavigation } from '../../src/designer/browser/resourceNavigation.ts'
import { BrowserResourceService } from '../../src/designer/browser/resourceService.ts'
import { FlowDesignerService } from '../../src/designer/browser/services/flowDesignerService.ts'
import { SubflowBlockDesignerService } from '../../src/designer/browser/services/subflowDesignerService.ts'
import { TaskBlockDesignerService } from '../../src/designer/browser/services/taskDesignerService.ts'
import { SUBFLOW_VIEW_MODE } from '../../src/designer/browser/stores/designer/subflowDesigner.store.ts'
import { INPUT_NODE_ID, OUTPUT_NODE_ID } from '../../src/designer/browser/stores/node/constants.ts'
import { TriggerSectionStore } from '../../src/designer/browser/stores/node/nodeSection/triggerSection.store.ts'
import { TaskNodeStore } from '../../src/designer/browser/stores/node/taskNode.store.ts'
import { TriggerNodeStore } from '../../src/designer/browser/stores/node/triggerNode.store.ts'
import { FileBackedDesignerHost } from '../../src/designer/common/fileBackedDesignerHost.ts'
import { ManifestPackageAuthoring } from '../../src/designer/common/manifestPackageAuthoring.ts'
import { PackageMeta } from '../../src/manifest/common/meta/package/packageMeta.ts'
import { toInlineTaskBlockManifest } from '../../src/manifest/common/model/block/inlineTaskBlockManifest.ts'
import { toTaskNodeManifest } from '../../src/manifest/common/model/node/taskNodeManifest.ts'
import { WritableTriggerNodeManifest } from '../../src/manifest/common/writable/node/writableTriggerNodeManifest.ts'
import { WritablePackageManifest } from '../../src/manifest/common/writable/writablePackageManifest.ts'
import { webhookTrigger } from '../../src/trigger/common/builtins.ts'
import { encodeTriggerCatalogIdentity } from '../../src/trigger/common/catalog.ts'
import { MemoryDesignerHost } from '../support/memory-designer-host.ts'

vi.mock('@wopjs/dom', () => ({
  addEventListener: (target: EventTarget, type: string, listener: EventListener) => {
    target.addEventListener(type, listener)
    return () => target.removeEventListener(type, listener)
  },
  listen: (target: EventTarget, type: string, listener: EventListener) => {
    target.addEventListener(type, listener)
    return () => target.removeEventListener(type, listener)
  },
}))
const root = '/workspace' as SearchPath
const packagePath = `${root}/package.oo.yaml` as PackagePath
const flowPath = `${root}/flows/designer-showcase/flow.oo.yaml` as FlowPath
const taskPath = `${root}/tasks/greet/task.oo.yaml` as BlockPath
const subflowPath = `${root}/subflows/designer-showcase/subflow.oo.yaml` as BlockPath
const revision = 'designer-modes-revision' as Revision

async function fixtureSource(relativePath: string): Promise<string> {
  return readFile(new URL(`../../examples/${relativePath}`, import.meta.url), 'utf8')
}

describe('Task and Subflow Designer services', () => {
  beforeEach(() => {
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    vi.stubGlobal('navigator', { platform: '' })
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn(() => 1),
    )
    vi.stubGlobal('window', Object.assign(new EventTarget(), { open: vi.fn<Window['open']>() }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('constructs source-backed stores and applies graph UI sidecars', async () => {
    const [packageSource, flowSource, taskSource, subflowSource] = await Promise.all([
      fixtureSource('package.oo.yaml'),
      fixtureSource('flows/designer-showcase/flow.oo.yaml'),
      fixtureSource('tasks/greet/task.oo.yaml'),
      fixtureSource('subflows/designer-showcase/subflow.oo.yaml'),
    ])
    const taskUISource = JSON.stringify({
      nodes: { greet: { rfNode: { position: { x: 0, y: 0 } } } },
      viewport: { x: 81.96989540460362, y: 159.62778671454694, zoom: 0.7258461734202065 },
    })
    const subflowUISource = JSON.stringify({
      nodes: { 'format-message': { rfNode: { position: { x: 430, y: 120 } } } },
      pseudoNodes: {
        input: { rfNode: { position: { x: 0, y: 120 } } },
        output: { rfNode: { position: { x: 860, y: 120 } } },
      },
      viewport: { x: 57, y: 84, zoom: 0.82 },
    })
    const context = new MemoryDesignerHost([
      { path: packagePath, source: packageSource, revision },
      { path: flowPath, source: flowSource, revision },
      { path: taskPath, source: taskSource, revision },
      { path: `${root}/tasks/greet/.task.ui.oo.json`, source: taskUISource, revision },
      { path: subflowPath, source: subflowSource, revision },
      { path: `${root}/subflows/designer-showcase/.subflow.ui.oo.json`, source: subflowUISource, revision },
    ])
    const packageMeta = new PackageMeta({
      packagePath,
      searchPath: root,
      manifest: new WritablePackageManifest(packageSource, revision),
      ctx: context,
    })
    await packageMeta.sharedBlocks.refreshAll()
    await packageMeta.flows.refreshFlow(flowPath, true)
    const taskMeta = await packageMeta.sharedBlocks.refreshTaskBlock(taskPath)
    const subflowMeta = await packageMeta.sharedBlocks.refreshSubflowBlock(subflowPath)
    expect(taskMeta).toBeDefined()
    expect(subflowMeta).toBeDefined()
    taskMeta!.manifest.$$.ui.set({ default_width: 460 })
    subflowMeta!.manifest.$$.ui.set({ default_width: 500 })

    const confirmation = new BrowserDesignerConfirmation()
    const dirtyResources = new BrowserDirtyResourceTracker()
    const navigation = new BrowserResourceNavigation()
    const notification = new BrowserDesignerNotification()
    const theme = new BrowserTheme({ preferredColorScheme$: val<'auto' | 'dark' | 'light'>('light') })
    const createScriptletEditor = vi.fn(() => () => undefined)
    const connectorCatalog: ConnectorCatalog = {
      getAction: vi.fn(async () => ({
        actionId: 'github.create_issue',
        authenticated: true,
        description: 'Create an issue.',
        homepageUrl: 'https://github.com/features/actions',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' }, body: { type: 'string' }, state: { type: 'string', default: 'open' } },
          required: ['title'],
        },
        name: 'create_issue',
        outputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
        service: 'github',
      })),
      getConnectionPage: vi.fn(async () => 'https://connector.example/providers/github'),
      listConnections: vi.fn(async () => [{ displayName: 'Work GitHub', id: 'github-work', isDefault: true, service: 'github', status: 'active' as const }]),
      searchActions: vi.fn(async () => [
        {
          actionId: 'github.create_issue',
          authenticated: true,
          description: 'Create an issue.',
          homepageUrl: 'https://github.com/features/actions',
          inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
          name: 'create_issue',
          outputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
          service: 'github',
        },
      ]),
    }
    const triggerCatalogItem: TriggerCatalogCompatibleItem = {
      compatible: true,
      definitionDigest: `sha256:${'0'.repeat(64)}`,
      description: 'Runs when a repository receives a push.',
      icon: 'https://example.test/github.svg',
      revision: '1',
      trigger: {
        config: { repository: 'oomol/open-flow' },
        definition: {
          connector: {
            account_required: true,
            service_id: 'github',
          },
          config_schema: {
            additionalProperties: false,
            properties: { repository: { type: 'string' } },
            required: ['repository'],
            type: 'object',
          },
          name: 'Push',
          provisioning: { kind: 'webhook' },
          payload_schema: {
            additionalProperties: true,
            properties: { ref: { type: 'string' } },
            required: ['ref'],
            type: 'object',
          },
          service_id: 'github',
          service_name: 'GitHub',
        },
        revision: '1',
        type: 'github.push',
      },
      type: 'github.push',
    }
    const getTrigger = vi.fn(async () => triggerCatalogItem)
    const searchTriggers = vi.fn(async () => [triggerCatalogItem])
    const designerStores = reactiveMap<FlowLikePath, DesignerStore>(null, { onDeleted: dispose })
    const serviceProps: AbstractDesignerServiceProps = {
      i18n: new I18n('en', {
        en: {
          addNode: {
            connectorNewConnection: 'New Connection',
            connectorNoActiveConnection: 'No active connection',
            connectorPopupBlocked: 'The connection window was blocked. Allow pop-ups and try again.',
            scriptletUnsupported: 'Writing scriptlets is not supported by this project host.',
          },
          clipboard: {
            pasteScriptletUnsupported: 'Pasting scriptlets is not supported by this project host.',
          },
          trigger: {
            webhookDescription: 'Receive a JSON object through a generated HTTP endpoint.',
          },
        },
      }),
      service: new FileBackedDesignerHost({
        files: context,
        compareJSONSchema: async () => ({ kind: 'compatible' }),
      }),
      designerStores,
      confirmation,
      dirtyResources,
      expandScriptletEditor: val(false),
      navigation,
      notification,
      resourceService: new BrowserResourceService(),
      packageAuthoring: new ManifestPackageAuthoring({ packageMeta }),
      interactiveMode: val<InteractiveMode>('mouse'),
      theme,
      createSchemaEditor: () => () => {},
      createL10nMarkdownEditor: () => () => {},
      createScriptletEditor,
      connectorCatalog,
      getTrigger,
      searchTriggers,
    }
    const taskService = new TaskBlockDesignerService(serviceProps)
    const subflowService = new SubflowBlockDesignerService(serviceProps)
    const flowService = new FlowDesignerService(serviceProps)

    try {
      const taskStore = taskService.createTaskBlockDesignerStore(taskMeta!)
      const subflowStore = subflowService.createSubflowDesignerStore(subflowMeta!)
      const flowMeta = packageMeta.flows.flowsByPath.get(flowPath)
      if (flowMeta == null) throw new Error('The Flow is missing.')
      const flowStore = flowService.createFlowDesignerStore(flowMeta)
      designerStores.set(taskPath, taskStore)
      designerStores.set(subflowPath, subflowStore)
      designerStores.set(flowPath, flowStore)
      await Promise.all([taskService.whenReady(taskStore), subflowService.whenReady(subflowStore), flowService.whenReady(flowStore)])

      expect((subflowStore.provideAddNodeMenuItems?.() ?? []).some((item) => item.type == 'trigger')).toBe(false)
      const builtInTriggerItem = (flowStore.provideAddNodeMenuItems?.() ?? []).find((item) => item.type == 'trigger' && item.data != null)
      if (builtInTriggerItem?.type != 'trigger' || builtInTriggerItem.data == null) {
        throw new Error('The built-in Webhook Trigger is missing from the Flow add node menu.')
      }
      expect(builtInTriggerItem.label).toBe('Webhook')
      expect(builtInTriggerItem.description).toBe('Receive a JSON object through a generated HTTP endpoint.')
      getTrigger.mockClear()
      assert(flowStore.onAddNode)
      const webhookNodeId = await flowStore.onAddNode('trigger', builtInTriggerItem.data, { x: 100, y: 100 })
      expect(webhookNodeId).toBeDefined()
      expect(getTrigger).not.toHaveBeenCalled()
      await vi.waitFor(() => expect(TriggerNodeStore.is(flowStore.$.nodes.get(webhookNodeId!))).toBe(true))
      expect(WritableTriggerNodeManifest.to(flowMeta.nodes.get(webhookNodeId!)?.manifest)?.$.trigger.value).toEqual({
        config: webhookTrigger.trigger.config,
        revision: webhookTrigger.revision,
        type: webhookTrigger.type,
      })
      expect(flowMeta.manifest.$.trigger_definitions.value).toEqual([
        {
          definition: webhookTrigger.trigger.definition,
          revision: webhookTrigger.revision,
          type: webhookTrigger.type,
        },
      ])
      const webhookNodeStore = flowStore.$.nodes.get(webhookNodeId!)
      if (!TriggerNodeStore.is(webhookNodeStore)) throw new Error('The built-in Webhook Trigger node is missing.')
      expect(webhookNodeStore.display$.outputs_def.value).toEqual([
        {
          handle: 'payload',
          json_schema: webhookTrigger.trigger.definition.payload_schema,
        },
      ])
      const webhookSection = webhookNodeStore.display$.sections.value.find((section) => section instanceof TriggerSectionStore)
      if (!(webhookSection instanceof TriggerSectionStore)) throw new Error('The Webhook Trigger configuration section is missing.')
      expect(webhookSection.config.$.valueHandleDefs.value).toEqual([
        {
          handle: 'config',
          json_schema: webhookTrigger.trigger.definition.config_schema,
          value: webhookTrigger.trigger.config,
        },
      ])
      flowStore.onDeleteNodes?.([webhookNodeStore])
      await vi.waitFor(() => expect(flowMeta.nodes.has(webhookNodeId!)).toBe(false))
      expect(flowMeta.manifest.$.trigger_definitions.value).toBeUndefined()

      const subflowAddItems = await subflowStore.provideAsyncAddNodeMenuItems?.(undefined, 'github push', AbortSignal.timeout(30_000))
      expect(subflowAddItems?.some((item) => item.type == 'trigger')).toBe(false)

      const defaultFlowAddItems = await flowStore.provideAsyncAddNodeMenuItems?.(undefined, '', AbortSignal.timeout(30_000))
      expect(defaultFlowAddItems?.some((item) => item.type == 'trigger' && item.label == 'Push')).toBe(true)

      const flowAddItems = await flowStore.provideAsyncAddNodeMenuItems?.(undefined, 'github push', AbortSignal.timeout(30_000))
      const triggerAddItem = flowAddItems?.find((item) => item.type == 'trigger' && !item.disabled)
      if (triggerAddItem?.type != 'trigger' || triggerAddItem.data == null) throw new Error('The Trigger is missing from the Flow add node menu.')
      expect(triggerAddItem.label).toBe('Push')
      expect(triggerAddItem.handles).toBeUndefined()
      const connectionRequestCount = vi.mocked(connectorCatalog.listConnections).mock.calls.length
      expect(connectionRequestCount).toBeGreaterThan(0)

      assert(flowStore.onAddNode)
      const triggerNodeId = await flowStore.onAddNode('trigger', triggerAddItem.data, { x: 200, y: 100 })
      expect(triggerNodeId).toBeDefined()
      expect(getTrigger).toHaveBeenCalledWith(encodeTriggerCatalogIdentity(triggerCatalogItem), undefined)
      expect(connectorCatalog.listConnections).toHaveBeenCalledTimes(connectionRequestCount)
      await vi.waitFor(() => expect(TriggerNodeStore.is(flowStore.$.nodes.get(triggerNodeId!))).toBe(true))
      const triggerNodeStore = flowStore.$.nodes.get(triggerNodeId!)
      if (!TriggerNodeStore.is(triggerNodeStore)) throw new Error('The created Trigger node is missing.')
      expect(triggerNodeStore.display$.outputs_def.value).toEqual([
        {
          handle: 'payload',
          json_schema: triggerCatalogItem.trigger.definition.payload_schema,
        },
      ])
      const triggerSection = triggerNodeStore.display$.sections.value.find((section) => section instanceof TriggerSectionStore)
      if (!(triggerSection instanceof TriggerSectionStore)) throw new Error('The Trigger configuration section is missing.')
      expect(triggerSection.config.$.valueHandleDefs.value).toEqual([
        {
          handle: 'config',
          json_schema: triggerCatalogItem.trigger.definition.config_schema,
          value: { repository: 'oomol/open-flow' },
        },
      ])
      triggerSection.config.$$.valueHandleDefs?.set([
        {
          handle: 'config' as HandleName,
          json_schema: triggerCatalogItem.trigger.definition.config_schema,
          value: { repository: 'oomol/next' },
        },
      ])
      await vi.waitFor(() =>
        expect(WritableTriggerNodeManifest.to(flowMeta.nodes.get(triggerNodeId!)?.manifest)?.$.trigger.value?.config).toEqual({ repository: 'oomol/next' }),
      )
      expect(WritableTriggerNodeManifest.to(flowMeta.nodes.get(triggerNodeId!)?.manifest)?.$.trigger.value?.connection).toBe('github-work')

      const existingNodeIds = new Set(flowMeta.nodes.keys())
      assert(flowStore.onDuplicate)
      await flowStore.onDuplicate([triggerNodeId!])
      await vi.waitFor(() => expect([...flowMeta.nodes.keys()].some((nodeId) => !existingNodeIds.has(nodeId))).toBe(true))
      const duplicateTriggerId = [...flowMeta.nodes.keys()].find((nodeId) => !existingNodeIds.has(nodeId))
      expect(WritableTriggerNodeManifest.to(flowMeta.nodes.get(duplicateTriggerId!)?.manifest)?.$.trigger.value).toEqual(
        WritableTriggerNodeManifest.to(flowMeta.nodes.get(triggerNodeId!)?.manifest)?.$.trigger.value,
      )
      await vi.waitFor(() => expect(TriggerNodeStore.is(flowStore.$.nodes.get(duplicateTriggerId!))).toBe(true))
      const duplicateTriggerStore = flowStore.$.nodes.get(duplicateTriggerId!)
      if (!TriggerNodeStore.is(duplicateTriggerStore)) throw new Error('The duplicated Trigger node is missing.')
      flowStore.onDeleteNodes?.([duplicateTriggerStore])
      await vi.waitFor(() => expect(flowMeta.nodes.has(duplicateTriggerId!)).toBe(false))

      vi.mocked(connectorCatalog.listConnections).mockResolvedValue([])
      const disconnectedItems = await flowStore.provideAsyncAddNodeMenuItems?.(undefined, 'github push', AbortSignal.timeout(30_000))
      const disconnectedTrigger = disconnectedItems?.find((item) => item.type == 'trigger' && item.label == 'Push')
      if (disconnectedTrigger?.type != 'trigger') {
        throw new Error('The disconnected Trigger entry is missing from the Flow add node menu.')
      }
      expect(disconnectedTrigger.disabled).toBeUndefined()
      expect(disconnectedTrigger.data).toBeUndefined()
      expect(disconnectedTrigger.description).toBe('No active connection')
      expect(disconnectedTrigger.choices).toHaveLength(1)
      const newTriggerConnection = disconnectedTrigger.choices?.[0]
      if (newTriggerConnection == null) throw new Error('The Trigger connection action is missing.')
      expect(newTriggerConnection.label).toBe('New Connection')
      expect(newTriggerConnection.description).toBe('GitHub')
      expect(JSON.parse(newTriggerConnection.data)).toEqual({
        identity: encodeTriggerCatalogIdentity(triggerCatalogItem),
        manageConnection: 'github',
      })
      const disconnectedAction = disconnectedItems?.find((item) => item.type == 'connector')
      if (disconnectedAction?.type != 'connector') {
        throw new Error('The disconnected Connector action is missing from the add node menu.')
      }
      expect(disconnectedAction.disabled).toBeUndefined()
      expect(disconnectedAction.data).toBeUndefined()
      expect(disconnectedAction.description).toBe('No active connection')
      expect(disconnectedAction.choices).toHaveLength(1)
      const newActionConnection = disconnectedAction.choices?.[0]
      if (newActionConnection == null) throw new Error('The Connector action connection action is missing.')
      expect(newActionConnection.label).toBe('New Connection')
      expect(newActionConnection.description).toBe('Github')
      expect(JSON.parse(newActionConnection.data)).toEqual({ actionId: 'github.create_issue', manageConnection: 'github' })

      const connectionTab = { close: vi.fn(), location: { href: 'about:blank' }, opener: window }
      vi.mocked(window.open).mockReturnValue(connectionTab as unknown as Window)
      await expect(flowStore.onAddNode('trigger', newTriggerConnection.data, { x: 200, y: 100 })).resolves.toBeUndefined()
      expect(connectorCatalog.getConnectionPage).toHaveBeenCalledWith('github')
      expect(window.open).toHaveBeenCalledWith('about:blank', '_blank')
      expect(connectionTab.opener).toBeNull()
      expect(connectionTab.location.href).toBe('https://connector.example/providers/github')
      vi.mocked(connectorCatalog.listConnections).mockResolvedValue([
        { displayName: 'Work GitHub', id: 'github-work', isDefault: true, service: 'github', status: 'active' },
      ])

      searchTriggers.mockRejectedValueOnce(new Error('Trigger Catalog unavailable.'))
      const offlineItems = await flowStore.provideAsyncAddNodeMenuItems?.(undefined, 'github push', AbortSignal.timeout(30_000))
      expect(offlineItems?.some((item) => item.type == 'trigger' && item.disabled)).toBe(true)
      expect(WritableTriggerNodeManifest.to(flowMeta.nodes.get(triggerNodeId!)?.manifest)?.$.trigger.value?.revision).toBe('1')

      navigation.setFocused(flowPath)
      vi.stubGlobal('document', { activeElement: null })
      vi.stubGlobal('getSelection', () => null)
      const triggerPasteEvent = new Event('paste')
      Object.defineProperty(triggerPasteEvent, 'clipboardData', {
        value: {
          getData: (type: string) =>
            type == 'text'
              ? JSON.stringify({
                  projectRoot: root,
                  triggerDefinitions: [
                    {
                      definition: triggerCatalogItem.trigger.definition,
                      revision: triggerCatalogItem.revision,
                      type: triggerCatalogItem.type,
                    },
                  ],
                  nodes: [
                    {
                      data: {
                        node_id: 'pasted-trigger',
                        title: 'Pasted push',
                        trigger: {
                          config: triggerCatalogItem.trigger.config,
                          connection: 'github-work',
                          revision: triggerCatalogItem.revision,
                          type: triggerCatalogItem.type,
                        },
                      },
                      nodeId: 'pasted-trigger',
                      type: 'trigger_node',
                      ui: { rfNode: { position: { x: 100, y: 100 } } },
                    },
                  ],
                })
              : '',
        },
      })
      window.dispatchEvent(triggerPasteEvent)
      const pastedTriggerId = 'pasted-trigger#1' as NodeId
      await vi.waitFor(() => expect(TriggerNodeStore.is(flowStore.$.nodes.get(pastedTriggerId))).toBe(true))
      expect(WritableTriggerNodeManifest.to(flowMeta.nodes.get(pastedTriggerId)?.manifest)?.$.trigger.value).toEqual({
        config: triggerCatalogItem.trigger.config,
        connection: 'github-work',
        revision: triggerCatalogItem.revision,
        type: triggerCatalogItem.type,
      })
      const pastedTriggerStore = flowStore.$.nodes.get(pastedTriggerId)
      if (!TriggerNodeStore.is(pastedTriggerStore)) throw new Error('The pasted Trigger node is missing.')
      flowStore.onDeleteNodes?.([pastedTriggerStore])
      await vi.waitFor(() => expect(flowMeta.nodes.has(pastedTriggerId)).toBe(false))

      expect(taskStore.onRenameDirName).toBeTypeOf('function')
      expect(subflowStore.onRenameDirName).toBeTypeOf('function')
      const notificationError = vi.spyOn(notification, 'error')
      vi.spyOn(taskService, 'userRenameTaskBlock').mockRejectedValueOnce(new Error('Task rename failed.'))
      vi.spyOn(subflowService, 'userRenameSubflowBlock').mockRejectedValueOnce(new Error('Subflow rename failed.'))
      taskStore.onRenameDirName?.('greet', 'renamed-task')
      subflowStore.onRenameDirName?.('designer-showcase', 'renamed-subflow')
      await vi.waitFor(() => {
        expect(notificationError).toHaveBeenCalledWith('Task rename failed.')
        expect(notificationError).toHaveBeenCalledWith('Subflow rename failed.')
      })

      expect([...taskStore.$.nodes.keys()]).toEqual(['greet'])
      expect(taskStore.$.viewport.value).toEqual({ x: 81.96989540460362, y: 159.62778671454694, zoom: 0.7258461734202065 })
      expect(taskService.pendingSaveUIFiles.has(taskPath)).toBe(true)
      const taskNodeStore = taskStore.$.nodes.get('greet' as NodeId)
      assert(TaskNodeStore.is(taskNodeStore))
      const taskManifest = taskMeta!.manifest
      const subflowManifest = subflowMeta!.manifest
      expect(taskManifest.$).not.toHaveProperty('timeout')
      expect(subflowManifest.$).not.toHaveProperty('timeout')
      expect(taskNodeStore.uiStore.$.contentWidth.value).toBe(460)
      expect(subflowStore.flowNode.uiStore.$.contentWidth.value).toBe(500)
      taskNodeStore.uiStore.$$.contentWidth.set(480)
      await vi.waitFor(() => expect(taskManifest.$.ui.value?.default_width).toBe(480))
      subflowStore.$$.viewMode.set(SUBFLOW_VIEW_MODE.Block)
      subflowStore.flowNode.uiStore.$$.contentWidth.set(520)
      await vi.waitFor(() => expect(subflowManifest.$.ui.value?.default_width).toBe(520))
      subflowStore.$$.viewMode.set(SUBFLOW_VIEW_MODE.Flow)

      expect([...subflowStore.$.nodes.keys()]).toEqual(['format-message'])
      expect(subflowStore.$.nodes.get('format-message' as NodeId)?.$.position.value).toEqual({ x: 430, y: 120 })
      expect(TaskNodeStore.is(subflowStore.$.nodes.get('format-message' as NodeId))).toBe(true)
      expect(subflowStore.pseudoNodes.get(INPUT_NODE_ID)?.$.position.value).toEqual({ x: 0, y: 120 })
      expect(subflowStore.pseudoNodes.get(OUTPUT_NODE_ID)?.$.position.value).toEqual({ x: 860, y: 120 })
      expect(subflowService.pendingSaveUIFiles.has(subflowPath)).toBe(true)

      const referenceTaskNode = flowStore.$.nodes.get('greet' as NodeId)
      if (!TaskNodeStore.is(referenceTaskNode)) throw new Error('The reference Task node is missing.')
      expect(referenceTaskNode.openSharedTaskSource).toBeTypeOf('function')
      expect(referenceTaskNode.openExecutorEntry).toBeUndefined()

      taskStore.$$.viewport.set({ x: 25, y: 50, zoom: 1.5 })
      await vi.waitFor(() => expect(dirtyResources.resources$.value.has(taskPath)).toBe(true))
      await taskService.pendingSaveUIFiles.get(taskPath)?.()
      const savedTaskUI = await context.readUIFile(`${root}/tasks/greet/.task.ui.oo.json`)
      expect(JSON.parse(savedTaskUI.source!)).toMatchObject({ viewport: { x: 25, y: 50, zoom: 1.5 } })

      assert(subflowStore.onAddNode)
      const scriptletNodeId = await subflowStore.onAddNode('scriptlet', 'typescript', { x: 0, y: 0 })
      expect(scriptletNodeId).toBeDefined()
      await vi.waitFor(() => expect(subflowStore.$.nodes.has(scriptletNodeId!)).toBe(true))
      const createdScriptletNode = subflowStore.$.nodes.get(scriptletNodeId!)
      if (!TaskNodeStore.is(createdScriptletNode)) throw new Error('The created scriptlet node is not a Task node.')
      expect(createdScriptletNode.uiStore.$.contentWidth.value).toBe(450)
      expect(createdScriptletNode.display$.sections.value.map((section) => section.type)).toContain('scriptlet')
      expect(createdScriptletNode.display$.sections.value.find((section) => section.type == 'scriptlet')?.uiState$.value).toEqual({ cardCollapsed: true })
      expect(createdScriptletNode.openSharedTaskSource).toBeUndefined()
      expect(createdScriptletNode.openBlockDesigner).toBeUndefined()
      expect(createdScriptletNode.openExecutorEntry).toBeTypeOf('function')
      await createdScriptletNode.openExecutorEntry?.()
      expect(navigation.focusedResource$.value).toMatch(/\/scriptlets\/.+\.ts$/)

      const inlineTaskNode = subflowStore.$.nodes.get('format-message' as NodeId)
      if (!TaskNodeStore.is(inlineTaskNode)) throw new Error('The inline Task node is missing.')
      expect(inlineTaskNode.openSharedTaskSource).toBeUndefined()
      expect(inlineTaskNode.openBlockDesigner).toBeUndefined()
      expect(inlineTaskNode.openExecutorEntry).toBeTypeOf('function')
      await inlineTaskNode.openExecutorEntry?.()
      expect(navigation.focusedResource$.value).toBe(`${root}/tasks/greet/main.ts`)
      const createdScriptletMeta = subflowMeta!.nodes.get(scriptletNodeId!)
      const createdInlineTask = toInlineTaskBlockManifest(toTaskNodeManifest(createdScriptletMeta!.manifest)?.$.task.value)?.toJSON()
      expect(createdInlineTask).not.toHaveProperty('ui')
      expect(createdInlineTask).toMatchObject({
        executor: { name: 'javascript', options: { entry: expect.stringMatching(/^scriptlets\/.+\.ts$/) } },
      })
      await subflowService.pendingSaveUIFiles.get(subflowPath)?.()
      const savedSubflowUI = await context.readUIFile(`${root}/subflows/designer-showcase/.subflow.ui.oo.json`)
      expect(JSON.parse(savedSubflowUI.source!).nodes?.[scriptletNodeId!]?.contentWidth).toBe(450)

      vi.mocked(connectorCatalog.listConnections).mockResolvedValueOnce([
        { displayName: 'Work GitHub', id: 'github-work', isDefault: true, service: 'github', status: 'active' },
        { displayName: 'Personal GitHub', id: 'github-personal', isDefault: false, service: 'github', status: 'active' },
      ])
      const connectorItems = await subflowStore.provideAsyncAddNodeMenuItems?.(undefined, 'github issue', AbortSignal.timeout(30_000))
      expect(subflowStore.connectorConnections).toBeDefined()
      const connectorActions = connectorItems?.filter((item) => item.type == 'connector')
      expect(connectorActions).toHaveLength(1)
      const connectorItem = connectorActions?.[0]
      if (connectorItem?.type != 'connector') throw new Error('The Connector action is missing from the add node menu.')
      expect(connectorItem?.icon).toBe('https://www.google.com/s2/favicons?domain=github.com&sz=64')
      expect(connectorItem.label).toBe('Create Issue')
      expect(connectorItem.data).toBe(JSON.stringify({ actionId: 'github.create_issue', connection: 'github-work' }))
      expect(connectorItem.choices).toBeUndefined()
      const connectorNodeId = await subflowStore.onAddNode('connector', JSON.stringify({ actionId: 'github.create_issue', connection: 'github-work' }), {
        x: 100,
        y: 100,
      })
      expect(connectorNodeId).toBeDefined()
      await vi.waitFor(() => expect(subflowStore.$.nodes.has(connectorNodeId!)).toBe(true))
      const connectorMeta = subflowMeta!.nodes.get(connectorNodeId!)
      expect(connectorMeta).toBeDefined()
      expect(connectorMeta!.manifest.$.icon.value).toBe('https://www.google.com/s2/favicons?domain=github.com&sz=64')
      expect(connectorMeta!.manifest.$.title.value).toBe('Create Issue #1')
      expect(toInlineTaskBlockManifest(toTaskNodeManifest(connectorMeta!.manifest)?.$.task.value)?.toJSON()).toMatchObject({
        executor: { name: 'connector', options: { action: 'github.create_issue', connection: 'github-work' } },
        inputs_def: expect.arrayContaining([expect.objectContaining({ handle: 'body' })]),
      })
      expect(connectorMeta!.manifest.$.inputs_from.value?.map(({ handle, value }) => ({ handle, value }))).toEqual([
        { handle: 'body', value: null },
        { handle: 'state', value: 'open' },
      ])
      subflowMeta!.removeNodes(connectorMeta!)
      await vi.waitFor(() => expect(subflowStore.$.nodes.has(connectorNodeId!)).toBe(false))

      vi.mocked(connectorCatalog.listConnections).mockResolvedValueOnce([])
      await expect(
        subflowStore.onAddNode('connector', JSON.stringify({ actionId: 'github.create_issue', connection: 'github-work' }), { x: 100, y: 100 }),
      ).resolves.toBeUndefined()
      expect(notificationError).toHaveBeenCalledWith('Connector connection "github-work" is not active for service "github".')

      vi.mocked(connectorCatalog.getAction).mockRejectedValueOnce(new Error('Connector catalog unavailable.'))
      await expect(
        subflowStore.onAddNode('connector', JSON.stringify({ actionId: 'github.create_issue', connection: 'github-work' }), { x: 100, y: 100 }),
      ).resolves.toBeUndefined()
      expect(notificationError).toHaveBeenCalledWith('Connector catalog unavailable.')

      const renameDisabledProps: AbstractDesignerServiceProps = {
        ...serviceProps,
        packageAuthoring: new ManifestPackageAuthoring({ packageMeta, canRenameSharedBlocks: false, canWriteScriptlets: false }),
      }
      const renameDisabledTaskService = new TaskBlockDesignerService(renameDisabledProps)
      const renameDisabledSubflowService = new SubflowBlockDesignerService(renameDisabledProps)
      const renameDisabledTaskStore = renameDisabledTaskService.createTaskBlockDesignerStore(taskMeta!)
      const renameDisabledSubflowStore = renameDisabledSubflowService.createSubflowDesignerStore(subflowMeta!)
      try {
        await Promise.all([renameDisabledTaskService.whenReady(renameDisabledTaskStore), renameDisabledSubflowService.whenReady(renameDisabledSubflowStore)])
        expect(renameDisabledTaskStore.onRenameDirName).toBeUndefined()
        expect(renameDisabledSubflowStore.onRenameDirName).toBeUndefined()
        const addNodeItems = renameDisabledSubflowStore.provideAddNodeMenuItems?.() ?? []
        expect(addNodeItems.some((item) => item.type === 'scriptlet')).toBe(false)
        const scriptletNode = renameDisabledSubflowStore.$.nodes.get(scriptletNodeId!)
        expect(scriptletNode?.duplicateNode).toBeUndefined()
        assert(renameDisabledSubflowStore.onDuplicate)
        await renameDisabledSubflowStore.onDuplicate([scriptletNodeId!])
        expect([...subflowMeta!.nodes.keys()]).toEqual(['format-message', scriptletNodeId])
        assert(renameDisabledSubflowStore.onAddNode)
        await expect(renameDisabledSubflowStore.onAddNode('scriptlet', 'typescript', { x: 0, y: 0 })).resolves.toBeUndefined()
        expect(notificationError).toHaveBeenCalledWith('Writing scriptlets is not supported by this project host.')

        dispose(subflowStore)
        subflowService.dispose()
        navigation.setFocused(subflowPath)
        vi.stubGlobal('document', { activeElement: null })
        vi.stubGlobal('getSelection', () => null)
        notificationError.mockClear()
        const pasteEvent = new Event('paste')
        Object.defineProperty(pasteEvent, 'clipboardData', {
          value: {
            getData: (type: string) =>
              type == 'text'
                ? JSON.stringify({
                    projectRoot: root,
                    nodes: [
                      {
                        nodeId: 'scriptlet',
                        type: 'task_node',
                        data: {
                          node_id: 'scriptlet',
                          task: { executor: { name: 'javascript', options: { entry: 'scriptlets/main.ts' } } },
                        },
                        scriptletSource: 'export default function () {}',
                      },
                    ],
                  })
                : '',
          },
        })
        window.dispatchEvent(pasteEvent)
        await vi.waitFor(() => expect(notificationError).toHaveBeenCalledWith('Pasting scriptlets is not supported by this project host.'))
        expect([...subflowMeta!.nodes.keys()]).toEqual(['format-message', scriptletNodeId])
      } finally {
        dispose(renameDisabledTaskStore)
        dispose(renameDisabledSubflowStore)
        renameDisabledTaskService.dispose()
        renameDisabledSubflowService.dispose()
      }
      const scriptletMeta = subflowMeta!.nodes.get(scriptletNodeId!)
      expect(scriptletMeta).toBeDefined()
      subflowMeta!.removeNodes(scriptletMeta!)
      await vi.waitFor(() => expect([...subflowMeta!.nodes.keys()]).toEqual(['format-message']))
    } finally {
      designerStores.dispose()
      flowService.dispose()
      taskService.dispose()
      subflowService.dispose()
      dirtyResources.dispose()
      navigation.dispose()
      notification.dispose()
      theme.dispose()
      packageMeta.dispose()
      context.dispose()
    }
  })
})
