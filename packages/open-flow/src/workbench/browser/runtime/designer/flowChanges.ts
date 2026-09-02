import type { Settings as NodeSettings } from '../../../../flow/common/nodeChanges.ts'
import type {
  ChangeOperation,
  CodeModule,
  ConditionNode,
  ConnectorAction,
  Draft,
  GraphNode,
  InputPort,
  InputMapping,
  JsonValue,
  TaskDefinition,
  TriggerKeySnapshot,
  TriggerNode,
  WebhookOptions,
} from '../api.ts'
import type { RevisionView } from '../revisionView.ts'

import { dequal } from 'dequal/lite'
import { applyFlowChanges as reduceFlowChanges } from '../../../../flow/common/change.ts'
import {
  cleanVariableBindings,
  createCodeTask,
  createBuiltinTrigger,
  createCondition,
  createLlmTask,
  createManagedTask,
  createProviderTrigger,
  createValue,
  deleteNodes,
  setInputValue as setGraphInputValue,
  setInputVariable as setGraphInputVariable,
  updateSettings,
} from '../../../../flow/common/nodeChanges.ts'
import { generateTyping } from '../../../../manifest/common/meta/block/generateTyping.ts'

export type DesignerTarget = { readonly kind: 'flow' } | { readonly id: string; readonly kind: 'subflow' }

export interface NodeClipboard {
  readonly bindings: Draft['content']['document']['bindings']
  readonly modules: Readonly<Record<string, CodeModule>>
  readonly nodes: Readonly<Record<string, GraphNode>>
}

export type FlowChanges = readonly ChangeOperation[]

export function applyFlowChanges(draft: Draft, changes: FlowChanges): Draft {
  return { ...draft, content: reduceFlowChanges(draft.content, changes) }
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

export function codeTyping(ports: CodeTaskPorts): string {
  return generateTyping(
    'javascript',
    ports.inputs.flatMap((port) => ('handle' in port ? [{ handle: port.handle, json_schema: port.jsonSchema, nullable: port.nullable }] : [])),
    ports.outputs.flatMap((port) => ('handle' in port ? [{ handle: port.handle, json_schema: port.jsonSchema, nullable: port.nullable }] : [])),
  )
}

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
  | { readonly kind: 'provider-trigger'; readonly connectionId?: string; readonly definition: TriggerKeySnapshot }
  | { readonly kind: 'subflow'; readonly subflowId: string }
  | { readonly kind: 'value'; readonly name: string }
  | { readonly kind: 'webhook'; readonly name: string }

export interface PastedNodes {
  readonly changes: FlowChanges
  readonly nodeIds: readonly string[]
  readonly sourceIds: readonly string[]
}

export function createResource(id: string, name: string): FlowChanges {
  return [
    {
      kind: 'subflow.create',
      subflow: {
        graph: { nodes: {} },
        inputs: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
        name,
        outputs: [
          {
            handle: 'result',
            jsonSchema: {},
            nullable: true,
            sources: [{ input: 'value', kind: 'flow' }],
          },
        ],
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
): FlowChanges | undefined {
  switch (intent.kind) {
    case 'code':
      return createCodeTask(target, { moduleId: nodeId, nodeId }, intent.name)
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
          inputs: Object.entries(intent.action.inputs).map(([handle, port]) => Object.assign({ handle }, port)),
          name: intent.action.name,
          outputs: Object.entries(intent.action.outputs).map(([handle, port]) => Object.assign({ handle }, port)),
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
        ...(intent.connectionId == null ? {} : { connectionId: intent.connectionId }),
      })
    }
  }
}

export function deleteSelection(revision: RevisionView, target: DesignerTarget, nodeIds: readonly string[]): FlowChanges {
  return deleteNodes(revision.revision.content, target, nodeIds)
}

export function copyNodes(revision: RevisionView, target: DesignerTarget, nodeIds: readonly string[]): NodeClipboard {
  const nodes = revision.graph(target)?.nodes ?? {}
  const copied = Object.fromEntries(nodeIds.flatMap((nodeId) => (nodes[nodeId] == null ? [] : [[nodeId, nodes[nodeId]]])))
  return {
    bindings: Object.fromEntries(
      Object.values(copied).flatMap((node) => {
        if (!('inputs' in node)) return []
        return Object.values(node.inputs).flatMap((mapping) =>
          mapping.kind == 'sources'
            ? mapping.sources.flatMap((source) => {
                if (source.kind != 'binding') return []
                const binding = revision.binding(source.bindingId)
                return binding?.kind == 'variable' ? [[source.bindingId, binding]] : []
              })
            : [],
        )
      }),
    ),
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
  const bindingIds = new Map<string, string>()
  for (const [, node] of entries) {
    if (!('inputs' in node)) continue
    for (const mapping of Object.values(node.inputs)) {
      if (mapping.kind != 'sources') continue
      for (const source of mapping.sources) {
        if (source.kind != 'binding' || clipboard.bindings[source.bindingId]?.kind != 'variable' || bindingIds.has(source.bindingId)) continue
        bindingIds.set(source.bindingId, identity())
      }
    }
  }
  for (const [sourceId, bindingId] of bindingIds) {
    const binding = clipboard.bindings[sourceId]
    if (binding != null) operations.push({ binding, bindingId, kind: 'binding.create' })
  }
  for (const [sourceId, node] of entries) {
    const nodeId = ids.get(sourceId)!
    if (!('inputs' in node)) {
      if (node.kind == 'poll' || node.kind == 'integration') {
        const binding = revision.binding(node.bindingId)
        const bindingId = identity()
        if (binding != null) operations.push({ binding, bindingId, kind: 'binding.create' })
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
        if (source.kind == 'binding') {
          const copiedBindingId = bindingIds.get(source.bindingId)
          if (copiedBindingId != null) sources.push({ ...source, bindingId: copiedBindingId })
          continue
        }
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
      const moduleId = nodeId
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

export function updateNodeSettings(revision: RevisionView, target: DesignerTarget, nodeId: string, settings: NodeSettings): FlowChanges | undefined {
  return updateSettings(revision.revision.content, target, nodeId, settings)
}

export function updateNodeDescription(
  revision: RevisionView,
  target: DesignerTarget,
  nodeId: string,
  description: string | undefined,
): FlowChanges | undefined {
  const node = revision.node(target, nodeId)?.node
  if (node == null) return
  if (node.description == description) return []
  return [{ before: node.description, field: 'description', kind: 'graph.node.field.set', nodeId, target, value: description }]
}

export function updateNodeIcon(revision: RevisionView, target: DesignerTarget, nodeId: string, icon: string | undefined): FlowChanges | undefined {
  const node = revision.node(target, nodeId)?.node
  if (node == null) return
  if (node.icon == icon) return []
  return [{ before: node.icon, field: 'icon', kind: 'graph.node.field.set', nodeId, target, value: icon }]
}

export function updateNodeName(revision: RevisionView, target: DesignerTarget, nodeId: string, name: string | undefined): FlowChanges | undefined {
  const node = revision.node(target, nodeId)?.node
  if (node == null) return
  const value = !('inputs' in node) ? (name ?? node.name) : name
  if (node.name == value) return []
  return [{ before: node.name, field: 'name', kind: 'graph.node.field.set', nodeId, target, value }]
}

export function setInputValue(
  revision: RevisionView,
  target: DesignerTarget,
  nodeId: string,
  handle: string,
  value: JsonValue | undefined,
): FlowChanges | undefined {
  const node = revision.graph(target)?.nodes[nodeId]
  if (value === undefined && node != null && 'inputs' in node && node.inputs[handle] == null) return
  return setGraphInputValue(revision.revision.content, target, nodeId, handle, value)
}

export function setInputVariable(
  revision: RevisionView,
  target: DesignerTarget,
  nodeId: string,
  handle: string,
  name: string,
  bindingId: string,
): FlowChanges | undefined {
  return setGraphInputVariable(revision.revision.content, target, nodeId, handle, name, bindingId)
}

export function updateCondition(revision: RevisionView, target: DesignerTarget, nodeId: string, settings: ConditionSettings): FlowChanges | undefined {
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
  const outputRename = renamedPort(
    Object.keys(currentOutputs).map((handle) => ({ handle })),
    Object.keys(nextOutputs).map((handle) => ({ handle })),
  )
  const outputNames = new Set(Object.keys(nextOutputs))
  const changes: ChangeOperation[] = []

  for (const [currentNodeId, node] of Object.entries(graph.nodes)) {
    if (!('inputs' in node)) continue
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
      if (sources.length == 0) delete inputs[name]
      else inputs[name] = { kind: 'sources', sources }
    }

    if (currentNodeId == nodeId) {
      const before = { cases: current.cases, defaultOutput: current.defaultOutput, input: current.input }
      if (!dequal(before, settings)) changes.push({ before, kind: 'graph.node.condition.set', nodeId, target, value: settings })
    }
    changes.push(...changedInputs(node.inputs, inputs, target, currentNodeId))
  }
  return cleanVariableBindings(revision.revision.content, changes)
}

export function updateValue(revision: RevisionView, target: DesignerTarget, nodeId: string, settings: readonly ValueSettings[]): FlowChanges | undefined {
  const node = revision.node(target, nodeId)?.node
  if (node?.kind != 'value') return
  const values = settings.map((item) => ({
    handle: item.handle,
    ...(item.description == null ? {} : { description: item.description }),
    jsonSchema: (item.jsonSchema ?? {}) as JsonValue,
    nullable: item.nullable ?? false,
    ...(Object.hasOwn(item, 'value') ? { value: item.value as JsonValue } : {}),
  }))
  if (dequal(node.values, values)) return []
  return [{ before: node.values, kind: 'graph.node.values.set', nodeId, target, value: values }]
}

export function updateTask(revision: RevisionView, target: DesignerTarget, nodeId: string, settings: TaskSettings): FlowChanges | undefined {
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
      const changes: ChangeOperation[] = []
      if (task.name != settings.name) changes.push({ before: task.name, kind: 'task.name.set', taskId: node.taskId, value: settings.name })
      if (task.executor.mode != settings.mode) {
        changes.push({ before: task.executor.mode, kind: 'task.llm.mode.set', taskId: node.taskId, value: settings.mode })
      }
      return changes
    }
    case 'connector': {
      if (node.task != null) return
      const task = revision.task(node.taskId)
      if (task?.executor.kind != 'connector') return
      return task.name == settings.name ? [] : [{ before: task.name, kind: 'task.name.set', taskId: node.taskId, value: settings.name }]
    }
  }
}

export function updateCodeTaskPorts(revision: RevisionView, target: DesignerTarget, nodeId: string, ports: CodeTaskPorts): FlowChanges | undefined {
  const selection = revision.node(target, nodeId)
  if (selection?.kind != 'task' || selection.node.task == null || selection.module == null) return
  if (dequal(selection.node.task.inputs, ports.inputs) && dequal(selection.node.task.outputs, ports.outputs)) return
  const changes = replaceCodeTaskPorts(revision, target, nodeId, { ...selection.node.task, ...ports })
  if (changes == null) return
  return cleanVariableBindings(revision.revision.content, changes)
}

export function updateTaskAdditionalInputs(
  revision: RevisionView,
  target: DesignerTarget,
  nodeId: string,
  additionalInputs: readonly InputPort[],
): FlowChanges | undefined {
  const selection = revision.node(target, nodeId)
  if (selection?.kind != 'task' || selection.node.task != null || selection.definition == null) return
  const current = selection.node
  if (dequal(current.additionalInputs ?? [], additionalInputs)) return
  const rename = renamedPort(current.additionalInputs ?? [], additionalInputs)
  const handles = new Set(
    selection.definition.inputs.flatMap((port) => ('handle' in port ? [port.handle] : [])).concat(additionalInputs.map((port) => port.handle)),
  )
  const inputs: Record<string, InputMapping> = Object.assign({}, current.inputs)
  if (rename != null && Object.hasOwn(inputs, rename[0])) {
    inputs[rename[1]] = inputs[rename[0]]!
    delete inputs[rename[0]]
  }
  for (const handle of Object.keys(inputs)) {
    if (!handles.has(handle)) delete inputs[handle]
  }
  const value = additionalInputs.length == 0 ? undefined : additionalInputs
  return cleanVariableBindings(revision.revision.content, [
    { before: current.additionalInputs, kind: 'graph.node.additional-inputs.set', nodeId, target, value },
    ...changedInputs(current.inputs, inputs, target, nodeId),
  ])
}

export function updateWebhook(
  revision: RevisionView,
  target: Extract<DesignerTarget, { readonly kind: 'flow' }>,
  triggerId: string,
  settings: WebhookSettings,
): FlowChanges | undefined {
  const trigger = revision.trigger(triggerId)
  if (trigger == null || trigger.kind != 'webhook') return
  const before = { inputsDef: trigger.inputsDef, options: trigger.options }
  const value = { inputsDef: settings.inputs, options: Object.keys(settings.options).length == 0 ? undefined : settings.options }
  if (dequal(before.inputsDef, value.inputsDef) && dequal(before.options, value.options)) return []
  return [{ before, kind: 'graph.node.webhook.set', nodeId: triggerId, target, value }]
}

export function updateSubflow(revision: RevisionView, subflowId: string, settings: SubflowSettings): FlowChanges | undefined {
  const subflow = revision.subflow(subflowId)
  if (subflow == null) return
  const before = { inputs: subflow.inputs, name: subflow.name, outputs: subflow.outputs }
  if (dequal(before, settings)) return []
  return [{ before, definition: settings, kind: 'subflow.definition.set', subflowId }]
}

function createSubflowNode(target: DesignerTarget, nodeId: string, subflowId: string, inputs: TaskDefinition['inputs']): FlowChanges {
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
    ports.flatMap((port) =>
      'handle' in port && Object.hasOwn(port, 'value') ? [[port.handle, { kind: 'value' as const, value: port.value as JsonValue }]] : [],
    ),
  ) as Readonly<Record<string, InputMapping>>
}

function renamedPort(
  previous: readonly ({ readonly handle: string } | { readonly group: string })[],
  next: readonly ({ readonly handle: string } | { readonly group: string })[],
): readonly [oldName: string, newName: string] | undefined {
  const previousNames = new Set(previous.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  const nextNames = new Set(next.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  const removed = [...previousNames].filter((name) => !nextNames.has(name))
  const added = [...nextNames].filter((name) => !previousNames.has(name))
  return removed.length == 1 && added.length == 1 ? [removed[0]!, added[0]!] : undefined
}

function changedInputs(
  before: Readonly<Record<string, InputMapping>>,
  value: Readonly<Record<string, InputMapping>>,
  target: DesignerTarget,
  nodeId: string,
): ChangeOperation[] {
  const handles = new Set([...Object.keys(before), ...Object.keys(value)])
  const changes: ChangeOperation[] = []
  for (const handle of handles) {
    if (!dequal(before[handle], value[handle])) {
      changes.push({ before: before[handle], handle, kind: 'graph.node.input.set', nodeId, target, value: value[handle] })
    }
  }
  return changes
}

function replaceCodeTaskPorts(
  revision: RevisionView,
  target: DesignerTarget,
  nodeId: string,
  task: Extract<TaskDefinition, { readonly moduleId: string }>,
): FlowChanges | undefined {
  const graph = revision.graph(target)
  const current = graph?.nodes[nodeId]
  if (graph == null || current?.kind != 'task' || current.task == null) return
  const inputRename = renamedPort(current.task.inputs, task.inputs)
  const outputRename = renamedPort(current.task.outputs, task.outputs)
  const inputNames = new Set(task.inputs.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  const outputNames = new Set(task.outputs.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  const changes: ChangeOperation[] = []

  for (const [currentNodeId, node] of Object.entries(graph.nodes)) {
    if (!('inputs' in node)) continue
    const inputs: Record<string, InputMapping> = { ...node.inputs }

    if (currentNodeId == nodeId) {
      if (inputRename != null && Object.hasOwn(inputs, inputRename[0])) {
        inputs[inputRename[1]] = inputs[inputRename[0]]!
        delete inputs[inputRename[0]]
      }
      for (const name of Object.keys(inputs)) {
        if (!inputNames.has(name)) delete inputs[name]
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
      if (sources.length == 0) delete inputs[name]
      else inputs[name] = { kind: 'sources', sources }
    }

    if (currentNodeId == nodeId) {
      if (current.task.name != task.name) {
        changes.push({ before: current.task.name, kind: 'graph.node.task.name.set', nodeId, target, value: task.name })
      }
      const before = { inputs: current.task.inputs, outputs: current.task.outputs }
      const value = { inputs: task.inputs, outputs: task.outputs }
      if (!dequal(before, value)) changes.push({ before, kind: 'graph.node.task.ports.set', nodeId, target, value })
    }
    changes.push(...changedInputs(node.inputs, inputs, target, currentNodeId))
  }
  return changes
}
