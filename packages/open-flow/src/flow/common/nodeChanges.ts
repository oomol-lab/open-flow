import type {
  ChangeOperation,
  CodeModule,
  GraphTarget,
  InputMapping,
  JsonValue,
  PortDefinition,
  RevisionContent,
  TaskDefinition,
  TriggerKeySnapshot,
  TriggerNode,
  TriggerSchedule,
  WebhookOptions,
} from './change.ts'

import { dequal } from 'dequal/lite'
import { applyFlowChanges } from './change.ts'

const codeTaskTemplate = `export default async function (inputs, context) {
  return { result: inputs.value }
}
`

export interface Settings {
  readonly concurrency: number
  readonly name?: string
  readonly timeoutMs?: number
}

export interface LlmTaskOptions {
  readonly inputs?: Readonly<Partial<Record<LlmInputHandle, JsonValue>>>
  readonly output?: PortDefinition
}

export type LlmInputHandle = 'input' | 'messages' | 'model' | 'template'

interface TriggerSettingsBase {
  readonly description?: string
  readonly name: string
}

export type TriggerSettings =
  | (TriggerSettingsBase & {
      readonly inputs: Extract<TriggerNode, { readonly kind: 'webhook' }>['inputsDef']
      readonly kind: 'webhook'
      readonly options: WebhookOptions
    })
  | (TriggerSettingsBase & { readonly kind: 'cron'; readonly schedule: readonly TriggerSchedule[] })
  | (TriggerSettingsBase & {
      readonly config: Readonly<Record<string, JsonValue>>
      readonly kind: 'poll'
      readonly schedule: readonly TriggerSchedule[]
    })
  | (TriggerSettingsBase & { readonly config: Readonly<Record<string, JsonValue>>; readonly kind: 'integration' })

export function createCodeTask(
  target: GraphTarget,
  identity: { readonly moduleId: string; readonly nodeId: string },
  name: string,
  module: Pick<CodeModule, 'imports' | 'source'> | undefined = undefined,
  ports: Pick<Extract<TaskDefinition, { readonly moduleId: string }>, 'inputs' | 'outputs'> = {
    inputs: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
    outputs: [{ handle: 'result', jsonSchema: {}, nullable: true }],
  },
): readonly ChangeOperation[] {
  const codeModule = module ?? {
    imports: [],
    source: codeTaskTemplate,
  }
  return [
    {
      kind: 'module.create',
      module: { ...codeModule, name },
      moduleId: identity.moduleId,
    },
    {
      kind: 'graph.node.create',
      node: {
        concurrency: 1,
        inputs: defaultInputs(ports.inputs),
        kind: 'task',
        name,
        task: {
          inputs: ports.inputs,
          moduleId: identity.moduleId,
          name,
          outputs: ports.outputs,
        },
      },
      nodeId: identity.nodeId,
      target,
    },
  ]
}

export function createManagedTask(
  target: GraphTarget,
  identity: { readonly nodeId: string; readonly taskId: string },
  task: Extract<TaskDefinition, { readonly executor: unknown }>,
): readonly ChangeOperation[] {
  return [
    { kind: 'task.create', task, taskId: identity.taskId },
    {
      kind: 'graph.node.create',
      node: {
        concurrency: 1,
        inputs: defaultInputs(task.inputs),
        kind: 'task',
        name: task.name,
        taskId: identity.taskId,
      },
      nodeId: identity.nodeId,
      target,
    },
  ]
}

export function createLlmTask(
  target: GraphTarget,
  identity: { readonly nodeId: string; readonly taskId: string },
  name: string,
  mode: 'chat' | 'json',
  outputDescription: string,
  options: LlmTaskOptions = {},
): readonly ChangeOperation[] {
  const values = options.inputs ?? {}
  return createManagedTask(target, identity, {
    executor: { kind: 'llm', mode },
    inputs: [
      { handle: 'messages', jsonSchema: { items: { type: 'object' }, type: 'array' }, nullable: true, value: llmInputValue(values, 'messages', null) },
      { handle: 'input', jsonSchema: { type: 'string' }, nullable: false, value: llmInputValue(values, 'input', 'Alex') },
      {
        handle: 'template',
        jsonSchema: { items: { type: 'object' }, minItems: 1, type: 'array' },
        nullable: false,
        value: llmInputValue(values, 'template', [{ content: "Hello, I'm {{input}}", role: 'user' }]),
      },
      { handle: 'model', jsonSchema: { type: 'object' }, nullable: false, value: llmInputValue(values, 'model', { model: 'deepseek-v4-flash' }) },
    ],
    name,
    outputs: [
      {
        ...options.output,
        description: options.output?.description ?? outputDescription,
        handle: 'output',
        jsonSchema: options.output?.jsonSchema ?? (mode == 'chat' ? { type: 'string' } : {}),
        nullable: options.output?.nullable ?? false,
      },
    ],
  })
}

export function createCondition(target: GraphTarget, nodeId: string, name: string): readonly ChangeOperation[] {
  return [
    {
      kind: 'graph.node.create',
      node: {
        cases: [{ expressions: [{ input: 'value', operator: 'isTrue' }], output: 'true', relation: 'all' }],
        concurrency: 1,
        defaultOutput: 'false',
        input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
        inputs: { value: { kind: 'value', value: null } },
        kind: 'condition',
        name,
      },
      nodeId,
      target,
    },
  ]
}

export function createValue(target: GraphTarget, nodeId: string, name: string): readonly ChangeOperation[] {
  return [
    {
      kind: 'graph.node.create',
      node: { concurrency: 1, inputs: {}, kind: 'value', name, values: [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }] },
      nodeId,
      target,
    },
  ]
}

export function createWait(target: Extract<GraphTarget, { readonly kind: 'flow' }>, nodeId: string, name: string): readonly ChangeOperation[] {
  return [
    {
      kind: 'graph.node.create',
      node: {
        actions: ['continue'],
        concurrency: 1,
        input: { handle: 'value', jsonSchema: {}, nullable: true, value: null },
        inputs: { value: { kind: 'value', value: null } },
        kind: 'wait',
        name,
        prompt: name,
      },
      nodeId,
      target,
    },
  ]
}

export function createBuiltinTrigger(
  target: Extract<GraphTarget, { readonly kind: 'flow' }>,
  nodeId: string,
  node: Extract<TriggerNode, { readonly kind: 'cron' | 'webhook' }>,
): readonly ChangeOperation[] {
  return [{ kind: 'graph.node.create', node, nodeId, target }]
}

export function createProviderTrigger(
  target: Extract<GraphTarget, { readonly kind: 'flow' }>,
  identity: { readonly bindingId: string; readonly nodeId: string },
  definition: TriggerKeySnapshot,
  options: {
    readonly config: Readonly<Record<string, JsonValue>>
    readonly connectionId?: string
    readonly name?: string
    readonly schedule?: readonly TriggerSchedule[]
  },
): readonly ChangeOperation[] {
  const name = options.name ?? definition.displayName
  const node: TriggerNode =
    definition.type == 'poll'
      ? {
          bindingId: identity.bindingId,
          config: options.config,
          definition,
          kind: 'poll',
          name,
          pollTimes: options.schedule ?? [{ type: 'every', unit: 'minute', value: 5 }],
        }
      : {
          bindingId: identity.bindingId,
          config: options.config,
          definition,
          kind: 'integration',
          name,
        }
  return [
    ...(options.connectionId == null
      ? []
      : [{ binding: { kind: 'connection' as const, target: options.connectionId }, bindingId: identity.bindingId, kind: 'binding.create' as const }]),
    { kind: 'graph.node.create', node, nodeId: identity.nodeId, target },
  ]
}

export function deleteNodes(content: RevisionContent, target: GraphTarget, nodeIds: readonly string[]): readonly ChangeOperation[] {
  const nodes = graph(content, target)?.nodes
  if (nodes == null) return []
  const removed = new Set(nodeIds)
  const operations: ChangeOperation[] = nodeIds.flatMap((nodeId) => {
    const node = nodes[nodeId]
    if (node == null) return []
    return [
      { kind: 'graph.node.delete' as const, nodeId, target },
      ...(node.kind == 'task' && node.task != null ? [{ kind: 'module.delete' as const, moduleId: node.task.moduleId }] : []),
    ]
  })
  if (target.kind == 'subflow') return cleanVariableBindings(content, operations)
  const bindingIds = new Set(
    nodeIds.flatMap((nodeId) => {
      const node = nodes[nodeId]
      return node?.kind == 'poll' || node?.kind == 'integration' ? [node.bindingId] : []
    }),
  )
  for (const bindingId of bindingIds) {
    const inUse = Object.entries(content.document.graph.nodes).some(
      ([nodeId, node]) => !removed.has(nodeId) && (node.kind == 'poll' || node.kind == 'integration') && node.bindingId == bindingId,
    )
    if (!inUse && content.document.bindings[bindingId] != null) operations.push({ bindingId, kind: 'binding.delete' })
  }
  return cleanVariableBindings(content, operations)
}

export function updateSettings(content: RevisionContent, target: GraphTarget, nodeId: string, settings: Settings): readonly ChangeOperation[] | undefined {
  const node = graph(content, target)?.nodes[nodeId]
  if (node == null || !('inputs' in node)) return
  const operations: ChangeOperation[] = []
  if (node.concurrency != settings.concurrency) {
    operations.push({ before: node.concurrency, field: 'concurrency', kind: 'graph.node.field.set', nodeId, target, value: settings.concurrency })
  }
  if (node.name != settings.name) operations.push({ before: node.name, field: 'name', kind: 'graph.node.field.set', nodeId, target, value: settings.name })
  if (node.timeoutMs != settings.timeoutMs) {
    operations.push({ before: node.timeoutMs, field: 'timeoutMs', kind: 'graph.node.field.set', nodeId, target, value: settings.timeoutMs })
  }
  return operations
}

export function setInputValue(
  content: RevisionContent,
  target: GraphTarget,
  nodeId: string,
  handle: string,
  value: JsonValue | undefined,
): readonly ChangeOperation[] | undefined {
  return setInputValues(content, target, nodeId, { [handle]: value })
}

export function setInputValues(
  content: RevisionContent,
  target: GraphTarget,
  nodeId: string,
  values: Readonly<Record<string, JsonValue | undefined>>,
): readonly ChangeOperation[] | undefined {
  const node = graph(content, target)?.nodes[nodeId]
  if (node == null || !('inputs' in node)) return
  const operations: ChangeOperation[] = []
  for (const [handle, value] of Object.entries(values)) {
    const before = node.inputs[handle]
    const next: InputMapping | undefined = value === undefined ? undefined : { kind: 'value', value }
    if (dequal(before, next)) continue
    operations.push({ before, handle, kind: 'graph.node.input.set', nodeId, target, value: next })
  }
  return cleanVariableBindings(content, operations)
}

export function setInputVariable(
  content: RevisionContent,
  target: GraphTarget,
  nodeId: string,
  handle: string,
  name: string,
  bindingId: string,
): readonly ChangeOperation[] | undefined {
  const node = graph(content, target)?.nodes[nodeId]
  if (node == null || !('inputs' in node)) return
  const mapping = node.inputs[handle]
  const currentId =
    mapping?.kind == 'sources' && mapping.sources.length == 1 && mapping.sources[0]?.kind == 'binding' ? mapping.sources[0].bindingId : undefined
  const current = currentId == null ? undefined : content.document.bindings[currentId]
  const references = bindingReferences(content.document)
  if (currentId != null && current?.kind == 'variable' && (references.get(currentId) ?? 0) == 1) {
    if (current.target == name) return []
    return [{ before: current.target, bindingId: currentId, kind: 'binding.target.set', value: name }]
  }
  const next: InputMapping = { kind: 'sources', sources: [{ bindingId, kind: 'binding' }] }
  return [
    { binding: { kind: 'variable', target: name }, bindingId, kind: 'binding.create' },
    ...cleanVariableBindings(content, [{ before: mapping, handle, kind: 'graph.node.input.set', nodeId, target, value: next }]),
  ]
}

export function cleanVariableBindings(content: RevisionContent, operations: readonly ChangeOperation[]): readonly ChangeOperation[] {
  const before = bindingReferences(content.document)
  const changed = applyFlowChanges(content, operations)
  const after = bindingReferences(changed.document)
  return [
    ...operations,
    ...[...before.keys()].flatMap((bindingId) =>
      after.has(bindingId) || changed.document.bindings[bindingId]?.kind != 'variable' ? [] : [{ bindingId, kind: 'binding.delete' as const }],
    ),
  ]
}

function bindingReferences(document: RevisionContent['document']): Map<string, number> {
  const references = new Map<string, number>()
  const add = (bindingId: string): void => {
    references.set(bindingId, (references.get(bindingId) ?? 0) + 1)
  }
  for (const currentGraph of [document.graph, ...Object.values(document.subflows).map((subflow) => subflow.graph)]) {
    for (const node of Object.values(currentGraph.nodes)) {
      if (node.kind == 'poll' || node.kind == 'integration') add(node.bindingId)
      if (!('inputs' in node)) continue
      const inputs = [...Object.values(node.inputs), ...(node.kind == 'wait' && node.notification != null ? Object.values(node.notification.inputs) : [])]
      for (const mapping of inputs) {
        if (mapping.kind != 'sources') continue
        for (const source of mapping.sources) if (source.kind == 'binding') add(source.bindingId)
      }
    }
  }
  return references
}

export function setConnectorConnection(content: RevisionContent, taskId: string, connectionId: string): readonly ChangeOperation[] | undefined {
  const task = content.document.tasks[taskId]
  if (task == null || !('executor' in task) || task.executor.kind != 'connector') return
  if (task.executor.connectionId == connectionId) return []
  return [{ before: task.executor.connectionId, kind: 'task.connector.connection.set', taskId, value: connectionId }]
}

export function updateTrigger(
  content: RevisionContent,
  target: { readonly kind: 'flow' },
  nodeId: string,
  settings: TriggerSettings,
): readonly ChangeOperation[] | undefined {
  const trigger = content.document.graph.nodes[nodeId]
  if (trigger == null) return
  const operations: ChangeOperation[] = []
  if (trigger.name != settings.name) {
    operations.push({ before: trigger.name, field: 'name', kind: 'graph.node.field.set', nodeId, target, value: settings.name })
  }
  if (trigger.description != settings.description) {
    operations.push({ before: trigger.description, field: 'description', kind: 'graph.node.field.set', nodeId, target, value: settings.description })
  }
  switch (settings.kind) {
    case 'webhook': {
      if (trigger.kind != 'webhook') return
      const value = { inputsDef: settings.inputs, options: Object.keys(settings.options).length == 0 ? undefined : settings.options }
      const before = { inputsDef: trigger.inputsDef, options: trigger.options }
      if (!dequal(before, value)) operations.push({ before, kind: 'graph.node.webhook.set', nodeId, target, value })
      break
    }
    case 'cron':
      if (trigger.kind != 'cron') return
      if (!dequal(trigger.cronTimes, settings.schedule)) {
        operations.push({ before: trigger.cronTimes, kind: 'graph.trigger.schedule.set', nodeId, value: settings.schedule })
      }
      break
    case 'poll':
      if (trigger.kind != 'poll') return
      for (const name of new Set([...Object.keys(trigger.config), ...Object.keys(settings.config)])) {
        if (!dequal(trigger.config[name], settings.config[name])) {
          operations.push({ before: trigger.config[name], kind: 'graph.trigger.config.set', name, nodeId, value: settings.config[name] })
        }
      }
      if (!dequal(trigger.pollTimes, settings.schedule)) {
        operations.push({ before: trigger.pollTimes, kind: 'graph.trigger.schedule.set', nodeId, value: settings.schedule })
      }
      break
    case 'integration':
      if (trigger.kind != 'integration') return
      for (const name of new Set([...Object.keys(trigger.config), ...Object.keys(settings.config)])) {
        if (!dequal(trigger.config[name], settings.config[name])) {
          operations.push({ before: trigger.config[name], kind: 'graph.trigger.config.set', name, nodeId, value: settings.config[name] })
        }
      }
      break
  }
  return operations
}

export function updateTriggerConfig(
  content: RevisionContent,
  _target: { readonly kind: 'flow' },
  nodeId: string,
  name: string,
  value: JsonValue | undefined,
): readonly ChangeOperation[] | undefined {
  const trigger = content.document.graph.nodes[nodeId]
  if (trigger == null || (trigger.kind != 'integration' && trigger.kind != 'poll')) return
  if (dequal(trigger.config[name], value)) return []
  return [{ before: trigger.config[name], kind: 'graph.trigger.config.set', name, nodeId, value }]
}

export function updateTriggerSchedule(
  content: RevisionContent,
  _target: { readonly kind: 'flow' },
  nodeId: string,
  schedule: readonly TriggerSchedule[],
): readonly ChangeOperation[] | undefined {
  const trigger = content.document.graph.nodes[nodeId]
  if (trigger == null) return
  switch (trigger.kind) {
    case 'cron':
      return dequal(trigger.cronTimes, schedule) ? [] : [{ before: trigger.cronTimes, kind: 'graph.trigger.schedule.set', nodeId, value: schedule }]
    case 'poll':
      return dequal(trigger.pollTimes, schedule) ? [] : [{ before: trigger.pollTimes, kind: 'graph.trigger.schedule.set', nodeId, value: schedule }]
    case 'integration':
    case 'webhook':
      return
    default:
      return
  }
}

export function setTriggerConnection(
  content: RevisionContent,
  _target: { readonly kind: 'flow' },
  nodeId: string,
  connectionId: string,
): readonly ChangeOperation[] | undefined {
  const trigger = content.document.graph.nodes[nodeId]
  if (trigger == null || (trigger.kind != 'poll' && trigger.kind != 'integration')) return
  const binding = content.document.bindings[trigger.bindingId]
  if (binding == null) return [{ binding: { kind: 'connection', target: connectionId }, bindingId: trigger.bindingId, kind: 'binding.create' }]
  if (binding.kind != 'connection') return
  if (binding.target == connectionId) return []
  return [{ before: binding.target, bindingId: trigger.bindingId, kind: 'binding.target.set', value: connectionId }]
}

function graph(content: RevisionContent, target: GraphTarget) {
  return target.kind == 'flow' ? content.document.graph : content.document.subflows[target.id]?.graph
}

function defaultInputs(ports: TaskDefinition['inputs']): Readonly<Record<string, InputMapping>> {
  return Object.fromEntries(
    ports.flatMap((port) =>
      'handle' in port && Object.hasOwn(port, 'value') ? [[port.handle, { kind: 'value' as const, value: port.value as JsonValue }]] : [],
    ),
  )
}

function llmInputValue(values: LlmTaskOptions['inputs'], handle: LlmInputHandle, fallback: JsonValue): JsonValue {
  return values != null && Object.hasOwn(values, handle) ? values[handle]! : fallback
}
