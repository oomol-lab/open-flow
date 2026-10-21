import type { DecisionQuestion } from '../../decision/common/decision.ts'
import type {
  ChangeOperation,
  CodeModule,
  ConnectorCapability,
  Graph,
  Group,
  GraphNode,
  InputMapping,
  InputValues,
  InputPort,
  JsonValue,
  Port,
  PortDefinition,
  RetryConfiguration,
  RevisionContent,
  TaskDefinition,
  TriggerKeySnapshot,
  TriggerNode,
  TriggerSchedule,
  WebhookOptions,
} from './change.ts'

import { dequal } from 'dequal/lite'
import { decisionTask } from '../../decision/common/decision.ts'
import { isTriggerNode, applyFlowChanges, nextNodeName, normalizeNodeName } from './change.ts'
import { codeSharedPermissionsEnabled } from './codePermissions.ts'
import { nodeInputMappings } from './condition.ts'
import { fixedInputValue, inputValues } from './inputValue.ts'
import { remapInputMappings, renamedPort, renameOutputMapping } from './portChanges.ts'

const codeTaskTemplate = `export default async function (inputs, context) {
  return { result: inputs.value }
}
`
export const defaultCodeTaskPorts: Pick<Extract<TaskDefinition, { readonly moduleId: string }>, 'inputs' | 'outputs' | 'capabilities'> = {
  inputs: [{ handle: 'value', jsonSchema: { type: 'string' }, nullable: true, value: 'foo' }],
  outputs: [{ handle: 'result', jsonSchema: {}, nullable: true }],
}

export interface Settings {
  readonly name?: string
  readonly maxExecutions?: number
  readonly timeoutMs?: number
  readonly onError?: 'stop' | 'error'
  readonly retry?: RetryConfiguration
}

export interface LlmTaskOptions {
  readonly inputs?: Readonly<Partial<Record<LlmInputHandle, JsonValue>>>
  readonly output?: PortDefinition
}

export type LlmInputHandle = 'input' | 'messages' | 'model' | 'template'

export function defaultNodeName(_content: RevisionContent, node: GraphNode): string {
  switch (node.kind) {
    case 'outputs':
      return 'Workflow Outputs'
    case 'condition':
      return 'Condition'
    case 'value':
      return 'Fixed Values'
    case 'approval':
      return 'Approval'
    case 'wait':
      return 'Wait'
    case 'task':
      return normalizeNodeName(node.task.name) || 'Task'
    case 'error':
      return 'Flow Error'
    case 'manual':
      return 'Manual Trigger'
    case 'start':
      return 'Start'
    case 'webhook':
      return 'Webhook'
    case 'cron':
      return 'Scheduled Trigger'
    case 'integration':
    case 'poll':
      return normalizeNodeName(node.definition.displayName) || 'Trigger'
  }
}

const legacyManualNames = new Set([
  'Manual trigger',
  'Manual Trigger',
  '手动触发',
  '手動觸發',
  '手動トリガー',
  'Déclencheur manuel',
  '수동 트리거',
  'Ручной триггер',
])

function graphNameRepairs(content: RevisionContent, targetGraph: Graph, startName: string | undefined): readonly ChangeOperation[] {
  const names = new Set<string>()
  const changed: { readonly nodeId: string; readonly node: GraphNode; readonly name: string }[] = []
  for (const [nodeId, node] of Object.entries(targetGraph.nodes)) {
    const previousName = normalizeNodeName(node.name ?? '')
    const requested =
      node.kind == 'start' && legacyManualNames.has(previousName)
        ? nextNodeName(
            startName ?? defaultNodeName(content, node),
            Object.entries(targetGraph.nodes)
              .filter(([id]) => id != nodeId)
              .map(([, other]) => other.name ?? ''),
          )
        : previousName || defaultNodeName(content, node)
    const name = nextNodeName(requested, names)
    names.add(name)
    if (node.name != name) changed.push({ name, node, nodeId })
  }
  return changed.toReversed().map(({ name, node, nodeId }) => ({ before: node.name, field: 'name', kind: 'graph.node.field.set', nodeId, value: name }))
}

export function repairNodeNames(content: RevisionContent, defaults: { readonly start?: string } = {}): readonly ChangeOperation[] {
  return graphNameRepairs(content, content.document.graph, defaults.start)
}

interface TriggerSettingsBase {
  readonly description?: string
  readonly name: string
}

export type TriggerSettings =
  | (TriggerSettingsBase & { readonly kind: 'manual' })
  | (TriggerSettingsBase & { readonly kind: 'start' })
  | (TriggerSettingsBase & { readonly kind: 'error' })
  | (TriggerSettingsBase & {
      readonly bodyFields: Extract<TriggerNode, { readonly kind: 'webhook' }>['bodyFields']
      readonly kind: 'webhook'
      readonly method: Extract<TriggerNode, { readonly kind: 'webhook' }>['method']
      readonly options: WebhookOptions
    })
  | (TriggerSettingsBase & { readonly kind: 'cron'; readonly schedule: readonly TriggerSchedule[] })
  | (TriggerSettingsBase & {
      readonly config: InputValues
      readonly kind: 'poll'
      readonly schedule: readonly TriggerSchedule[]
    })
  | (TriggerSettingsBase & { readonly config: InputValues; readonly kind: 'integration' })

export function createCodeTask(
  identity: { readonly moduleId: string; readonly nodeId: string },
  name: string,
  module: Pick<CodeModule, 'imports' | 'source'> | undefined = undefined,
  ports: Pick<Extract<TaskDefinition, { readonly moduleId: string }>, 'inputs' | 'outputs' | 'capabilities'> = defaultCodeTaskPorts,
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
        inputs: defaultInputs(ports.inputs),
        kind: 'task',
        name,
        task: {
          capabilities: ports.capabilities ?? [
            codeSharedPermissionsEnabled ? { kind: 'connector', mode: 'shared' } : { kind: 'connector', mode: 'independent', actions: [] },
          ],
          inputs: ports.inputs,
          moduleId: identity.moduleId,
          name,
          outputs: ports.outputs,
        },
      },
      nodeId: identity.nodeId,
    },
  ]
}

export function createManagedTask(
  identity: { readonly nodeId: string },
  task: Extract<TaskDefinition, { readonly executor: unknown }>,
): readonly ChangeOperation[] {
  return [
    {
      kind: 'graph.node.create',
      node: {
        inputs: defaultInputs(task.inputs),
        kind: 'task',
        name: task.name,
        task,
      },
      nodeId: identity.nodeId,
    },
  ]
}

export function createAgentTask(
  identity: { readonly nodeId: string },
  name: string,
  defaults: { readonly prompt?: string; readonly outputDescription?: string; readonly inputs?: TaskDefinition['inputs'] } = {},
): readonly ChangeOperation[] {
  return createManagedTask(identity, {
    name,
    inputs: defaults.inputs ?? [{ handle: 'input', jsonSchema: { type: 'string' }, nullable: false, value: '' }],
    outputs: [
      {
        handle: 'output',
        jsonSchema: { type: 'string' },
        nullable: false,
        description: defaults.outputDescription ?? 'The final result produced by the Agent.',
      },
    ],
    executor: {
      kind: 'agent',
      model: 'deepseek-v4-flash',
      prompt: defaults.prompt ?? 'Summarize the following content, highlighting key points and next steps.\n\n{{input}}',
      maxRounds: 10,
      tools: [],
    },
  })
}

export function createLlmTask(
  identity: { readonly nodeId: string },
  name: string,
  mode: 'chat' | 'json',
  outputDescription: string,
  options: LlmTaskOptions = {},
): readonly ChangeOperation[] {
  const values = options.inputs ?? {}
  return createManagedTask(identity, {
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

export function createCondition(nodeId: string, name: string): readonly ChangeOperation[] {
  return [
    {
      kind: 'graph.node.create',
      node: {
        cases: [{ groups: [{ expressions: [{ left: { kind: 'value' }, operator: '==', right: { kind: 'value' } }] }], output: 'case' }],
        matchMode: 'first',
        inputs: {},
        kind: 'condition',
        name,
      },
      nodeId,
    },
  ]
}

export function createValue(
  nodeId: string,
  name: string,
  values: readonly InputPort[] = [{ handle: 'value', jsonSchema: {}, nullable: true, value: null }],
): readonly ChangeOperation[] {
  return [
    {
      kind: 'graph.node.create',
      node: { inputs: {}, kind: 'value', name, values },
      nodeId,
    },
  ]
}

export function createWait(nodeId: string, name: string): readonly ChangeOperation[] {
  return [
    {
      kind: 'graph.node.create',
      node: {
        inputDefinitions: [],
        inputs: {},
        kind: 'wait',
        name,
        prompt: name,
      },
      nodeId,
    },
  ]
}

export function createApproval(nodeId: string, name: string): readonly ChangeOperation[] {
  return [
    {
      kind: 'graph.node.create',
      node: {
        inputDefinitions: [],
        inputs: {},
        kind: 'approval',
        name,
        prompt: name,
      },
      nodeId,
    },
  ]
}

export function createBuiltinTrigger(
  nodeId: string,
  node: Extract<TriggerNode, { readonly kind: 'error' | 'cron' | 'manual' | 'start' | 'webhook' }>,
): readonly ChangeOperation[] {
  return [{ kind: 'graph.node.create', node, nodeId }]
}

export function createProviderTrigger(
  nodeId: string,
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
          ...(options.connectionId == null ? {} : { connectionId: options.connectionId }),
          config: inputValues(options.config),
          definition,
          kind: 'poll',
          name,
          pollTimes: options.schedule ?? [{ type: 'every', unit: 'minute', value: 5 }],
        }
      : {
          ...(options.connectionId == null ? {} : { connectionId: options.connectionId }),
          config: inputValues(options.config),
          definition,
          kind: 'integration',
          name,
        }
  return [{ kind: 'graph.node.create', node, nodeId }]
}

export function deleteNodes(content: RevisionContent, nodeIds: readonly string[]): readonly ChangeOperation[] {
  const nodes = content.document.graph?.nodes
  if (nodes == null) return []
  const operations: ChangeOperation[] = nodeIds.flatMap((nodeId) => {
    const node = nodes[nodeId]
    if (node == null) return []
    return [
      { kind: 'graph.node.delete' as const, nodeId },
      ...(node.kind == 'task' && 'moduleId' in node.task ? [{ kind: 'module.delete' as const, moduleId: node.task.moduleId }] : []),
    ]
  })
  return cleanVariableBindings(content, operations)
}

export function updateSettings(content: RevisionContent, nodeId: string, settings: Settings): readonly ChangeOperation[] | undefined {
  const node = content.document.graph?.nodes[nodeId]
  if (node == null || isTriggerNode(node)) return
  const operations: ChangeOperation[] = []

  if (node.name != settings.name) operations.push({ before: node.name, field: 'name', kind: 'graph.node.field.set', nodeId, value: settings.name })
  if (node.maxExecutions != settings.maxExecutions) {
    operations.push({ before: node.maxExecutions, field: 'maxExecutions', kind: 'graph.node.field.set', nodeId, value: settings.maxExecutions })
  }
  if (node.timeoutMs != settings.timeoutMs) {
    operations.push({ before: node.timeoutMs, field: 'timeoutMs', kind: 'graph.node.field.set', nodeId, value: settings.timeoutMs })
  }
  if (Object.hasOwn(settings, 'onError') && node.onError != settings.onError)
    operations.push({ before: node.onError, field: 'onError', kind: 'graph.node.field.set', nodeId, value: settings.onError })
  if (Object.hasOwn(settings, 'retry') && !dequal(node.retry, settings.retry)) {
    operations.push({ before: node.retry, field: 'retry', kind: 'graph.node.field.set', nodeId, value: settings.retry })
  }
  return operations
}

export function setInputValue(content: RevisionContent, nodeId: string, handle: string, value: JsonValue | undefined): readonly ChangeOperation[] | undefined {
  return setInputValues(content, nodeId, { [handle]: value })
}

export function setInputValues(
  content: RevisionContent,
  nodeId: string,
  values: Readonly<Record<string, JsonValue | undefined>>,
): readonly ChangeOperation[] | undefined {
  const node = content.document.graph?.nodes[nodeId]
  if (node == null || isTriggerNode(node)) return
  const operations: ChangeOperation[] = []
  for (const [handle, value] of Object.entries(values)) {
    const before = nodeInputMappings(node)[handle]
    const next = fixedInputValue(value)
    if (dequal(before, next)) continue
    operations.push({ before, handle, kind: 'graph.node.input.set', nodeId, value: next })
  }
  return cleanVariableBindings(content, operations)
}

/** Restore inheritance for this form in one undoable change. */
export function resetInputValues(content: RevisionContent, nodeId: string, handles: readonly string[]): readonly ChangeOperation[] {
  const node = content.document.graph?.nodes[nodeId]
  if (node == null || isTriggerNode(node)) return []
  const mappings = nodeInputMappings(node)
  return cleanVariableBindings(
    content,
    [...new Set(handles)].flatMap((handle): ChangeOperation[] =>
      mappings[handle] == null ? [] : [{ kind: 'graph.node.input.set', nodeId, handle, before: mappings[handle], value: undefined }],
    ),
  )
}

export function setInputSources(
  content: RevisionContent,
  nodeId: string,
  handle: string,
  sources: Extract<InputMapping, { readonly kind: 'sources' }>['sources'],
): readonly ChangeOperation[] {
  const node = content.document.graph?.nodes[nodeId]
  if (node == null || isTriggerNode(node)) return []
  return cleanVariableBindings(content, [
    { kind: 'graph.node.input.set', nodeId, handle, before: nodeInputMappings(node)[handle], value: { kind: 'sources', sources } },
  ])
}

export function setInputVariable(
  content: RevisionContent,
  nodeId: string,
  handle: string,
  name: string,
  bindingId: string,
): readonly ChangeOperation[] | undefined {
  const node = content.document.graph?.nodes[nodeId]
  if (node == null || isTriggerNode(node)) return
  const mapping = nodeInputMappings(node)[handle]
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
    ...cleanVariableBindings(content, [{ before: mapping, handle, kind: 'graph.node.input.set', nodeId, value: next }]),
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
  for (const node of Object.values(document.graph.nodes)) {
    if (isTriggerNode(node)) continue
    const inputs = Object.values(nodeInputMappings(node))
    for (const mapping of inputs) {
      if (mapping.kind != 'sources') continue
      for (const source of mapping.sources) if (source.kind == 'binding') add(source.bindingId)
    }
  }
  return references
}

export function setConnectorConnection(content: RevisionContent, nodeId: string, connectionId: string | undefined): readonly ChangeOperation[] | undefined {
  const node = content.document.graph.nodes[nodeId]
  if (node?.kind != 'task' || !('executor' in node.task) || node.task.executor.kind != 'connector') return
  const task = node.task
  if (task.executor.kind != 'connector') return
  if (task.executor.connectionId == connectionId) return []
  const { connectionId: _, ...executor } = task.executor
  return [
    {
      before: task,
      kind: 'graph.node.task.set',
      nodeId,
      value: { ...task, executor: { ...executor, ...(connectionId == null ? {} : { connectionId }) } },
    },
  ]
}

/** Update one service’s unresolved or explicitly deferred references as one undoable edit. */
export function setServiceConnections(
  content: RevisionContent,
  providerId: string,
  connectionId: string | undefined,
  previousConnectionId?: '',
): readonly ChangeOperation[] {
  const operations: ChangeOperation[] = []
  const assign = <T extends { readonly action: string; readonly connectionId?: string }>(value: T): T => {
    if (value.connectionId !== previousConnectionId || value.action.split('.')[0] != providerId) return value
    const { connectionId: _, ...rest } = value
    return { ...rest, ...(connectionId == null ? {} : { connectionId }) } as T
  }
  for (const [nodeId, node] of Object.entries(content.document.graph.nodes)) {
    if (
      (node.kind == 'poll' || node.kind == 'integration') &&
      node.definition.provider == providerId &&
      previousConnectionId == null &&
      node.connectionId == null &&
      connectionId !== ''
    ) {
      operations.push(...(setTriggerConnection(content, nodeId, connectionId) ?? []))
    }
    if (node.kind != 'task') continue
    const task = node.task
    if ('moduleId' in task) {
      const capabilities = task.capabilities?.map((capability) =>
        'mode' in capability && capability.mode == 'independent' ? { ...capability, actions: capability.actions.map(assign) } : capability,
      )
      if (capabilities != null) operations.push(...(setCodeActions(content, nodeId, capabilities) ?? []))
    } else if (task.executor.kind == 'connector') {
      if (assign(task.executor) !== task.executor) operations.push(...(setConnectorConnection(content, nodeId, connectionId) ?? []))
    } else if (task.executor.kind == 'agent') {
      const executor = {
        ...task.executor,
        tools: task.executor.tools.map(assign),
        ...(task.executor.notification == null ? {} : { notification: assign(task.executor.notification) }),
      }
      if (!dequal(executor, task.executor)) operations.push({ kind: 'graph.node.task.set', nodeId, before: task, value: { ...task, executor } })
    }
  }
  return operations
}

/** Edit the workflow input contract and preserve references on a single-field rename. */
export function updateStartInputDefs(content: RevisionContent, nodeId: string, value: readonly Port[]): readonly ChangeOperation[] {
  const node = content.document.graph.nodes[nodeId]
  if (node?.kind != 'start') throw new TypeError('Expected a Start node.')
  const previous = node.inputDefs
  if (dequal(previous, value)) return []
  const operations: ChangeOperation[] = [{ kind: 'graph.node.replace', nodeId, before: node, node: { ...node, inputDefs: value } }]
  const rename = renamedPort(previous, value)
  if (rename != null) {
    const instances = new Set([nodeId])
    for (const [id, downstream] of Object.entries(content.document.graph.nodes)) {
      if (isTriggerNode(downstream)) continue
      for (const [handle, before] of Object.entries(nodeInputMappings(downstream))) {
        const mapping = renameOutputMapping(before, instances, rename)
        if (before !== mapping) operations.push({ before, kind: 'graph.node.input.set', nodeId: id, handle, value: mapping })
      }
    }
  }
  return operations
}

export function updateTrigger(content: RevisionContent, nodeId: string, settings: TriggerSettings): readonly ChangeOperation[] | undefined {
  const trigger = content.document.graph.nodes[nodeId]
  if (trigger == null) return
  const operations: ChangeOperation[] = []
  if (trigger.name != settings.name) {
    operations.push({ before: trigger.name, field: 'name', kind: 'graph.node.field.set', nodeId, value: settings.name })
  }
  if (trigger.description != settings.description) {
    operations.push({ before: trigger.description, field: 'description', kind: 'graph.node.field.set', nodeId, value: settings.description })
  }
  switch (settings.kind) {
    case 'start':
    case 'error':
    case 'manual':
      if (trigger.kind != settings.kind) return
      break
    case 'webhook': {
      if (trigger.kind != 'webhook') return
      const value = {
        bodyFields: settings.bodyFields,
        method: settings.method,
        options: Object.keys(settings.options).length == 0 ? undefined : settings.options,
      }
      const before = { bodyFields: trigger.bodyFields, method: trigger.method, options: trigger.options }
      if (!dequal(before, value)) operations.push({ before, kind: 'graph.node.webhook.set', nodeId, value })
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
  nodeId: string,
  name: string,
  value: JsonValue | undefined,
): readonly ChangeOperation[] | undefined {
  const trigger = content.document.graph.nodes[nodeId]
  if (trigger == null || (trigger.kind != 'integration' && trigger.kind != 'poll')) return
  const next = fixedInputValue(value)
  if (dequal(trigger.config[name], next)) return []
  return [{ before: trigger.config[name], kind: 'graph.trigger.config.set', name, nodeId, value: next }]
}

export function updateTriggerSchedule(content: RevisionContent, nodeId: string, schedule: readonly TriggerSchedule[]): readonly ChangeOperation[] | undefined {
  const trigger = content.document.graph.nodes[nodeId]
  if (trigger == null) return
  switch (trigger.kind) {
    case 'cron':
      return dequal(trigger.cronTimes, schedule) ? [] : [{ before: trigger.cronTimes, kind: 'graph.trigger.schedule.set', nodeId, value: schedule }]
    case 'poll':
      return dequal(trigger.pollTimes, schedule) ? [] : [{ before: trigger.pollTimes, kind: 'graph.trigger.schedule.set', nodeId, value: schedule }]
    case 'integration':
    case 'manual':
    case 'webhook':
      return
    default:
      return
  }
}

export function setTriggerConnection(content: RevisionContent, nodeId: string, connectionId: string | undefined): readonly ChangeOperation[] | undefined {
  const trigger = content.document.graph.nodes[nodeId]
  if (trigger == null || (trigger.kind != 'poll' && trigger.kind != 'integration')) return
  if (trigger.connectionId == connectionId) return []
  return [{ before: trigger.connectionId, kind: 'graph.node.field.set', field: 'connectionId', nodeId, value: connectionId }]
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

export function setCodeActions(content: RevisionContent, nodeId: string, capabilities: readonly ConnectorCapability[]): readonly ChangeOperation[] | undefined {
  const selected = content.document.graph
  const node = selected?.nodes[nodeId]
  if (node?.kind != 'task' || !('moduleId' in node.task) || dequal(node.task.capabilities ?? [], capabilities)) return
  return [{ kind: 'graph.node.task.capabilities.set', nodeId, before: node.task.capabilities, value: capabilities }]
}

export function createDecisionTask(
  identity: { readonly nodeId: string },
  name = 'AI Decision',
  questions?: readonly DecisionQuestion[],
): readonly ChangeOperation[] {
  return createManagedTask(identity, decisionTask(questions, name))
}

/** Edit an Outputs node's definitions and mappings as one undoable change. */
export function updateOutputsDefs(
  content: RevisionContent,
  nodeId: string,
  value: readonly Port[],
  outputMappings?: Readonly<Record<string, InputMapping>>,
): readonly ChangeOperation[] {
  const node = content.document.graph.nodes[nodeId]
  if (node?.kind != 'outputs') throw new TypeError('Expected an Outputs node.')
  const rename = renamedPort(node.outputDefs, value)
  const mappings = outputMappings ?? remapInputMappings(node.outputMappings, value, rename)
  const next = { ...node, outputDefs: value, outputMappings: mappings }
  if (dequal(node, next)) return []
  const changes: ChangeOperation[] = [{ kind: 'graph.node.replace', nodeId, before: node, node: next }]
  if (rename != null) {
    for (const [id, trigger] of Object.entries(content.document.graph.nodes)) {
      if (trigger.kind != 'webhook' || trigger.options?.responseBody?.output !== rename[0]) continue
      changes.push({
        kind: 'graph.node.replace',
        nodeId: id,
        before: trigger,
        node: {
          ...trigger,
          options: { ...trigger.options, responseBody: { ...trigger.options.responseBody, output: rename[1] } },
        },
      })
    }
  }
  return cleanVariableBindings(content, changes)
}

export function renameFlowOutputSources(
  content: RevisionContent,
  nodeIds: ReadonlySet<string>,
  previous: readonly (Port | Group)[],
  next: readonly (Port | Group)[],
): readonly ChangeOperation[] {
  const rename = renamedPort(previous, next)
  if (rename == null) return []
  return Object.entries(content.document.graph.nodes).flatMap(([nodeId, node]): ChangeOperation[] => {
    if (node.kind != 'outputs') return []
    const outputMappings = Object.fromEntries(
      Object.entries(node.outputMappings).map(([name, mapping]) => [name, renameOutputMapping(mapping, nodeIds, rename)]),
    )
    return dequal(node.outputMappings, outputMappings) ? [] : [{ kind: 'graph.node.replace', nodeId, before: node, node: { ...node, outputMappings } }]
  })
}
