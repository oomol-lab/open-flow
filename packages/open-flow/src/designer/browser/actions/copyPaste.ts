import type { IEvent } from '@wopjs/event'
import type { I18n, TFunction } from 'val-i18n'
import type { z } from 'zod'
import type { FlowLikeMeta, UpsertNodeYamlOptions } from '../../../manifest/common/meta/flowLike/flowLikeMeta.ts'
import type { NodeMeta } from '../../../manifest/common/meta/nodeMeta.ts'
import type { NodeType } from '../../../manifest/common/model/node/nodeManifest.ts'
import type { ConditionNode, NodeId, SubflowNode, TaskNode, TriggerDefinitionSnapshot, TriggerNode, ValueNode } from '../../../schema/index.ts'
import type { Viewport, XYPosition } from '../base/compare.ts'
import type { BrowserTheme } from '../browserTheme.ts'
import type { DesignerNotification } from '../notification.ts'
import type { CreateL10nMarkdownEditorFn } from '../services/designerService.ts'
import type { DesignerStore } from '../stores/designer/designer.store.ts'
import type { DesignerUIStore } from '../stores/designer/designerUI.store.ts'
import type { CommentNodeStore } from '../stores/node/commentNode.store.ts'
import type { NodeStore } from '../stores/node/node.store.ts'

import { isDefined, toPlainObject, toString } from '@wopjs/cast'
import { join as joinDisposers } from '@wopjs/disposable'
import { addEventListener } from '@wopjs/dom'
import { isArray, isString } from 'radash'
import { copyTextToClipboard, readTextFromClipboard } from '../../../base/browser/clipboard.ts'
import { jsonTryParse, jsonTryStringify } from '../../../base/common/parse.ts'
import { extname } from '../../../base/common/posixPath.ts'
import { isUnknownRecord } from '../../../base/common/type.ts'
import { applyFlowEditOperations } from '../../../manifest/common/flowEdit.ts'
import { ConditionBlockMeta } from '../../../manifest/common/meta/block/conditionBlockMeta.ts'
import { InlineTaskBlockMeta } from '../../../manifest/common/meta/block/inlineTaskBlockMeta.ts'
import { SubflowBlockMeta } from '../../../manifest/common/meta/block/subflowBlockMeta.ts'
import { TaskBlockMeta } from '../../../manifest/common/meta/block/taskBlockMeta.ts'
import { ValueBlockMeta } from '../../../manifest/common/meta/block/valueBlockMeta.ts'
import { FlowMeta } from '../../../manifest/common/meta/flowMeta.ts'
import { isConditionNodeManifest } from '../../../manifest/common/model/node/conditionNodeManifest.ts'
import { isSubflowNodeManifest } from '../../../manifest/common/model/node/subflowNodeManifest.ts'
import { isTaskNodeManifest } from '../../../manifest/common/model/node/taskNodeManifest.ts'
import { isTriggerNodeManifest } from '../../../manifest/common/model/node/triggerNodeManifest.ts'
import { getYamlNode, isYamlMap, parseYamlDoc, stringify } from '../../../manifest/common/yaml.ts'
import { FlowNodeSchema, isLocalBlockReference, TriggerDefinitionSnapshotSchema } from '../../../schema/index.ts'
import { isXYPosition } from '../base/compare.ts'
import { base64Decode, base64Encode } from '../clipboardEncoding.ts'
import { NODE_TYPE } from '../stores/node/constants.ts'
import { addCommentNodeStore } from './commentNodes.tsx'

type ClipboardNodeData = z.input<typeof FlowNodeSchema> | undefined

type ClipboardNodeType =
  `${NODE_TYPE.TaskNode | NODE_TYPE.SubflowNode | NODE_TYPE.ValueNode | NODE_TYPE.ConditionNode | NODE_TYPE.TriggerNode | NODE_TYPE.CommentNode}`

interface ClipboardNode<T extends ClipboardNodeData = ClipboardNodeData> {
  nodeId: NodeId
  sourceNodeId?: string
  type: ClipboardNodeType
  data: T
  ui?: any
  scriptletSource?: string
}

interface ClipboardData {
  projectRoot?: string
  triggerDefinitions?: readonly TriggerDefinitionSnapshot[]
  nodes: ClipboardNode[]
}

function stripNodeIdSuffix(nodeId: string): string {
  const index = nodeId.lastIndexOf('#')
  return (index > 0 ? nodeId.slice(0, index) : nodeId).replace(/\s+/g, '_')
}

function randomIntBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1) + min)
}

export function setupOnCopyListener(designerStore: DesignerStore, flowLikeMeta: FlowLikeMeta, t: TFunction, notification: DesignerNotification): () => void {
  const onCopy = async (): Promise<void> => {
    const clipboardData = await collectClipboardData(flowLikeMeta, designerStore.$.selectedNodes.value)
    if (!clipboardData) return

    const str = jsonTryStringify(clipboardData) || '{}'

    const payloadItem = encodeClipboardPayload(str)
    try {
      if (!payloadItem || !navigator.clipboard?.write) {
        throw new Error('Rich clipboard is unavailable')
      }
      await navigator.clipboard.write([payloadItem])
    } catch (error) {
      console.warn('' + error)
      await copyTextToClipboard(str)
    }

    notification.success(t('clipboard.copySuccess', { '@': clipboardData.nodes.length }))
  }

  // The key binding avoids duplicate copy events from clipboard-monitoring tools.
  const isMac = /Mac/.test(navigator.platform)
  const onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'c') {
      const modifier = (e.ctrlKey ? 0b1000 : 0) | (e.metaKey ? 0b0100 : 0) | (e.altKey ? 0b0010 : 0) | (e.shiftKey ? 0b0001 : 0)
      if (modifier === (isMac ? 0b0100 : 0b1000) && designerStore.focused$?.value && designerStore.isDesignerActive() && allowCopyPasteNodes()) {
        e.preventDefault()
        onCopy()
      }
    }
  }

  window.addEventListener('keydown', onKeydown)
  return () => window.removeEventListener('keydown', onKeydown)
}

export function setupOnPasteListener(
  designerStore: DesignerStore,
  designerUIStore: DesignerUIStore,
  flowLikeMeta: FlowLikeMeta,
  theme: BrowserTheme,
  createMarkdownEditor: CreateL10nMarkdownEditorFn,
  onExternalPaste: IEvent<XYPosition>,
  i18n: I18n,
  notification: DesignerNotification,
  canWriteScriptlets: boolean = true,
): () => void {
  const onPaste = async (event: ClipboardEvent, forcePosition?: XYPosition) => {
    if (!allowCopyPasteNodes()) {
      return
    }

    // Paste only into the focused workflow.
    if (!designerStore.focused$?.value) {
      return
    }

    try {
      const clipboardData = parseClipboardData(
        jsonTryParse(decodeClipboardPayload(event.clipboardData)),
        flowLikeMeta,
        designerStore.$.viewport.value,
        forcePosition,
      )
      if (!clipboardData) return
      if (!canWriteScriptlets && clipboardData.nodes.some((node) => node.scriptletSource != null)) {
        notification.error(i18n.t('clipboard.pasteScriptletUnsupported'))
        return
      }

      await applyClipboardData(clipboardData, i18n, theme, designerStore, designerUIStore, flowLikeMeta, createMarkdownEditor)
    } catch (error) {
      console.error('Failed to apply clipboard data:', error)
    }
  }

  return joinDisposers(
    onExternalPaste(async (position) => {
      onPaste(await mockClipboardEvent(), position)
    }),
    addEventListener(window, 'paste', onPaste),
  )
}

function encodeClipboardPayload(payload: string): ClipboardItem | undefined {
  if (typeof ClipboardItem === 'undefined') {
    return undefined
  }

  const type = 'text/html'
  const html = `<span data-open-flow="${base64Encode(payload)}"></span>`
  return new ClipboardItem({
    [type]: new Blob([html], { type }),
  })
}

function decodeClipboardPayload(dataTransfer: DataTransfer | null): string {
  const html = dataTransfer?.getData('text/html')
  const htmlPrefix = '<span data-open-flow="'
  if (html && html.includes(htmlPrefix)) {
    const start = html.indexOf(htmlPrefix) + htmlPrefix.length
    const end = html.lastIndexOf('"></span>')
    return base64Decode(html.slice(start, end))
  }
  return dataTransfer?.getData('text') ?? '{}'
}

async function collectClipboardData(flowLikeMeta: FlowLikeMeta, selectedNodes: (NodeStore | CommentNodeStore)[]): Promise<ClipboardData | undefined> {
  const triggerDefinitions = new Map<string, TriggerDefinitionSnapshot>()
  const createNodeDataBase = (nodeMeta: NodeMeta) => {
    const scheduled = isTaskNodeManifest(nodeMeta.manifest) || isSubflowNodeManifest(nodeMeta.manifest)
    const reportsProgress = scheduled || isConditionNodeManifest(nodeMeta.manifest)
    return {
      node_id: nodeMeta.nodeId,
      title: nodeMeta.manifest.$.title.value,
      icon: nodeMeta.manifest.$.icon.value,
      description: nodeMeta.manifest.$.description.value,
      timeout: scheduled ? nodeMeta.manifest.$.timeout.value : undefined,
      concurrency: scheduled ? nodeMeta.manifest.$.concurrency.value : undefined,
      progress_weight: reportsProgress ? nodeMeta.manifest.$.progress_weight.value : undefined,
      inputs_from: nodeMeta.$.handleInputsFrom.value?.map((e) => {
        return {
          handle: e.handle,
          value: e.value,
          from_node: e.from_node?.filter((f) => selectedNodes.some((nodeStore) => nodeStore.nodeId === f.node_id)),
          schema_overrides: e.schema_overrides,
        }
      }),
    }
  }

  const serializeNode = async (nodeStore: NodeStore | CommentNodeStore): Promise<ClipboardNode | undefined> => {
    if (nodeStore.nodeType === NODE_TYPE.CommentNode) {
      return {
        nodeId: nodeStore.nodeId,
        type: nodeStore.nodeType,
        data: undefined,
        ui: nodeStore.uiStore.toUIData(),
      }
    }

    const nodeMeta = flowLikeMeta.nodes.get(nodeStore.nodeId)
    if (!nodeMeta) return

    const createClipboardNode = <T extends ClipboardNodeData>(data: T, scriptletSource?: string): ClipboardNode<T> => {
      return {
        nodeId: nodeStore.nodeId,
        type: nodeStore.nodeType as ClipboardNodeType,
        data,
        ui: nodeStore.uiStore.toUIData(),
        scriptletSource,
      }
    }

    if (nodeStore.nodeType === NODE_TYPE.TriggerNode) {
      if (isTriggerNodeManifest(nodeMeta.manifest)) {
        const trigger = nodeMeta.manifest.$.trigger.value
        const definition = nodeMeta.$.triggerDefinition.value
        if (!trigger || !definition) return
        triggerDefinitions.set(JSON.stringify([trigger.type, trigger.revision]), {
          type: trigger.type,
          revision: trigger.revision,
          definition,
        })
        return createClipboardNode<TriggerNode>({
          node_id: nodeMeta.nodeId,
          title: nodeMeta.manifest.$.title.value,
          icon: nodeMeta.manifest.$.icon.value,
          description: nodeMeta.manifest.$.description.value,
          ignore: nodeMeta.manifest.$.ignore.value,
          trigger,
        })
      }
      return
    }

    const blockMeta = nodeMeta.$.blockMeta.value
    if (!blockMeta) return

    if (nodeStore.nodeType === NODE_TYPE.TaskNode) {
      if (isTaskNodeManifest(nodeMeta.manifest)) {
        if (InlineTaskBlockMeta.is(blockMeta)) {
          let scriptletSource: string | undefined
          const scriptletEntry = nodeMeta.$.scriptletEntry.value
          if (scriptletEntry) {
            scriptletSource = await flowLikeMeta.packageMeta.scriptlets.readScriptletFile(scriptletEntry)
          }
          return createClipboardNode<TaskNode>(
            {
              ...createNodeDataBase(nodeMeta),
              task: blockMeta.manifest.toJSON(),
              inputs_def: nodeMeta.manifest.$.inputs_def.value,
              outputs_def: nodeMeta.manifest.$.outputs_def.value,
            },
            scriptletSource,
          )
        } else if (TaskBlockMeta.is(blockMeta)) {
          return createClipboardNode<TaskNode>({
            ...createNodeDataBase(nodeMeta),
            task: blockMeta.blockResourceName,
            inputs_def: nodeMeta.manifest.$.inputs_def.value,
            outputs_def: nodeMeta.manifest.$.outputs_def.value,
          })
        }
      }
      return
    }

    if (nodeStore.nodeType === NODE_TYPE.SubflowNode) {
      if (SubflowBlockMeta.is(blockMeta)) {
        return createClipboardNode<SubflowNode>({
          ...createNodeDataBase(nodeMeta),
          subflow: blockMeta.blockResourceName,
        })
      }
      return
    }

    if (nodeStore.nodeType === NODE_TYPE.ValueNode) {
      if (ValueBlockMeta.is(blockMeta)) {
        return createClipboardNode<ValueNode>({
          ...createNodeDataBase(nodeMeta),
          values: blockMeta.manifest.$.values.value || [],
        })
      }
      return
    }

    if (nodeStore.nodeType === NODE_TYPE.ConditionNode) {
      if (isConditionNodeManifest(nodeMeta.manifest) && ConditionBlockMeta.is(blockMeta)) {
        return createClipboardNode<ConditionNode>({
          ...createNodeDataBase(nodeMeta),
          inputs_def: nodeMeta.manifest.$.inputs_def.value,
          conditions: blockMeta.manifest.toJSON(),
        })
      }
    }
  }

  const serializedNodes = (await Promise.all(selectedNodes.map(serializeNode))).filter(isDefined)

  if (serializedNodes.length <= 0) return

  return {
    projectRoot: flowLikeMeta.packageMeta.packageDir,
    ...(triggerDefinitions.size == 0 ? {} : { triggerDefinitions: [...triggerDefinitions.values()] }),
    nodes: serializedNodes,
  }
}

function calcPositionOffset(anchorPosition: XYPosition, nodes: any[]): XYPosition {
  let topLeft: XYPosition | undefined

  for (const node of nodes) {
    const nodePosition = node?.ui?.rfNode?.position
    if (isXYPosition(nodePosition)) {
      if (topLeft) {
        topLeft.x = Math.min(topLeft.x, nodePosition.x)
        topLeft.y = Math.min(topLeft.y, nodePosition.y)
      } else {
        topLeft = { x: nodePosition.x, y: nodePosition.y }
      }
    }
  }

  if (!topLeft) return { x: 0, y: 0 }

  return {
    x: anchorPosition.x - topLeft.x,
    y: anchorPosition.y - topLeft.y,
  }
}

function parseClipboardData(
  data: unknown,
  flowLikeMeta: FlowLikeMeta,
  viewport: Viewport = { x: 0, y: 0, zoom: 1 },
  anchorPosition: XYPosition = {
    x: (100 - viewport.x) / viewport.zoom,
    y: (100 - viewport.y) / viewport.zoom,
  },
): ClipboardData | undefined {
  if (!isUnknownRecord(data)) return

  const projectRoot = toString(data.projectRoot)

  const parsedNodes = parseClipboardNodes(viewport, data.nodes)
  if (!parsedNodes) return
  const triggerDefinitions = TriggerDefinitionSnapshotSchema.array().safeParse(data.triggerDefinitions).data

  return {
    projectRoot,
    ...(triggerDefinitions == null ? {} : { triggerDefinitions }),
    nodes: parsedNodes,
  }

  function parseClipboardNodes(targetViewport: Viewport, raw: unknown): ClipboardNode[] | undefined {
    const nodeMap = new Map<NodeId, ClipboardNode>()
    if (isArray(raw)) {
      const positionOffset = calcPositionOffset(anchorPosition, raw)
      const nodeIdMap = new Map<string, NodeId>()

      for (const nodeRaw of raw) {
        const node = parseClipboardNode(nodeRaw, nodeMap, targetViewport, positionOffset)
        if (node) {
          nodeMap.set(node.nodeId, node)

          if (node.sourceNodeId) {
            nodeIdMap.set(node.sourceNodeId, node.nodeId)
          }
        }
      }

      // Rewrite connections after assigning new node IDs.
      if (nodeIdMap.size > 0) {
        for (const node of nodeMap.values()) {
          const inputs_from = node.data != null && 'inputs_from' in node.data ? node.data.inputs_from : undefined
          if (inputs_from) {
            for (const input of inputs_from) {
              if (input.from_node) {
                for (const fromNode of input.from_node) {
                  if (nodeIdMap.has(fromNode.node_id)) {
                    fromNode.node_id = nodeIdMap.get(fromNode.node_id) as NodeId
                  }
                }
              }
            }
          }
        }
      }

      for (const node of nodeMap.values()) {
        if (node.type === NODE_TYPE.CommentNode) continue
        const nodeType = convertClipboardNodeType(node.type)
        const parsed = parseClipboardNodeData(node.data, node.nodeId)
        if (nodeType === 'trigger' && flowLikeMeta.flowLikeType !== 'flow') {
          throw new Error('Trigger nodes can only be pasted into a Flow.')
        }
        if (nodeType !== nodeTypeOf(parsed)) {
          throw new Error(`Clipboard node "${node.nodeId}" is not a valid ${nodeType ?? 'workflow'} node.`)
        }
        node.data = parsed
      }
    }

    if (nodeMap.size <= 0) return
    return [...nodeMap.values()]
  }

  function parseClipboardNode(
    raw: unknown,
    nodeMap: ReadonlyMap<NodeId, ClipboardNode>,
    targetViewport: Viewport,
    positionOffset: XYPosition,
  ): ClipboardNode | undefined {
    if (!isUnknownRecord(raw) || !isString(raw.type)) return

    const sourceNodeId = toString(raw.nodeId)
    if (!sourceNodeId) return
    const nodeIdName = stripNodeIdSuffix(sourceNodeId)
    const nodeIdIndex = getNodeIdIndex(nodeIdName, flowLikeMeta, nodeMap)
    const nodeId = `${nodeIdName}#${nodeIdIndex}` as NodeId

    const nodeData = isUnknownRecord(raw.data) ? raw.data : undefined

    if (nodeData) {
      const refNodeTitle = nodeData.title
      const nodeTitle = isString(refNodeTitle) ? generateNodeTitle(refNodeTitle, nodeIdIndex) : undefined
      nodeData.node_id = nodeId
      nodeData.title = nodeTitle
    }

    const uiData = toPlainObject(raw.ui) || {}
    const rfNode = toPlainObject(uiData.rfNode) || {}
    uiData.rfNode = rfNode
    rfNode.selected = true
    if (isXYPosition(rfNode.position)) {
      rfNode.position.x = rfNode.position.x + positionOffset.x
      rfNode.position.y = rfNode.position.y + positionOffset.y
    } else {
      // Scale the random offset to preserve its visual size at the current zoom.
      rfNode.position = {
        x: anchorPosition.x + (randomIntBetween(-50, 50) - targetViewport.x) / targetViewport.zoom,
        y: anchorPosition.y + (randomIntBetween(-50, 50) - targetViewport.y) / targetViewport.zoom,
      }
    }
    const node: ClipboardNode = {
      nodeId,
      sourceNodeId,
      type: raw.type as ClipboardNodeType,
      data: nodeData as ClipboardNodeData,
      ui: uiData,
      scriptletSource: toString(raw.scriptletSource),
    }

    return node
  }
}

async function applyClipboardData(
  clipboardData: ClipboardData,
  i18n: I18n,
  theme: BrowserTheme,
  designerStore: DesignerStore,
  designerUIStore: DesignerUIStore,
  flowLikeMeta: FlowLikeMeta,
  createMarkdownEditor: CreateL10nMarkdownEditorFn,
): Promise<void> {
  const crossesProject = clipboardData.projectRoot !== flowLikeMeta.packageMeta.packageDir
  if (crossesProject && clipboardData.nodes.some((node) => hasLocalBlockReference(node.data))) {
    throw new Error('Pasting local Task or Subflow references across projects is not supported.')
  }
  const triggerNodes = clipboardData.nodes.flatMap((node) => (node.data != null && 'trigger' in node.data ? [node.data] : []))
  if (triggerNodes.length > 0) {
    if (!FlowMeta.is(flowLikeMeta)) throw new Error('Trigger nodes can only be pasted into a Flow.')
    const definitions = new Set(
      [...(flowLikeMeta.manifest.$.trigger_definitions.value ?? []), ...(clipboardData.triggerDefinitions ?? [])].map((snapshot) =>
        JSON.stringify([snapshot.type, snapshot.revision]),
      ),
    )
    const missing = triggerNodes.find((node) => !definitions.has(JSON.stringify([node.trigger.type, node.trigger.revision])))
    if (missing != null) {
      throw new Error(`Pasted Trigger "${missing.node_id}" is missing definition "${missing.trigger.type}" revision "${missing.trigger.revision}".`)
    }
  }

  const deselect = designerStore.prepareDeselectNodesAndEdges()
  const upsertNodeYamlOptions: UpsertNodeYamlOptions[] = []
  const nodeUIData = new Map<NodeId, ClipboardNode['ui']>()
  const createdScriptlets: string[] = []

  try {
    if (clipboardData.triggerDefinitions != null) {
      if (!FlowMeta.is(flowLikeMeta)) throw new Error('Trigger definitions can only be pasted into a Flow.')
      applyFlowEditOperations(
        flowLikeMeta.manifest,
        clipboardData.triggerDefinitions.map((snapshot) => ({ type: 'add-trigger-definition', snapshot })),
      )
    }
    for (const node of clipboardData.nodes) {
      if (node.type === NODE_TYPE.CommentNode) continue
      const data = node.data
      if (data == null) throw new Error(`Clipboard node "${node.nodeId}" has no workflow data.`)

      if (node.scriptletSource != null && 'task' in data && typeof data.task != 'string') {
        const executor = data.task.executor
        const entry = executor.name == 'javascript' ? executor.options.entry : undefined
        if (isString(entry)) {
          // Keep scriptlet allocation sequential so rollback observes every completed write.
          // oxlint-disable-next-line no-await-in-loop
          const scriptlet = await flowLikeMeta.packageMeta.scriptlets.writeNewScriptlet(flowLikeMeta.manifestDir, extname(entry), node.scriptletSource)
          executor.options = { ...executor.options, entry: scriptlet }
          createdScriptlets.push(scriptlet)
        }
      }

      node.data = parseClipboardNodeData(data, node.nodeId)

      const doc = parseYamlDoc(stringify({ oo: node.data }))
      const nodeYaml = getYamlNode(doc, 'oo').filter(isYamlMap).unwrapOr()
      const nodeId = node.data.node_id as NodeId
      const nodeType = convertClipboardNodeType(node.type)
      if (!nodeType || !nodeYaml) throw new Error(`Clipboard node "${node.nodeId}" could not be serialized.`)

      nodeUIData.set(nodeId, node.ui)
      upsertNodeYamlOptions.push({
        nodeId,
        type: nodeType,
        yamlMap: nodeYaml,
      })
    }

    if (upsertNodeYamlOptions.length > 0) {
      // Flow metadata reaches Designer stores asynchronously, so all workflow nodes are inserted in one update.
      flowLikeMeta.upsertNodeYamls(upsertNodeYamlOptions)
    }
  } catch (error) {
    await Promise.all(
      createdScriptlets.map((entry) => flowLikeMeta.packageMeta.scriptlets.removeScriptlet(flowLikeMeta.manifestDir, entry).catch(console.error)),
    )
    throw error
  }

  for (const [nodeId, ui] of nodeUIData) designerUIStore.setNodeUIData(nodeId, ui)

  for (const node of clipboardData.nodes) {
    if (node.type === NODE_TYPE.CommentNode && designerStore.$$.commentNodes) {
      addCommentNodeStore({
        i18n,
        userLocales: designerStore.userLocales,
        dark$: theme.darkMode$,
        readonly: false,
        designerUIStore,
        commentNodes: designerStore.$$.commentNodes,
        mountCodeEditor: createMarkdownEditor,
        nodeUIData: node.ui,
      })
    }
  }

  setTimeout(deselect, 0)
}

function hasLocalBlockReference(data: ClipboardNodeData): boolean {
  if (data == null) return false
  if ('task' in data) return isLocalBlockReference(data.task)
  return 'subflow' in data && isLocalBlockReference(data.subflow)
}

function nodeTypeOf(data: Exclude<ClipboardNodeData, undefined>): NodeType {
  if ('task' in data) return 'task'
  if ('subflow' in data) return 'subflow'
  if ('values' in data) return 'value'
  if ('trigger' in data) return 'trigger'
  return 'condition'
}

function parseClipboardNodeData(data: unknown, nodeId: NodeId): Exclude<ClipboardNodeData, undefined> {
  const parsed = FlowNodeSchema.safeParse(data)
  if (!parsed.success) throw new Error(`Clipboard node "${nodeId}" does not match the workflow schema.`)
  return parsed.data
}

function convertClipboardNodeType(type: ClipboardNodeType): NodeType | undefined {
  switch (type) {
    case NODE_TYPE.TaskNode:
      return 'task'
    case NODE_TYPE.SubflowNode:
      return 'subflow'
    case NODE_TYPE.ValueNode:
      return 'value'
    case NODE_TYPE.ConditionNode:
      return 'condition'
    case NODE_TYPE.TriggerNode:
      return 'trigger'
  }
}

function allowCopyPasteNodes(): boolean {
  const activeElement = document.activeElement?.tagName.toLowerCase()
  if (activeElement === 'input' || activeElement === 'textarea') {
    return false
  }

  // Monaco uses this element while its editor is focused.
  if (document.activeElement?.classList?.contains('native-edit-context')) {
    return false
  }

  const selection = getSelection()
  // Do not copy nodes while the user is selecting text.
  if (selection?.toString()) {
    // Allow the native copy behavior outside the graph or inside the focused node.
    if (isOutsideNodeOrInsideSelectedNode(selection.anchorNode) || isOutsideNodeOrInsideSelectedNode(selection.focusNode)) {
      return false
    }
  }

  return true
}

function isOutsideNodeOrInsideSelectedNode(node: Node | null): boolean {
  if (!node) return false
  // Find the closest element.
  while (node && node.nodeType !== Node.ELEMENT_NODE) {
    node = node.parentNode
  }
  if (!node) return false
  // Find the workflow node.
  const element = node as Element
  const flowNode = element.closest('.react-flow__node')
  return !flowNode || flowNode.classList.contains('selected')
}

async function mockClipboardEvent(): Promise<ClipboardEvent> {
  let html = ''
  let text = ''
  try {
    const clipboard = navigator.clipboard as Clipboard & {
      read(options: { unsanitized: string[] }): Promise<ClipboardItems>
    }
    html =
      (await clipboard
        .read({ unsanitized: ['text/html'] })
        .then((a) => a[0]?.getType('text/html'))
        .then((a) => a?.text())) || ''
  } catch (error) {
    console.warn('' + error)
  }
  if (!html) {
    text = await readTextFromClipboard().catch(() => '')
  }
  const getData = (format: string): string => {
    if (format === 'text/html') return html
    if (format === 'text/plain' || format === 'text') return text
    return ''
  }
  return { clipboardData: { getData } } as ClipboardEvent
}

export function getNodeIdIndex(blockName: string, flowLikeMeta: FlowLikeMeta, nodes: ReadonlyMap<NodeId, ClipboardNode>): number {
  let index: number = 0
  let nodeId: NodeId

  do {
    nodeId = `${blockName}#${++index}` as NodeId
  } while (flowLikeMeta.nodes.has(nodeId) || nodes.has(nodeId))

  return index
}

export function generateNodeTitle(title: string, index: number): string {
  const result = /^([\s\S]+)\s*#([\s\d]+)$/.exec(title)
  if (result) {
    // Replace an existing numeric suffix with the newly assigned index.
    return `${result[1].trim()} #${index}`
  }
  // Keep titles without a numeric suffix unchanged.
  return title
}
