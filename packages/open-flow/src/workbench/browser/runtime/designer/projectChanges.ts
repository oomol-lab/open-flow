import type { Settings as NodeSettings } from '../../../../project/common/nodeChanges.ts'
import type {
  ChangeOperation,
  CodeModule,
  ConditionNode,
  ConnectorAction,
  Draft,
  GraphNode,
  InputMapping,
  JsonValue,
  TaskDefinition,
  TriggerKeySnapshot,
  TriggerNode,
  WebhookOptions,
} from '../api.ts'
import type { RevisionView } from '../revisionView.ts'

import { applyProjectChanges as reduceProjectChanges } from '../../../../project/common/change.ts'
import { createFlow } from '../../../../project/common/flowChanges.ts'
import {
  createCodeTask,
  createBuiltinTrigger,
  createCondition,
  createLlmTask,
  createManagedTask,
  createProviderTrigger,
  createValue,
  deleteNodes,
  setInputValue as setGraphInputValue,
  updateSettings,
} from '../../../../project/common/nodeChanges.ts'

export type DesignerTarget = { readonly id: string; readonly kind: 'flow' } | { readonly id: string; readonly kind: 'subflow' }

export interface NodeClipboard {
  readonly modules: Readonly<Record<string, CodeModule>>
  readonly nodes: Readonly<Record<string, GraphNode>>
}

export type ProjectChanges = readonly ChangeOperation[]

export function applyProjectChanges(draft: Draft, changes: ProjectChanges): Draft {
  return { ...draft, content: reduceProjectChanges(draft.content, changes) }
}

export interface WebhookSettings {
  readonly inputs: Extract<TriggerNode, { readonly kind: 'webhook' }>['inputsDef']
  readonly options: WebhookOptions
}

export interface ValueSettings {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable?: boolean
  readonly value?: unknown
}

export type ConditionSettings = Pick<ConditionNode, 'cases' | 'defaultOutput' | 'input'>

interface TaskSettingsBase {
  readonly name: string
}

export type TaskSettings =
  | (TaskSettingsBase & { readonly kind: 'code' })
  | (TaskSettingsBase & { readonly kind: 'connector' })
  | (TaskSettingsBase & { readonly kind: 'llm'; readonly mode: 'chat' | 'json' })

export type CodeTaskPorts = Pick<TaskDefinition, 'inputs' | 'outputs'>

export interface SubflowSettings {
  readonly inputs: NonNullable<ReturnType<RevisionView['subflow']>>['inputs']
  readonly name: string
  readonly outputs: NonNullable<ReturnType<RevisionView['subflow']>>['outputs']
}

export type AddNodeIntent =
  | { readonly kind: 'code'; readonly name: string }
  | { readonly action: ConnectorAction; readonly kind: 'connector' }
  | { readonly kind: 'condition'; readonly name: string }
  | { readonly kind: 'cron'; readonly name: string }
  | { readonly kind: 'llm'; readonly mode: 'chat' | 'json'; readonly name: string; readonly outputDescription: string }
  | { readonly kind: 'provider-trigger'; readonly connectionId: string; readonly definition: TriggerKeySnapshot }
  | { readonly kind: 'subflow'; readonly subflowId: string }
  | { readonly kind: 'value'; readonly name: string }
  | { readonly kind: 'webhook'; readonly name: string }

export interface PastedNodes {
  readonly changes: ProjectChanges
  readonly nodeIds: readonly string[]
  readonly sourceIds: readonly string[]
}

export function createResource(kind: DesignerTarget['kind'], id: string, name: string): ProjectChanges {
  if (kind == 'flow') return createFlow(id, name)
  return [
    {
      kind: 'subflow.create',
      subflow: {
        graph: { nodes: {} },
        inputs: { value: { jsonSchema: {}, nullable: true, value: null } },
        name,
        outputs: {
          result: {
            jsonSchema: {},
            nullable: true,
            sources: [{ input: 'value', kind: 'flow' }],
          },
        },
      },
      subflowId: id,
    },
  ]
}

export function addNode(
  revision: RevisionView,
  target: DesignerTarget,
  nodeId: string,
  intent: AddNodeIntent,
  identity: () => string,
): ProjectChanges | undefined {
  switch (intent.kind) {
    case 'code':
      return createCodeTask(target, { moduleId: identity(), nodeId }, intent.name)
    case 'llm':
      return createLlmTask(target, { nodeId, taskId: identity() }, intent.name, intent.mode, intent.outputDescription)
    case 'connector':
      return createManagedTask(
        target,
        { nodeId, taskId: identity() },
        {
          executor: {
            action: intent.action.actionId,
            ...(intent.action.defaultConnection == null ? {} : { connectionId: intent.action.defaultConnection.connectionId }),
            kind: 'connector',
          },
          inputs: intent.action.inputs,
          name: intent.action.name,
          outputs: intent.action.outputs,
        },
      )
    case 'condition':
      return createCondition(target, nodeId, intent.name)
    case 'value':
      return createValue(target, nodeId, intent.name)
    case 'subflow': {
      const subflow = revision.subflow(intent.subflowId)
      if (subflow == null) return
      return createSubflowNode(target, nodeId, intent.subflowId, subflow.inputs)
    }
    case 'webhook':
      return target.kind == 'flow' ? createBuiltinTrigger(target, nodeId, { inputsDef: [], kind: 'webhook', name: intent.name }) : undefined
    case 'cron':
      return target.kind == 'flow'
        ? createBuiltinTrigger(target, nodeId, {
            cronTimes: [{ type: 'every', unit: 'hour', value: 1 }],
            kind: 'cron',
            name: intent.name,
          })
        : undefined
    case 'provider-trigger': {
      if (target.kind != 'flow') return
      return createProviderTrigger(target, { bindingId: identity(), nodeId }, intent.definition, {
        config: {},
        connectionId: intent.connectionId,
      })
    }
  }
}

export function deleteSelection(revision: RevisionView, target: DesignerTarget, nodeIds: readonly string[]): ProjectChanges {
  return deleteNodes(revision.revision.content, target, nodeIds)
}

export function copyNodes(revision: RevisionView, target: DesignerTarget, nodeIds: readonly string[]): NodeClipboard {
  const nodes = revision.graph(target)?.nodes ?? {}
  const copied = Object.fromEntries(nodeIds.flatMap((nodeId) => (nodes[nodeId] == null ? [] : [[nodeId, nodes[nodeId]]])))
  return {
    modules: Object.fromEntries(
      Object.values(copied).flatMap((node) => {
        if (node.kind != 'task' || node.task == null) return []
        const module = revision.revision.content.modules[node.task.moduleId]
        return module == null ? [] : [[node.task.moduleId, module]]
      }),
    ),
    nodes: copied,
  }
}

export function pasteNodes(revision: RevisionView, target: DesignerTarget, clipboard: NodeClipboard, identity: () => string): PastedNodes {
  if (revision.graph(target) == null) return { changes: [], nodeIds: [], sourceIds: [] }
  const entries = Object.entries(clipboard.nodes).filter(
    ([, node]) => (target.kind == 'flow' || 'inputs' in node) && (node.kind != 'task' || node.task == null || clipboard.modules[node.task.moduleId] != null),
  )
  const sourceIds = entries.map(([sourceId]) => sourceId)
  const ids = new Map(sourceIds.map((sourceId) => [sourceId, identity()]))
  const operations: ChangeOperation[] = []
  for (const [sourceId, node] of entries) {
    const nodeId = ids.get(sourceId)!
    if (!('inputs' in node)) {
      if (node.kind == 'poll' || node.kind == 'integration') {
        const binding = revision.binding(node.bindingId)
        if (binding == null) continue
        const bindingId = identity()
        operations.push({ binding, bindingId, kind: 'binding.create' })
        operations.push({ kind: 'graph.node.create', node: { ...node, bindingId, name: `${node.name} copy` }, nodeId, target })
      } else {
        operations.push({ kind: 'graph.node.create', node: { ...node, name: `${node.name} copy` }, nodeId, target })
      }
      continue
    }
    const inputs: Record<string, InputMapping> = {}
    for (const [handle, mapping] of Object.entries(node.inputs)) {
      if (mapping.kind == 'value') {
        inputs[handle] = mapping
        continue
      }
      const sources: (typeof mapping.sources)[number][] = []
      for (const source of mapping.sources) {
        if (source.kind != 'node') {
          sources.push(source)
          continue
        }
        const copiedNodeId = ids.get(source.nodeId)
        if (copiedNodeId != null) sources.push({ ...source, nodeId: copiedNodeId })
      }
      if (sources.length > 0) inputs[handle] = { kind: 'sources', sources }
    }
    let copy: GraphNode = { ...node, inputs, ...(node.name == null ? {} : { name: `${node.name} copy` }) }
    if (node.kind == 'task' && node.task != null) {
      const moduleId = identity()
      const module = clipboard.modules[node.task.moduleId]
      operations.push({ kind: 'module.create', module: { ...module, name: `${module.name} copy` }, moduleId })
      copy = {
        ...node,
        inputs,
        ...(node.name == null ? {} : { name: `${node.name} copy` }),
        task: { ...node.task, moduleId, name: `${node.task.name} copy` },
      }
    }
    operations.push({
      kind: 'graph.node.create',
      node: copy,
      nodeId,
      target,
    })
  }
  return { changes: operations, nodeIds: [...ids.values()], sourceIds }
}

export function updateNodeSettings(revision: RevisionView, target: DesignerTarget, nodeId: string, settings: NodeSettings): ProjectChanges | undefined {
  return updateSettings(revision.revision.content, target, nodeId, settings)
}

export function updateNodeDescription(
  revision: RevisionView,
  target: DesignerTarget,
  nodeId: string,
  description: string | undefined,
): ProjectChanges | undefined {
  const node = revision.node(target, nodeId)?.node
  if (node == null) return
  const { description: _, ...rest } = node
  return replaceNode(target, nodeId, description == null ? rest : { ...rest, description })
}

export function setInputValue(
  revision: RevisionView,
  target: DesignerTarget,
  nodeId: string,
  handle: string,
  value: JsonValue | undefined,
): ProjectChanges | undefined {
  return setGraphInputValue(revision.revision.content, target, nodeId, handle, value)
}

export function updateCondition(revision: RevisionView, target: DesignerTarget, nodeId: string, settings: ConditionSettings): ProjectChanges | undefined {
  const graph = revision.graph(target)
  const current = graph?.nodes[nodeId]
  if (graph == null || current?.kind != 'condition') return
  const currentOutputs = Object.fromEntries([
    ...current.cases.map((item) => [item.output, true] as const),
    ...(current.defaultOutput == null ? [] : [[current.defaultOutput, true] as const]),
  ])
  const nextOutputs = Object.fromEntries([
    ...settings.cases.map((item) => [item.output, true] as const),
    ...(settings.defaultOutput == null ? [] : [[settings.defaultOutput, true] as const]),
  ])
  const inputRename = current.input.handle == settings.input.handle ? undefined : ([current.input.handle, settings.input.handle] as const)
  const outputRename = renamedPort(currentOutputs, nextOutputs)
  const outputNames = new Set(Object.keys(nextOutputs))
  const changes: ChangeOperation[] = []

  for (const [currentNodeId, node] of Object.entries(graph.nodes)) {
    if (!('inputs' in node)) continue
    let changed = currentNodeId == nodeId
    const inputs: Record<string, InputMapping> = { ...node.inputs }

    if (currentNodeId == nodeId) {
      if (inputRename != null && Object.hasOwn(inputs, inputRename[0])) {
        inputs[inputRename[1]] = inputs[inputRename[0]]!
        delete inputs[inputRename[0]]
      }
      for (const name of Object.keys(inputs)) {
        if (name != settings.input.handle) delete inputs[name]
      }
    }

    for (const [name, mapping] of Object.entries(inputs)) {
      if (mapping.kind != 'sources') continue
      const sources = mapping.sources.flatMap((source) => {
        if (source.kind != 'node' || source.nodeId != nodeId) return [source]
        if (outputRename != null && source.output == outputRename[0]) return [{ ...source, output: outputRename[1] }]
        return outputNames.has(source.output) ? [source] : []
      })
      if (sources.length == mapping.sources.length && sources.every((source, index) => source === mapping.sources[index])) continue
      changed = true
      if (sources.length == 0) delete inputs[name]
      else inputs[name] = { kind: 'sources', sources }
    }

    if (!changed) continue
    if (currentNodeId == nodeId) {
      const { defaultOutput: _defaultOutput, ...rest } = current
      changes.push({ kind: 'graph.node.replace', node: { ...rest, ...settings, inputs }, nodeId: currentNodeId, target })
    } else {
      changes.push({ kind: 'graph.node.replace', node: { ...node, inputs }, nodeId: currentNodeId, target })
    }
  }
  return changes
}

export function updateValue(revision: RevisionView, target: DesignerTarget, nodeId: string, settings: readonly ValueSettings[]): ProjectChanges | undefined {
  const node = revision.node(target, nodeId)?.node
  if (node?.kind != 'value') return
  return replaceNode(target, nodeId, {
    ...node,
    values: Object.fromEntries(
      settings.map((item) => [
        item.handle,
        {
          ...(item.description == null ? {} : { description: item.description }),
          jsonSchema: (item.jsonSchema ?? {}) as JsonValue,
          nullable: item.nullable ?? false,
          ...(Object.hasOwn(item, 'value') ? { value: item.value as JsonValue } : {}),
        },
      ]),
    ),
  })
}

export function updateTask(revision: RevisionView, target: DesignerTarget, nodeId: string, settings: TaskSettings): ProjectChanges | undefined {
  const node = revision.graph(target)?.nodes[nodeId]
  if (node?.kind != 'task') return
  switch (settings.kind) {
    case 'code': {
      if (node.task == null) return
      return replaceCodeTaskPorts(revision, target, nodeId, { ...node.task, name: settings.name })
    }
    case 'llm': {
      if (node.task != null) return
      const task = revision.task(node.taskId)
      if (task?.executor.kind != 'llm') return
      const next: typeof task = {
        executor: { kind: 'llm', mode: settings.mode },
        inputs: task.inputs,
        name: settings.name,
        outputs: task.outputs,
      }
      return [{ kind: 'task.replace', task: next, taskId: node.taskId }]
    }
    case 'connector': {
      if (node.task != null) return
      const task = revision.task(node.taskId)
      if (task?.executor.kind != 'connector') return
      const next: typeof task = { ...task, name: settings.name }
      return [{ kind: 'task.replace', task: next, taskId: node.taskId }]
    }
  }
}

export function updateCodeTaskPorts(revision: RevisionView, target: DesignerTarget, nodeId: string, ports: CodeTaskPorts): ProjectChanges | undefined {
  const node = revision.graph(target)?.nodes[nodeId]
  if (node?.kind != 'task' || node.task == null) return
  return replaceCodeTaskPorts(revision, target, nodeId, { ...node.task, ...ports })
}

export function updateWebhook(
  revision: RevisionView,
  target: { readonly id: string; readonly kind: 'flow' },
  triggerId: string,
  settings: WebhookSettings,
): ProjectChanges | undefined {
  const trigger = revision.trigger(target.id, triggerId)
  if (trigger == null || trigger.kind != 'webhook') return
  const { options: _, ...withoutOptions } = trigger
  const next: Extract<TriggerNode, { readonly kind: 'webhook' }> =
    Object.keys(settings.options).length == 0
      ? { ...withoutOptions, inputsDef: settings.inputs }
      : { ...trigger, inputsDef: settings.inputs, options: settings.options }
  return replaceNode(target, triggerId, next)
}

export function updateSubflow(revision: RevisionView, subflowId: string, settings: SubflowSettings): ProjectChanges | undefined {
  if (revision.subflow(subflowId) == null) return
  return [{ definition: settings, kind: 'subflow.definition.replace', subflowId }]
}

function createSubflowNode(target: DesignerTarget, nodeId: string, subflowId: string, inputs: TaskDefinition['inputs']): ProjectChanges {
  return [
    {
      kind: 'graph.node.create',
      node: { concurrency: 1, inputs: defaultInputs(inputs), kind: 'subflow', subflowId },
      nodeId,
      target,
    },
  ]
}

function defaultInputs(ports: TaskDefinition['inputs']): Readonly<Record<string, InputMapping>> {
  return Object.fromEntries(
    Object.entries(ports).flatMap(([handle, port]) =>
      Object.hasOwn(port, 'value') ? [[handle, { kind: 'value' as const, value: port.value as JsonValue }]] : [],
    ),
  ) as Readonly<Record<string, InputMapping>>
}

function renamedPort(
  previous: Readonly<Record<string, unknown>>,
  next: Readonly<Record<string, unknown>>,
): readonly [oldName: string, newName: string] | undefined {
  const removed = Object.keys(previous).filter((name) => !Object.hasOwn(next, name))
  const added = Object.keys(next).filter((name) => !Object.hasOwn(previous, name))
  return removed.length == 1 && added.length == 1 ? [removed[0]!, added[0]!] : undefined
}

function replaceCodeTaskPorts(
  revision: RevisionView,
  target: DesignerTarget,
  nodeId: string,
  task: Extract<TaskDefinition, { readonly moduleId: string }>,
): ProjectChanges | undefined {
  const graph = revision.graph(target)
  const current = graph?.nodes[nodeId]
  if (graph == null || current?.kind != 'task' || current.task == null) return
  const inputRename = renamedPort(current.task.inputs, task.inputs)
  const outputRename = renamedPort(current.task.outputs, task.outputs)
  const outputNames = new Set(Object.keys(task.outputs))
  const changes: ChangeOperation[] = []

  for (const [currentNodeId, node] of Object.entries(graph.nodes)) {
    if (!('inputs' in node)) continue
    let changed = currentNodeId == nodeId
    const inputs: Record<string, InputMapping> = { ...node.inputs }

    if (currentNodeId == nodeId) {
      if (inputRename != null && Object.hasOwn(inputs, inputRename[0])) {
        inputs[inputRename[1]] = inputs[inputRename[0]]!
        delete inputs[inputRename[0]]
      }
      for (const name of Object.keys(inputs)) {
        if (!Object.hasOwn(task.inputs, name)) delete inputs[name]
      }
    }

    for (const [name, mapping] of Object.entries(inputs)) {
      if (mapping.kind != 'sources') continue
      const sources = mapping.sources.flatMap((source) => {
        if (source.kind != 'node' || source.nodeId != nodeId) return [source]
        if (outputRename != null && source.output == outputRename[0]) return [{ ...source, output: outputRename[1] }]
        return outputNames.has(source.output) ? [source] : []
      })
      if (sources.length == mapping.sources.length && sources.every((source, index) => source === mapping.sources[index])) continue
      changed = true
      if (sources.length == 0) delete inputs[name]
      else inputs[name] = { kind: 'sources', sources }
    }

    if (!changed) continue
    const replacement: GraphNode = currentNodeId == nodeId ? { ...current, inputs, task } : { ...node, inputs }
    changes.push({
      kind: 'graph.node.replace',
      node: replacement,
      nodeId: currentNodeId,
      target,
    })
  }
  return changes
}

function replaceNode(target: DesignerTarget, nodeId: string, node: GraphNode): ProjectChanges {
  return [{ kind: 'graph.node.replace', node, nodeId, target }]
}
