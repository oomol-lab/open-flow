import type { GraphTarget, AgentInput, AgentTool, ManagedTaskDefinition } from '../../../../flow/common/change.ts'
import type {
  ChangeOperation,
  ConditionNode,
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
import type { ConnectorActionView } from '../connectionCatalog.ts'
import type { RevisionView } from '../revisionView.ts'

import { dequal } from 'dequal/lite'
import { nextNodeName, normalizeNodeName, applyFlowChanges as reduceFlowChanges } from '../../../../flow/common/change.ts'
import { nodeInputMappings, otherwiseOutput } from '../../../../flow/common/condition.ts'
import { fixedInputValue } from '../../../../flow/common/inputValue.ts'
import {
  cleanVariableBindings,
  createApproval,
  createAgentTask,
  createCodeTask,
  createBuiltinTrigger,
  createCondition,
  createLlmTask,
  createManagedTask,
  createProviderTrigger,
  createValue,
  createWait,
  defaultNodeName,
  deleteNodes,
  updateSettings,
  setInputValue as setGraphInputValue,
  setInputVariable as setGraphInputVariable,
} from '../../../../flow/common/nodeChanges.ts'
import { valueForEditor } from '../../../../form/common/editorComponent.ts'

export type FlowChanges = readonly ChangeOperation[]

export function applyFlowChanges(draft: Draft, changes: FlowChanges): Draft {
  return { ...draft, content: reduceFlowChanges(draft.content, changes) }
}

export interface WebhookSettings {
  readonly bodyFields: Extract<TriggerNode, { readonly kind: 'webhook' }>['bodyFields']
  readonly method: Extract<TriggerNode, { readonly kind: 'webhook' }>['method']
  readonly options: WebhookOptions
}

export interface ValueSettings {
  readonly description?: string
  readonly handle: string
  readonly jsonSchema?: unknown
  readonly nullable?: boolean
  readonly value?: unknown
}

export type ConditionSettings = Pick<ConditionNode, 'cases' | 'matchMode'>

interface TaskSettingsBase {
  readonly name: string
}

export type TaskSettings =
  | (TaskSettingsBase & { readonly kind: 'agent'; readonly before: ManagedTaskDefinition; readonly task: ManagedTaskDefinition })
  | (TaskSettingsBase & { readonly kind: 'code' })
  | (TaskSettingsBase & { readonly kind: 'connector' })
  | (TaskSettingsBase & { readonly kind: 'llm'; readonly mode: 'chat' | 'json' })

export type TaskPorts = Pick<TaskDefinition, 'inputs' | 'outputs'>

export interface SubflowSettings {
  readonly inputs: NonNullable<ReturnType<RevisionView['subflow']>>['inputs']
  readonly name: string
  readonly outputs: NonNullable<ReturnType<RevisionView['subflow']>>['outputs']
}

export type AddNodeIntent =
  | { readonly kind: 'agent'; readonly name: string }
  | { readonly kind: 'approval'; readonly name: string }
  | { readonly kind: 'code'; readonly name: string; readonly ports?: TaskPorts }
  | { readonly action: ConnectorActionView; readonly kind: 'connector' }
  | { readonly kind: 'condition'; readonly name: string }
  | { readonly kind: 'manual'; readonly name: string }
  | { readonly kind: 'cron'; readonly name: string }
  | { readonly kind: 'llm'; readonly mode: 'chat' | 'json'; readonly name: string; readonly outputDescription: string }
  | { readonly kind: 'provider-trigger'; readonly connectionId?: string; readonly definition: TriggerKeySnapshot }
  | { readonly kind: 'subflow'; readonly subflowId: string }
  | { readonly kind: 'value'; readonly name: string }
  | { readonly kind: 'wait'; readonly name: string }
  | { readonly kind: 'webhook'; readonly name: string }

function connectorTask(action: ConnectorActionView): Extract<TaskDefinition, { readonly executor: unknown }> {
  return {
    executor: {
      action: action.actionId,
      ...(action.defaultConnection == null ? {} : { connectionId: action.defaultConnection.connectionId }),
      kind: 'connector',
    },
    inputs: Object.entries(action.inputs).map(([handle, port]) => Object.assign({ handle }, port)),
    name: action.name,
    outputs: Object.entries(action.outputs).map(([handle, port]) => Object.assign({ handle }, port)),
  }
}

export function agentTool(action: ConnectorActionView, id: string, connectionId?: string): AgentTool {
  return {
    id,
    name: `${action.actionId.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 48)}_${id.slice(0, 8)}`,
    description: action.description,
    action: action.actionId,
    ...(connectionId == null ? {} : { connectionId }),
    approval: false,
    inputs: Object.entries(action.inputs).map(([handle, { value: _value, ...port }]) =>
      Object.assign({ handle }, port, { source: { kind: 'model' as const } }),
    ),
  }
}

export function createResource(id: string, name: string): FlowChanges {
  return [
    {
      kind: 'subflow.create',
      subflow: {
        graph: { edges: [], nodes: {} },
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

export function nameCreatedNodes(revision: RevisionView, target: GraphTarget, changes: FlowChanges): FlowChanges {
  const graph = revision.graph(target)
  if (graph == null) return changes
  const names = new Set(Object.values(graph.nodes).flatMap((node) => (node.name == null ? [] : [node.name])))
  return changes.map((operation) => {
    if (operation.kind != 'graph.node.create' || operation.target.kind != target.kind) return operation
    if (target.kind == 'subflow' && (operation.target.kind != 'subflow' || operation.target.id != target.id)) return operation
    const requested = normalizeNodeName(operation.node.name ?? '') || defaultNodeName(revision.revision.content, operation.node)
    const name = nextNodeName(requested, names)
    names.add(name)
    return { ...operation, node: { ...operation.node, name } }
  })
}

export function addNode(revision: RevisionView, target: GraphTarget, nodeId: string, intent: AddNodeIntent, identity: () => string): FlowChanges | undefined {
  let changes: FlowChanges | undefined
  switch (intent.kind) {
    case 'code':
      changes = createCodeTask(target, { moduleId: nodeId, nodeId }, intent.name, undefined, intent.ports)
      break
    case 'agent':
      changes = target.kind == 'flow' ? createAgentTask(target, { nodeId, taskId: identity() }, intent.name) : undefined
      break
    case 'llm':
      changes = createLlmTask(target, { nodeId, taskId: identity() }, intent.name, intent.mode, intent.outputDescription)
      break
    case 'connector':
      changes = createManagedTask(target, { nodeId, taskId: identity() }, connectorTask(intent.action))
      break
    case 'condition':
      changes = createCondition(target, nodeId, intent.name)
      break
    case 'approval':
      changes = target.kind == 'flow' ? createApproval(target, nodeId, intent.name) : undefined
      break
    case 'value':
      changes = createValue(target, nodeId, intent.name)
      break
    case 'wait':
      changes = target.kind == 'flow' ? createWait(target, nodeId, intent.name) : undefined
      break
    case 'subflow': {
      const subflow = revision.subflow(intent.subflowId)
      if (subflow == null) return
      changes = createSubflowNode(target, nodeId, intent.subflowId, subflow.inputs)
      break
    }
    case 'manual':
      changes = target.kind == 'flow' ? createBuiltinTrigger(target, nodeId, { kind: 'manual', name: intent.name }) : undefined
      break
    case 'webhook':
      changes = target.kind == 'flow' ? createBuiltinTrigger(target, nodeId, { bodyFields: [], kind: 'webhook', method: 'POST', name: intent.name }) : undefined
      break
    case 'cron':
      changes =
        target.kind == 'flow'
          ? createBuiltinTrigger(target, nodeId, {
              cronTimes: [{ type: 'every', unit: 'hour', value: 1 }],
              kind: 'cron',
              name: intent.name,
            })
          : undefined
      break
    case 'provider-trigger': {
      if (target.kind != 'flow') return
      changes = createProviderTrigger(target, nodeId, intent.definition, {
        config: {},
        ...(intent.connectionId == null ? {} : { connectionId: intent.connectionId }),
      })
      break
    }
  }
  return changes == null ? undefined : nameCreatedNodes(revision, target, changes)
}

export function deleteSelection(revision: RevisionView, target: GraphTarget, nodeIds: readonly string[]): FlowChanges {
  return deleteNodes(revision.revision.content, target, nodeIds)
}

export function updateNodeSettings(revision: RevisionView, target: GraphTarget, nodeId: string, settings: NodeSettings): FlowChanges | undefined {
  return updateSettings(revision.revision.content, target, nodeId, settings)
}

export function updateNodeDescription(revision: RevisionView, target: GraphTarget, nodeId: string, description: string | undefined): FlowChanges | undefined {
  const node = revision.node(target, nodeId)?.node
  if (node == null) return
  if (node.description == description) return []
  return [{ before: node.description, field: 'description', kind: 'graph.node.field.set', nodeId, target, value: description }]
}

export function updateNodeIcon(revision: RevisionView, target: GraphTarget, nodeId: string, icon: string | undefined): FlowChanges | undefined {
  const node = revision.node(target, nodeId)?.node
  if (node == null) return
  if (node.icon == icon) return []
  return [{ before: node.icon, field: 'icon', kind: 'graph.node.field.set', nodeId, target, value: icon }]
}

export function updateNodeName(revision: RevisionView, target: GraphTarget, nodeId: string, name: string | undefined): FlowChanges | undefined {
  const node = revision.node(target, nodeId)?.node
  if (node == null || node.kind == 'manual') return
  const value = !('inputs' in node) ? (name ?? node.name) : name
  if (node.name == value) return []
  return [{ before: node.name, field: 'name', kind: 'graph.node.field.set', nodeId, target, value }]
}

export function setInputValue(
  revision: RevisionView,
  target: GraphTarget,
  nodeId: string,
  handle: string,
  value: JsonValue | undefined,
): FlowChanges | undefined {
  return setGraphInputValue(revision.revision.content, target, nodeId, handle, value)
}

export function setInputVariable(
  revision: RevisionView,
  target: GraphTarget,
  nodeId: string,
  handle: string,
  name: string,
  bindingId: string,
): FlowChanges | undefined {
  return setGraphInputVariable(revision.revision.content, target, nodeId, handle, name, bindingId)
}

export function updateCondition(revision: RevisionView, target: GraphTarget, nodeId: string, settings: ConditionSettings): FlowChanges | undefined {
  const graph = revision.graph(target)
  const current = graph?.nodes[nodeId]
  if (graph == null || current?.kind != 'condition') return
  const outputRename = renamedPort(
    current.cases.map(({ output }) => ({ handle: output })),
    settings.cases.map(({ output }) => ({ handle: output })),
  )
  const outputs = new Set([...settings.cases.map((item) => item.output), otherwiseOutput])
  const changes: ChangeOperation[] = []
  for (const edge of graph.edges) {
    if (edge.source != nodeId || edge.sourceHandle == null) continue
    const renamed = outputRename != null && edge.sourceHandle == outputRename[0] ? outputRename[1] : edge.sourceHandle
    if (renamed == edge.sourceHandle && outputs.has(renamed)) continue
    changes.push({ kind: 'graph.edge.disconnect', edge, target })
    if (outputs.has(renamed)) changes.push({ kind: 'graph.edge.connect', edge: { ...edge, sourceHandle: renamed }, target })
  }
  const before = { cases: current.cases, matchMode: current.matchMode }
  if (!dequal(before, settings)) changes.push({ before, kind: 'graph.node.condition.set', nodeId, target, value: settings })
  return cleanVariableBindings(revision.revision.content, changes)
}

export function updateValue(revision: RevisionView, target: GraphTarget, nodeId: string, settings: readonly ValueSettings[]): FlowChanges | undefined {
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

export function updateResolution(
  revision: RevisionView,
  target: GraphTarget,
  nodeId: string,
  settings: Pick<Extract<GraphNode, { readonly kind: 'approval' | 'wait' }>, 'prompt'> & {
    readonly name?: string
    readonly inputDefinitions?: readonly InputPort[]
  },
  values?: Readonly<Record<string, JsonValue | undefined>>,
): FlowChanges | undefined {
  if (target.kind != 'flow') return
  const graph = revision.graph(target)
  const current = graph?.nodes[nodeId]
  if (graph == null || (current?.kind != 'approval' && current?.kind != 'wait')) return
  const before = {
    inputDefinitions: current.inputDefinitions,
    prompt: current.prompt,
  }
  const value = {
    inputDefinitions: settings.inputDefinitions ?? current.inputDefinitions,
    prompt: settings.prompt,
  }
  const changes: ChangeOperation[] = []
  if (current.name != settings.name) {
    changes.push({ before: current.name, field: 'name', kind: 'graph.node.field.set', nodeId, target, value: settings.name })
  }
  if (!dequal(before, value)) changes.push({ before, kind: 'graph.node.resolution.set', nodeId, target, value })
  if (values == null && dequal(before.inputDefinitions, value.inputDefinitions)) return changes
  const inputs = updatedInputMappings(current.inputs, before.inputDefinitions, value.inputDefinitions, undefined, values)
  changes.push(...changedInputs(current.inputs, inputs, target, nodeId))
  return cleanVariableBindings(revision.revision.content, changes)
}

export function updateTask(revision: RevisionView, target: GraphTarget, nodeId: string, settings: TaskSettings): FlowChanges | undefined {
  const node = revision.graph(target)?.nodes[nodeId]
  if (node?.kind != 'task') return
  switch (settings.kind) {
    case 'agent': {
      if (node.taskId == null || !dequal(revision.task(node.taskId), settings.before)) return
      return [{ kind: 'task.agent.set', taskId: node.taskId, before: settings.before, value: settings.task }]
    }
    case 'code': {
      if (node.task == null) return
      return replaceTaskPorts(revision, target, nodeId, { ...node.task, name: settings.name })
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

export function updateTaskPorts(
  revision: RevisionView,
  target: GraphTarget,
  nodeId: string,
  ports: TaskPorts,
  values?: Readonly<Record<string, JsonValue | undefined>>,
): FlowChanges | undefined {
  const selection = revision.node(target, nodeId)
  if (
    selection?.kind == 'task' &&
    selection.node.taskId != null &&
    selection.definition != null &&
    'executor' in selection.definition &&
    selection.definition.executor.kind == 'agent'
  ) {
    const changes = replaceTaskPorts(revision, target, nodeId, { ...selection.definition, ...ports }, values)
    return changes == null ? undefined : cleanVariableBindings(revision.revision.content, changes)
  }
  if (selection?.kind != 'task' || selection.node.task == null || selection.module == null) return
  if (values == null && dequal(selection.node.task.inputs, ports.inputs) && dequal(selection.node.task.outputs, ports.outputs)) return []
  const changes = replaceTaskPorts(revision, target, nodeId, { ...selection.node.task, ...ports }, values)
  if (changes == null) return
  return cleanVariableBindings(revision.revision.content, changes)
}

export function updateTaskAdditionalInputs(
  revision: RevisionView,
  target: GraphTarget,
  nodeId: string,
  additionalInputs: readonly InputPort[],
  values?: Readonly<Record<string, JsonValue | undefined>>,
): FlowChanges | undefined {
  const selection = revision.node(target, nodeId)
  if (selection?.kind != 'task' || selection.node.task != null || selection.definition == null) return
  const current = selection.node
  if (values == null && dequal(current.additionalInputs ?? [], additionalInputs)) return []
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
  convertInputValues(inputs, current.additionalInputs ?? [], additionalInputs, rename, values)
  const value = additionalInputs.length == 0 ? undefined : additionalInputs
  return cleanVariableBindings(revision.revision.content, [
    { before: current.additionalInputs, kind: 'graph.node.additional-inputs.set', nodeId, target, value },
    ...changedInputs(current.inputs, inputs, target, nodeId),
  ])
}

export function updateWebhook(
  revision: RevisionView,
  target: Extract<GraphTarget, { readonly kind: 'flow' }>,
  triggerId: string,
  settings: WebhookSettings,
): FlowChanges | undefined {
  const trigger = revision.trigger(triggerId)
  if (trigger == null || trigger.kind != 'webhook') return
  const before = { bodyFields: trigger.bodyFields, method: trigger.method, options: trigger.options }
  const value = { bodyFields: settings.bodyFields, method: settings.method, options: Object.keys(settings.options).length == 0 ? undefined : settings.options }
  if (dequal(before, value)) return []
  return [{ before, kind: 'graph.node.webhook.set', nodeId: triggerId, target, value }]
}

export function updateSubflow(revision: RevisionView, subflowId: string, settings: SubflowSettings): FlowChanges | undefined {
  const subflow = revision.subflow(subflowId)
  if (subflow == null) return
  const before = { inputs: subflow.inputs, name: subflow.name, outputs: subflow.outputs }
  if (dequal(before, settings)) return []
  return [{ before, definition: settings, kind: 'subflow.definition.set', subflowId }]
}

function createSubflowNode(target: GraphTarget, nodeId: string, subflowId: string, inputs: TaskDefinition['inputs']): FlowChanges {
  return [
    {
      kind: 'graph.node.create',
      node: { inputs: defaultInputs(inputs), kind: 'subflow', subflowId },
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

function updatedInputMappings(
  mappings: Readonly<Record<string, InputMapping>>,
  previous: TaskDefinition['inputs'],
  next: TaskDefinition['inputs'],
  rename = renamedPort(previous, next),
  values?: Readonly<Record<string, JsonValue | undefined>>,
): Record<string, InputMapping> {
  const inputs = { ...mappings }
  if (rename != null && Object.hasOwn(inputs, rename[0])) {
    inputs[rename[1]] = inputs[rename[0]]!
    delete inputs[rename[0]]
  }
  const names = new Set(next.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  for (const name of Object.keys(inputs)) if (!names.has(name)) delete inputs[name]
  convertInputValues(inputs, previous, next, rename, values)
  return inputs
}

/** Convert assigned literals together with their definition, preserving sources and unset inputs. */
function convertInputValues(
  inputs: Record<string, InputMapping>,
  previous: readonly (InputPort | { readonly group: string })[],
  next: readonly (InputPort | { readonly group: string })[],
  rename: readonly [string, string] | undefined,
  values?: Readonly<Record<string, JsonValue | undefined>>,
): void {
  for (const port of next) {
    if (!('handle' in port)) continue
    if (values != null && Object.hasOwn(values, port.handle)) {
      inputs[port.handle] = fixedInputValue(values[port.handle])
      continue
    }
    const oldHandle = rename?.[1] === port.handle ? rename[0] : port.handle
    const before = previous.find((item): item is InputPort => 'handle' in item && item.handle === oldHandle)
    const mapping = inputs[port.handle]
    if (before == null || dequal(before.jsonSchema, port.jsonSchema) || mapping?.kind !== 'value') continue
    if (mapping.value === null && port.nullable) continue
    const value = valueForEditor(port.jsonSchema, mapping.value) as JsonValue | undefined
    if (value === undefined) delete inputs[port.handle]
    else inputs[port.handle] = { kind: 'value', value }
  }
}

function changedInputs(
  before: Readonly<Record<string, InputMapping>>,
  value: Readonly<Record<string, InputMapping>>,
  target: GraphTarget,
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

function replaceTaskPorts(
  revision: RevisionView,
  target: GraphTarget,
  nodeId: string,
  task: TaskDefinition,
  values?: Readonly<Record<string, JsonValue | undefined>>,
): FlowChanges | undefined {
  const graph = revision.graph(target)
  const current = graph?.nodes[nodeId]
  if (graph == null || current?.kind != 'task') return
  const previous = current.task ?? revision.task(current.taskId)
  if (previous == null) return
  const inputRename = renamedPort(previous.inputs, task.inputs)
  const outputRename = renamedPort(previous.outputs, task.outputs)
  const inputNames = new Set(task.inputs.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  const outputNames = new Set(task.outputs.flatMap((port) => ('handle' in port ? [port.handle] : [])))
  const changes: ChangeOperation[] = []
  for (const edge of graph.edges) {
    if (edge.source != nodeId || edge.sourceHandle == null) continue
    const renamed = outputRename != null && edge.sourceHandle == outputRename[0] ? outputRename[1] : edge.sourceHandle
    if (renamed == edge.sourceHandle && outputNames.has(renamed)) continue
    changes.push({ kind: 'graph.edge.disconnect', edge, target })
    if (outputNames.has(renamed)) changes.push({ kind: 'graph.edge.connect', edge: { ...edge, sourceHandle: renamed }, target })
  }

  for (const [currentNodeId, node] of Object.entries(graph.nodes)) {
    if (!('inputs' in node)) continue
    const inputs =
      currentNodeId == nodeId ? updatedInputMappings(node.inputs, previous.inputs, task.inputs, inputRename, values) : { ...nodeInputMappings(node) }

    for (const [name, mapping] of Object.entries(inputs)) {
      if (mapping.kind != 'sources') continue
      const sources = mapping.sources.map((source) => {
        if (source.kind != 'node' || source.nodeId != nodeId) return source
        if (outputRename != null && source.output == outputRename[0]) return { ...source, output: outputRename[1] }
        return source
      })
      if (sources.every((source, index) => source === mapping.sources[index])) continue
      inputs[name] = { kind: 'sources', sources }
    }

    if (currentNodeId == nodeId && current.task != null) {
      if (current.task.name != task.name) {
        changes.push({ before: current.task.name, kind: 'graph.node.task.name.set', nodeId, target, value: task.name })
      }
      const before = { inputs: current.task.inputs, outputs: current.task.outputs }
      const value = { inputs: task.inputs, outputs: task.outputs }
      if (!dequal(before, value)) changes.push({ before, kind: 'graph.node.task.ports.set', nodeId, target, value })
    }
    changes.push(...changedInputs(nodeInputMappings(node), inputs, target, currentNodeId))
  }
  if (current.task == null && 'executor' in task && task.executor.kind == 'agent' && 'executor' in previous) {
    const config = task.executor
    const source = <Value extends AgentInput>(
      value: Value,
    ): Value | { readonly kind: 'input'; readonly input: string } | { readonly kind: 'value'; readonly value: null } => {
      if (value.kind != 'input') return value
      if (inputRename != null && value.input == inputRename[0]) return { kind: 'input', input: inputRename[1] }
      return inputNames.has(value.input) ? value : { kind: 'value', value: null }
    }
    const prompt = source(config.prompt)
    const value = {
      ...task,
      executor: {
        ...config,
        prompt,
        tools: config.tools.map((tool) => ({ ...tool, inputs: tool.inputs.map((port) => ({ ...port, source: source(port.source) })) })),
        ...(config.notification == null
          ? {}
          : {
              notification: {
                ...config.notification,
                inputs: Object.fromEntries(Object.entries(config.notification.inputs).map(([handle, binding]) => [handle, source(binding)])),
              },
            }),
      },
    }
    if (!dequal(previous, value)) changes.unshift({ kind: 'task.agent.set', taskId: current.taskId, before: previous, value })
  }
  return changes
}
import type { Settings as NodeSettings } from '../../../../flow/common/nodeChanges.ts'
