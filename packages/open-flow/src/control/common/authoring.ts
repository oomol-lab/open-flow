import type {
  ChangeOperation,
  GraphNode,
  InputMapping,
  InputPort,
  JsonValue,
  ManagedTaskDefinition,
  RevisionContent,
  TriggerKeySnapshot,
} from '../../flow/common/change.ts'
import type { ConnectorAction, Diagnostic } from './api.ts'
import type { AuthoringConditionConfiguration, AuthoringConditionSource } from './authoringCondition.ts'
import type { AuthoringOpenApiConfig } from './authoringOpenApi.ts'
import type { AuthoringRead, AuthoringRequest, AuthoringSearch, AuthoringSource, AuthoringType } from './authoringSchema.ts'
import type { AuthoringAgentTool } from './authoringTools.ts'

import { dequal } from 'dequal/lite'
import { decisionTask } from '../../decision/common/decision.ts'
import { applyFlowChanges, decodeChangeOperations } from '../../flow/common/change.ts'
import { nodeInputMappings } from '../../flow/common/condition.ts'
import { nodeInputPorts, nodeOutputPorts } from '../../flow/common/graph.ts'
import { imports as moduleImports } from '../../flow/common/moduleChanges.ts'
import {
  createAgentTask,
  createCodeTask,
  defaultCodeTaskPorts,
  createCondition,
  createDecisionTask,
  createLlmTask,
  createManagedTask,
  createProviderTrigger,
  createValue,
  createWait,
  createApproval,
  cleanVariableBindings,
} from '../../flow/common/nodeChanges.ts'
import { conditionConfigurationView, prepareConditionConfiguration } from './authoringCondition.ts'
import { authoringDiagnosticField } from './authoringDiagnosticFields.ts'
import { fieldsView, fieldsToPorts } from './authoringFields.ts'
import { llmConfigurationView, prepareLlmConfiguration, initialAuthoringLlmTask } from './authoringLlm.ts'
import { AuthoringOpenApiAuthenticationError, openApiConfigView, openApiAuthenticationChoices, prepareOpenApiTask } from './authoringOpenApi.ts'
import { authoringConfigurations, authoringReadSchema, authoringRequestSchema, authoringSearchSchema } from './authoringSchema.ts'
import { AuthoringToolInputError, outwardAgentTools, prepareAgentTools } from './authoringTools.ts'
export * from './authoringSchema.ts'

const record = (value: unknown): Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
export class AuthoringError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.code = code
    this.details = details
    this.name = 'AuthoringError'
  }
}
function fail(code: string, message: string, details: Record<string, unknown> = {}): never {
  throw new AuthoringError(code, message, details)
}
function nodeAt(content: RevisionContent, ref: string): GraphNode {
  return (
    (Object.hasOwn(content.document.graph.nodes, ref) ? content.document.graph.nodes[ref] : undefined) ??
    fail('node.not-found', `Node ${JSON.stringify(ref)} does not exist.`, { node: ref })
  )
}
function taskAt(node: GraphNode) {
  return node.kind == 'task' ? node.task : undefined
}
const llmReservedInputs = ['model', 'template', 'messages']
function inputDefinitions(node: GraphNode) {
  if (node.kind == 'condition') return {}
  if (node.kind == 'poll' || node.kind == 'integration')
    return Object.fromEntries(node.definition.configInputs.flatMap((port) => ('handle' in port ? [[port.handle, port]] : [])))
  return nodeInputPorts(node)
}
function inputMappings(node: GraphNode) {
  return node.kind == 'condition' ? {} : node.kind == 'poll' || node.kind == 'integration' ? node.config : nodeInputMappings(node)
}
function typeOf(node: GraphNode): AuthoringType {
  const task = taskAt(node)
  return node.kind != 'task' ? node.kind : task != null && 'executor' in task ? task.executor.kind : 'code'
}
function outwardSource(content: RevisionContent, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => outwardSource(content, v))
  if (value == null || typeof value != 'object') return value
  const v = record(value)
  if (v.kind == 'node' && typeof v.nodeId == 'string' && typeof v.output == 'string')
    return { kind: 'output', node: v.nodeId, port: v.output, ...(v.field == null ? {} : { field: v.field }) }
  if (v.kind == 'binding' && typeof v.bindingId == 'string')
    return { kind: 'variable', name: content.document.bindings[v.bindingId]?.target ?? '[missing variable]' }
  // Literal JSON is user data, including objects that resemble references.
  if (v.kind == 'value') return value
  return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, outwardSource(content, item)]))
}
function authoringEdges(edges: RevisionContent['document']['graph']['edges']) {
  return edges.map((edge) =>
    edge.sourceHandle == null ? { source: edge.source, target: edge.target } : { source: edge.source, target: edge.target, branch: edge.sourceHandle },
  )
}
export function authoringNode(content: RevisionContent, ref: string) {
  const node = nodeAt(content, ref),
    type = typeOf(node),
    task = taskAt(node)
  let config: Record<string, unknown> = {}
  const texts: Record<string, string> = {}
  if (task != null && 'executor' in task) {
    const { kind: _, ...executor } = task.executor
    config = { ...executor }
    if (task.executor.kind == 'agent') {
      const { prompt, tools, notification, ...rest } = task.executor
      const { kind: _agentKind, ...settings } = rest
      config = {
        ...settings,
        inputs: fieldsView([...task.inputs, ...(node.kind == 'task' ? (node.additionalInputs ?? []) : [])]),
        resultSchema: task.outputs.find((port) => 'handle' in port)?.jsonSchema ?? { type: 'string' },
        tools: outwardAgentTools(tools),
      }
      texts.prompt = prompt
      if (notification != null) {
        const { inputDefinitions: _definitions, ...noticeSettings } = notification
        config.notification = noticeSettings
      }
    } else if (task.executor.kind == 'llm')
      config = {
        ...llmConfigurationView(task),
        inputs: fieldsView(
          [...task.inputs, ...(node.kind == 'task' ? (node.additionalInputs ?? []) : [])].filter(
            (port) => !('handle' in port) || !llmReservedInputs.includes(port.handle),
          ),
        ),
      }
    else if (task.executor.kind == 'openapi') {
      config = { ...openApiConfigView(task.executor) }
    }
  } else if (node.kind == 'task' && 'moduleId' in node.task) {
    config = {
      inputs: fieldsView([...node.task.inputs, ...(node.additionalInputs ?? [])]),
      outputs: fieldsView(node.task.outputs),
      ...(node.task.capabilities == null ? {} : { capabilities: node.task.capabilities }),
    }
    texts.code = content.modules[node.task.moduleId]?.source ?? ''
  } else {
    switch (node.kind) {
      case 'condition':
        config = { ...conditionConfigurationView(node, (value) => outwardSource(content, value) as AuthoringConditionSource) }
        break
      case 'value':
        config = {
          values: Object.fromEntries(node.values.filter((port) => Object.hasOwn(port, 'value')).map((port) => [port.handle, port.value])),
          outputs: fieldsView(node.values.map(({ value: _value, ...port }) => port)),
        }
        break
      case 'wait':
      case 'approval':
        config = { inputs: fieldsView(node.inputDefinitions) }
        texts.prompt = node.prompt
        break
      case 'webhook':
        config = { body: fieldsView(node.bodyFields), method: node.method, ...(node.options == null ? {} : { options: node.options }) }
        break
      case 'cron':
        config = { schedule: node.cronTimes }
        break
      case 'error':
        config = node.sourceFlowIds == null ? {} : { sourceFlowIds: node.sourceFlowIds }
        break
      case 'poll':
      case 'integration':
        config = {
          key: node.definition.key,
          ...(node.connectionId == null ? {} : { connectionId: node.connectionId }),
          ...(node.kind == 'poll' ? { schedule: node.pollTimes } : {}),
        }
        break
    }
  }
  const edges = authoringEdges(content.document.graph.edges)
  return {
    ref,
    type,
    name: node.name ?? ref,
    readOnly: false,
    ...(node.description == null ? {} : { description: node.description }),
    ...(node.icon == null ? {} : { icon: node.icon }),
    ...('timeoutMs' in node && node.timeoutMs != null ? { timeoutMs: node.timeoutMs } : {}),
    ...('maxExecutions' in node && node.maxExecutions != null ? { maxExecutions: node.maxExecutions } : {}),
    config: json(config),
    texts: Object.fromEntries(Object.entries(texts).map(([field, text]) => [field, { lines: text.split('\n').length, characters: text.length }])),
    inputs: outwardSource(content, inputMappings(node)),
    inputPorts: fieldsView(Object.entries(inputDefinitions(node)).map(([handle, port]) => Object.assign({}, port, { handle }))),
    outputPorts: fieldsView(Object.entries(nodeOutputPorts(node)).map(([handle, port]) => Object.assign({}, port, { handle }))),
    ...(task != null && 'executor' in task && task.executor.kind == 'openapi' ? { authenticationChoices: openApiAuthenticationChoices(task.executor) } : {}),
    incoming: edges.filter((e) => e.target == ref),
    outgoing: edges.filter((e) => e.source == ref),
  }
}
function textAt(content: RevisionContent, node: GraphNode, field: 'code' | 'prompt'): string {
  if (field == 'code' && node.kind == 'task' && 'moduleId' in node.task)
    return content.modules[node.task.moduleId]?.source ?? fail('text.missing', 'Node source is missing.')
  const task = taskAt(node)
  if (field == 'prompt' && task != null && 'executor' in task && task.executor.kind == 'agent') return task.executor.prompt
  if (field == 'prompt' && (node.kind == 'wait' || node.kind == 'approval')) return node.prompt
  return fail('text.unsupported', `This node has no ${field} field.`)
}
export function readAuthoring(content: RevisionContent, query: AuthoringRead = {}) {
  const q = authoringReadSchema.parse(query)
  if (q.text != null) {
    const node = nodeAt(content, q.text.node),
      source = textAt(content, node, q.text.field),
      lines = source.split('\n')
    const selected = lines.slice(q.text.start - 1, q.text.start - 1 + q.text.lines)
    // Bound by characters as well as lines; never present a partial line as complete.
    let count = 0,
      characters = 0
    for (const line of selected) {
      if (characters + line.length + 1 > 24000) break
      characters += line.length + 1
      count++
    }
    if (count == 0 && selected.length > 0)
      fail('text.line-too-large', 'Selected line exceeds 24000 characters; use search to locate a smaller edit.', { node: q.text.node, field: q.text.field })
    const end = q.text.start - 1 + count
    return {
      text: {
        ...q.text,
        content: selected.slice(0, count).join('\n'),
        totalLines: lines.length,
        ...(end < lines.length ? { nextStart: end + 1 } : {}),
        truncated: end < lines.length,
      },
    }
  }
  if (q.nodes != null) return { nodes: q.nodes.map((ref) => authoringNode(content, ref)) }
  return {
    nodes: Object.keys(content.document.graph.nodes).map((ref) => {
      const node = authoringNode(content, ref)
      return {
        ref,
        type: node.type,
        name: node.name,
        readOnly: node.readOnly,
        inputHandles: Object.keys(node.inputPorts),
        outputHandles: Object.keys(node.outputPorts),
        inputs: compactValue(node.inputs),
        texts: node.texts,
      }
    }),
    edges: authoringEdges(content.document.graph.edges),
  }
}
function compactValue(value: unknown, depth = 0): unknown {
  if (depth >= 4 && value != null && typeof value == 'object') return { truncated: true }
  if (typeof value == 'string') return value.length > 160 ? { preview: value.slice(0, 160), truncated: true } : value
  if (Array.isArray(value))
    return value.length > 8
      ? { preview: value.slice(0, 8).map((v) => compactValue(v, depth + 1)), truncated: true }
      : value.map((v) => compactValue(v, depth + 1))
  if (value != null && typeof value == 'object')
    return Object.fromEntries([
      ...Object.entries(value)
        .slice(0, 8)
        .map(([key, v]) => [key, compactValue(v, depth + 1)]),
      ...(Object.keys(value).length > 8 ? [['truncated', true]] : []),
    ])
  return value
}
export function searchAuthoring(content: RevisionContent, query: AuthoringSearch) {
  const q = authoringSearchSchema.parse(query),
    needle = q.query.toLowerCase()
  const matches: { node: string; field: string; line?: number; excerpt: string }[] = []
  for (const [ref, node] of Object.entries(content.document.graph.nodes)) {
    const view = authoringNode(content, ref)
    if (q.type != null && q.type != view.type) continue
    const fields = {
      name: view.name,
      description: view.description ?? '',
      inputs: JSON.stringify(view.inputs),
      config: JSON.stringify(view.config),
      ...Object.fromEntries(Object.keys(view.texts).map((field) => [field, textAt(content, node, field as 'code' | 'prompt')])),
    }
    for (const [field, value] of Object.entries(fields)) {
      for (const [index, line] of value.split('\n').entries()) {
        const at = line.toLowerCase().indexOf(needle)
        if (at >= 0) matches.push({ node: ref, field, line: index + 1, excerpt: line.slice(Math.max(0, at - 100), at + Math.max(needle.length, 100)) })
      }
    }
  }
  const end = q.offset + q.limit
  return { matches: matches.slice(q.offset, end), total: matches.length, ...(end < matches.length ? { nextOffset: end } : {}) }
}

export interface AuthoringHost {
  id(label: string): string
  action(id: string): Promise<ConnectorAction>
  trigger(key: string): TriggerKeySnapshot
  openapi(url: string): Promise<JsonValue>
}
function merge(base: unknown, patch: unknown): unknown {
  if (patch == null || typeof patch != 'object' || Array.isArray(patch)) return patch
  const result = { ...record(base) }
  for (const [key, value] of Object.entries(patch)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('edit.invalid-field', `Invalid field ${key}.`)
    Object.defineProperty(result, key, { value: merge(result[key], value), enumerable: true, writable: true, configurable: true })
  }
  return result
}
function clearPath(value: Record<string, unknown>, path: readonly string[]) {
  let current = value
  for (const part of path.slice(0, -1)) {
    if (!Object.hasOwn(current, part) || Array.isArray(current[part]) || current[part] == null || typeof current[part] != 'object')
      fail('edit.invalid-field', `Cannot clear ${path.join('.')}.`)
    current = record(current[part])
  }
  const last = path.at(-1)!
  if (!Object.hasOwn(current, last)) fail('edit.invalid-field', `Cannot clear absent field ${path.join('.')}.`)
  delete current[last]
}
export async function compileAuthoring(base: RevisionContent, request: AuthoringRequest, host: AuthoringHost) {
  const parsed = authoringRequestSchema.parse(request)
  let content = base,
    index = 0,
    sequence = 0
  const operations: ChangeOperation[] = [],
    aliases: Record<string, string> = {}
  const touchedModules = new Set<string>()
  function fresh(label: string) {
    return host.id(`${index}:${label}:${sequence++}`)
  }
  function apply(changes: readonly ChangeOperation[]) {
    const checked = decodeChangeOperations(changes)
    content = applyFlowChanges(content, checked)
    operations.push(...checked)
  }
  function resolve(ref: string) {
    return ref.startsWith('$')
      ? ((Object.hasOwn(aliases, ref.slice(1)) ? aliases[ref.slice(1)] : undefined) ?? fail('node.alias-missing', `Unknown alias ${ref}.`))
      : ref
  }
  function source(
    value: Exclude<AuthoringSource, { kind: 'value' | 'default' | 'unset' | 'sources' }>,
  ): Extract<InputMapping, { kind: 'sources' }>['sources'][number] {
    if (value.kind == 'output') {
      const ref = resolve(value.node)
      const choices = Object.keys(nodeOutputPorts(nodeAt(content, ref)))
      const port = value.port ?? (choices.length == 1 ? choices[0] : undefined)
      if (port == null) fail('source.port-required', 'Choose an output name; this node does not have exactly one output.', { node: ref, choices })
      return { kind: 'node', nodeId: ref, output: port, ...(value.field == null ? {} : { field: value.field }) }
    }
    const existing = Object.entries(content.document.bindings).find(([, binding]) => binding.target == value.name)
    const bindingId = existing?.[0] ?? fresh('binding')
    if (existing == null) apply([{ kind: 'binding.create', bindingId, binding: { kind: 'variable', target: value.name } }])
    return { kind: 'binding', bindingId }
  }
  function replace(ref: string, node: GraphNode) {
    const before = nodeAt(content, ref)
    if (!dequal(before, node)) apply([{ kind: 'graph.node.replace', nodeId: ref, before, node }])
  }
  function taskNode(ref: string, task: ManagedTaskDefinition) {
    const node = nodeAt(content, ref)
    if (node.kind != 'task' || !('executor' in node.task)) fail('node.invalid-type', 'Expected a managed node.')
    replace(ref, { ...node, task })
  }

  async function connectorTask(config: Record<string, unknown>, name: string): Promise<ManagedTaskDefinition> {
    const action = await host.action(String(config.action))
    return {
      name,
      executor: { kind: 'connector', action: action.actionId, ...(config.connectionId == null ? {} : { connectionId: String(config.connectionId) }) },
      inputs: Object.entries(action.inputs).map(([handle, port]) => Object.assign({ handle }, port)),
      outputs: Object.entries(action.outputs).map(([handle, port]) => Object.assign({ handle }, port)),
    }
  }
  async function configure(ref: string, patch: Record<string, unknown> = {}, clear: readonly (readonly string[])[] = []) {
    const node = nodeAt(content, ref),
      view = authoringNode(content, ref),
      type = view.type as AuthoringType
    const original = {
      name: view.name,
      ...(view.description == null ? {} : { description: view.description }),
      ...(view.icon == null ? {} : { icon: view.icon }),
      ...(view.timeoutMs == null ? {} : { timeoutMs: view.timeoutMs }),
      ...(view.maxExecutions == null ? {} : { maxExecutions: view.maxExecutions }),
      config: view.config,
    }
    const update = record(merge(original, patch))
    const explicit = (key: string) => Object.hasOwn(record(patch.config), key) || clear.some((path) => path[0] == 'config' && path[1] == key)
    if (type == 'openapi' && Object.hasOwn(record(patch.config), 'authentication')) record(update.config).authentication = record(patch.config).authentication
    for (const path of clear) clearPath(update, path)
    if (typeof update.name != 'string') fail('node.name-required', 'Node name cannot be cleared.')
    const config = authoringConfigurations[type].parse(update.config) as Record<string, unknown>
    const { config: _, ...metadata } = update
    const { name: _name, description: _description, icon: _icon, ...rest } = node
    let next = { ...rest, ...metadata } as GraphNode
    if ('inputs' in node) {
      const clean = { ...next } as Record<string, unknown>
      if (!Object.hasOwn(update, 'timeoutMs')) delete clean.timeoutMs
      if (!Object.hasOwn(update, 'maxExecutions')) delete clean.maxExecutions
      next = clean as unknown as GraphNode
    } else if (update.timeoutMs != null || update.maxExecutions != null) fail('node.invalid-field', 'Trigger nodes do not have execution limits.')
    function taskInputs(task: ManagedTaskDefinition | NonNullable<Extract<GraphNode, { kind: 'task' }>['task']>, reserved: readonly string[] = []) {
      if (node.kind != 'task') throw new Error('Expected a task.')
      const fields = record(config.inputs)
      for (const key of reserved)
        if (Object.hasOwn(fields, key)) fail('input.reserved', `Configure ${key} through config.${key} or input.set.`, { node: ref, input: key })
      const extraNames = new Set(node.additionalInputs?.map((port) => port.handle) ?? [])
      const main = Object.fromEntries(Object.entries(fields).filter(([key]) => !extraNames.has(key)))
      for (const port of task.inputs)
        if ('handle' in port && (reserved.includes(port.handle) || (extraNames.has(port.handle) && Object.hasOwn(fields, port.handle))))
          main[port.handle] = fieldsView([port])[port.handle]
      if (node.additionalInputs != null) {
        const extra = Object.fromEntries(Object.entries(fields).filter(([key]) => extraNames.has(key)))
        for (const port of node.additionalInputs) if (reserved.includes(port.handle)) extra[port.handle] = fieldsView([port])[port.handle]
        next = { ...next, additionalInputs: fieldsToPorts(extra, node.additionalInputs) as readonly InputPort[] } as GraphNode
      }
      return fieldsToPorts(main, task.inputs)
    }
    if (node.kind == 'task' && 'moduleId' in node.task) {
      const inputs = taskInputs(node.task)
      next = {
        ...next,
        task: {
          moduleId: node.task.moduleId,
          name: String(update.name),
          ...config,
          inputs,
          outputs: fieldsToPorts(config.outputs, node.task.outputs),
        },
      } as GraphNode
    } else if (node.kind == 'task' && 'executor' in node.task) {
      const before = node.task
      let task: ManagedTaskDefinition
      if (type == 'connector') {
        task =
          config.action == (before.executor.kind == 'connector' ? before.executor.action : '')
            ? ({ ...before, name: String(update.name), executor: { kind: 'connector', ...config } } as ManagedTaskDefinition)
            : await connectorTask(config, String(update.name))
      } else if (type == 'decision') task = decisionTask(config.questions as Parameters<typeof decisionTask>[0], String(update.name))
      else if (type == 'openapi') {
        task = await prepareOpenApiTask(config as AuthoringOpenApiConfig, before, (url) => host.openapi(url), String(update.name), {
          authentication: explicit('authentication'),
          serverUrl: explicit('serverUrl'),
        })
      } else if (type == 'llm') {
        task = prepareLlmConfiguration(config, before, String(update.name))
        task = { ...task, inputs: taskInputs(task, llmReservedInputs) }
      } else {
        const { inputs: _inputs, resultSchema, notification, tools, ...executor } = config
        const prepared = { ...executor, kind: type, ...(before.executor.kind == 'agent' ? { prompt: before.executor.prompt } : {}) }
        if (type == 'agent') {
          const previous = before.executor.kind == 'agent' ? before.executor : undefined
          Object.assign(prepared, {
            tools: await prepareAgentTools(
              tools as AuthoringAgentTool[],
              previous?.tools ?? [],
              (id) => host.action(id),
              () => fresh('tool'),
            ),
          })
          Reflect.deleteProperty(prepared, 'notification')
          if (notification != null) {
            if (dequal(record(view.config).notification, notification) && previous?.notification != null)
              Object.assign(prepared, { notification: previous.notification })
            else {
              const settings = record(notification)
              const definition = await connectorTask(settings, `${update.name} notification`)
              Object.assign(prepared, {
                notification: {
                  action: settings.action,
                  ...(settings.connectionId == null ? {} : { connectionId: settings.connectionId }),
                  inputDefinitions: definition.inputs,
                  messageHandle: settings.messageHandle,
                  inputs: settings.inputs,
                },
              })
            }
          }
        }
        const outputs = dequal(record(view.config).resultSchema, resultSchema)
          ? before.outputs
          : before.outputs.map((port) => ('handle' in port ? { ...port, jsonSchema: resultSchema as JsonValue } : port))
        task = {
          name: String(update.name),
          inputs: type == 'agent' ? taskInputs(before) : before.inputs,
          outputs,
          executor: prepared,
        } as ManagedTaskDefinition
      }
      next = { ...next, task } as GraphNode
    } else
      switch (node.kind) {
        case 'condition':
          next = { ...next, ...prepareConditionConfiguration(config as unknown as AuthoringConditionConfiguration, source) } as GraphNode
          break
        case 'value': {
          const fields = { ...record(config.outputs) }
          for (const key of Object.keys(record(config.values))) if (!Object.hasOwn(fields, key)) fields[key] = {}
          const values = fieldsToPorts(
            fields,
            node.values.map(({ value: _value, ...port }) => port),
          )
            .filter((port): port is InputPort => 'handle' in port)
            .map((port) => Object.assign({}, port, Object.hasOwn(record(config.values), port.handle) ? { value: record(config.values)[port.handle] } : {}))
          next = { ...next, values } as GraphNode
          break
        }
        case 'wait':
        case 'approval':
          next = { ...next, inputDefinitions: fieldsToPorts(config.inputs, node.inputDefinitions) } as GraphNode
          break
        case 'webhook': {
          const { body, ...settings } = config
          const { options: _options, ...withoutOptions } = next as Extract<GraphNode, { kind: 'webhook' }>
          next = { ...withoutOptions, ...settings, bodyFields: fieldsToPorts(body, node.bodyFields) } as GraphNode
          break
        }
        case 'cron':
          next = { ...next, cronTimes: config.schedule } as GraphNode
          break
        case 'poll':
        case 'integration': {
          if (config.key != node.definition.key) fail('trigger.key-immutable', 'Create a new node to change its Trigger type.')
          const { connectionId: _connection, ...withoutConnection } = next as Extract<GraphNode, { kind: 'poll' | 'integration' }>
          next = {
            ...withoutConnection,
            ...(config.connectionId == null ? {} : { connectionId: config.connectionId }),
            ...(node.kind == 'poll' ? { pollTimes: config.schedule } : {}),
          } as GraphNode
          break
        }
        default: {
          const fields = { ...next } as Record<string, unknown>
          for (const key of Object.keys(record(view.config))) delete fields[key]
          next = { ...fields, ...config } as unknown as GraphNode
        }
      }
    replace(ref, next)
  }
  async function setText(ref: string, field: 'code' | 'prompt', text: string) {
    const node = nodeAt(content, ref),
      before = textAt(content, node, field)
    if (before == text) return
    if (field == 'code' && node.kind == 'task' && 'moduleId' in node.task) {
      const moduleId = node.task.moduleId,
        module = content.modules[moduleId]!
      const shared =
        Object.values(content.document.graph.nodes).some((n) => n.kind == 'task' && 'moduleId' in n.task && n.task.moduleId == moduleId && n !== node) ||
        Object.values(content.modules).some((m) => m.imports.includes(moduleId))
      const imports = await moduleImports(text)
      if (shared) {
        const id = fresh('module')
        apply([{ kind: 'module.create', moduleId: id, module: { ...module, source: text, imports } }])
        replace(ref, { ...node, task: { ...node.task, moduleId: id } })
      } else apply([{ kind: 'module.source.replace', moduleId, beforeSource: before, beforeImports: module.imports, source: text, imports }])
    } else if (node.kind == 'task' && 'executor' in node.task) {
      const task = node.task
      taskNode(ref, { ...task, executor: { ...task.executor, prompt: text } } as ManagedTaskDefinition)
    } else if (node.kind == 'wait' || node.kind == 'approval') replace(ref, { ...node, prompt: text })
  }
  async function setInput(ref: string, input: string, value: AuthoringSource) {
    const node = nodeAt(content, ref)
    if (node.kind == 'condition')
      fail('input.unsupported', 'Edit the branch condition operands through config.branches.', { node: ref, field: 'config.branches' })
    if (node.kind == 'poll' || node.kind == 'integration') {
      if (!Object.hasOwn(inputDefinitions(node), input))
        fail('input.not-found', `Unknown input ${input}.`, { node: ref, input, choices: Object.keys(inputDefinitions(node)) })
      if (value.kind != 'value' && value.kind != 'unset' && value.kind != 'default')
        fail('input.source-unsupported', 'Trigger parameters accept only value, unset or default; they cannot depend on execution outputs or variables.', {
          node: ref,
          input,
          allowed: ['value', 'unset', 'default'],
        })
      const config = { ...node.config }
      if (value.kind == 'default') delete config[input]
      else config[input] = value
      replace(ref, { ...node, config })
      return
    }
    if (!Object.hasOwn(inputDefinitions(node), input)) {
      const type = typeOf(node)
      if (!['agent', 'code', 'llm', 'wait', 'approval'].includes(type))
        fail('input.not-found', `Unknown input ${input}.`, { node: ref, input, choices: Object.keys(inputDefinitions(node)) })
      if (type == 'llm' && llmReservedInputs.includes(input))
        fail('input.not-found', `Missing built-in LLM input ${input}.`, { node: ref, input, choices: Object.keys(inputDefinitions(node)) })
      await configure(ref, { config: { inputs: { [input]: {} } } })
    }
    const mapping: InputMapping | undefined =
      value.kind == 'default'
        ? undefined
        : value.kind == 'value' || value.kind == 'unset'
          ? value
          : { kind: 'sources', sources: (value.kind == 'sources' ? value.sources : [value]).map(source) }
    const before = nodeInputMappings(nodeAt(content, ref))[input]
    if (!dequal(before, mapping)) apply([{ kind: 'graph.node.input.set', nodeId: ref, handle: input, before, ...(mapping == null ? {} : { value: mapping }) }])
  }
  for (const edit of parsed.edits) {
    try {
      switch (edit.op) {
        case 'node.add': {
          if (Object.hasOwn(aliases, edit.as)) fail('node.alias-duplicate', `Duplicate alias ${edit.as}.`)
          const nodeId = host.id(`node:${edit.as}`),
            identity = { nodeId, moduleId: fresh('module') },
            name = edit.name
          aliases[edit.as] = nodeId
          const config = edit.config ?? {}
          let changes: readonly ChangeOperation[]
          switch (edit.type) {
            case 'code':
              changes = createCodeTask(identity, name, undefined, {
                inputs: [],
                outputs: config.outputs == null ? defaultCodeTaskPorts.outputs : [],
              })
              break
            case 'agent':
              changes = createAgentTask(identity, name, { inputs: [], prompt: edit.prompt ?? '' })
              break
            case 'llm':
              changes = createLlmTask(identity, name, 'chat', 'Generated response.').map((change) =>
                change.kind == 'graph.node.create' && change.node.kind == 'task' && 'executor' in change.node.task
                  ? Object.assign({}, change, { node: Object.assign({}, change.node, { task: initialAuthoringLlmTask(change.node.task) }) })
                  : change,
              )
              break
            case 'decision':
              changes = createDecisionTask(identity, name)
              break
            case 'connector':
              changes = createManagedTask(identity, await connectorTask(config, name))
              break
            case 'openapi':
              changes = createManagedTask(
                identity,
                await prepareOpenApiTask(authoringConfigurations.openapi.parse(config), undefined, (url) => host.openapi(url), name),
              )
              break
            case 'condition':
              changes = createCondition(nodeId, name)
              break
            case 'value':
              changes = createValue(nodeId, name, [])
              break
            case 'wait':
              changes = createWait(nodeId, name)
              break
            case 'approval':
              changes = createApproval(nodeId, name)
              break
            case 'poll':
            case 'integration': {
              const definition = host.trigger(String(config.key))
              if (definition.type != edit.type) fail('trigger.type-mismatch', 'Trigger key has a different type.')
              changes = createProviderTrigger(nodeId, definition, { name, config: {} })
              break
            }
            default:
              changes = [
                {
                  kind: 'graph.node.create',
                  nodeId,
                  node: {
                    kind: edit.type,
                    name,
                    ...(edit.type == 'cron' ? { cronTimes: [{ type: 'every', unit: 'hour', value: 1 }] } : {}),
                    ...(edit.type == 'webhook' ? { method: 'POST', bodyFields: [] } : {}),
                  } as GraphNode,
                },
              ]
          }
          apply(changes)
          await configure(nodeId, { config })
          const added = nodeAt(content, nodeId)
          if (added.kind == 'task') replace(nodeId, { ...added, inputs: {} })
          if (edit.code != null) await setText(nodeId, 'code', edit.code)
          if (edit.prompt != null) await setText(nodeId, 'prompt', edit.prompt)
          for (const [input, binding] of Object.entries(edit.inputs ?? {})) await setInput(nodeId, input, binding)
          break
        }
        case 'node.update':
          await configure(resolve(edit.node), edit.set, edit.clear)
          break
        case 'node.remove': {
          const ref = resolve(edit.node),
            node = nodeAt(content, ref)
          if (node.kind == 'task' && 'moduleId' in node.task) touchedModules.add(node.task.moduleId)
          apply([{ kind: 'graph.node.delete', nodeId: ref }])
          break
        }
        case 'input.set': {
          await setInput(resolve(edit.node), edit.input, edit.source)
          break
        }
        case 'edge.connect':
        case 'edge.disconnect': {
          const from = resolve(edit.source),
            to = resolve(edit.target)
          nodeAt(content, from)
          nodeAt(content, to)
          const edge = { source: from, target: to, ...(edit.branch == null ? {} : { sourceHandle: edit.branch }) }
          const exists = content.document.graph.edges.some((e) => dequal(e, edge))
          if ((edit.op == 'edge.connect') != exists) apply([{ kind: edit.op == 'edge.connect' ? 'graph.edge.connect' : 'graph.edge.disconnect', edge }])
          break
        }
        case 'text.set':
          await setText(resolve(edit.node), edit.field, edit.text)
          break
        case 'text.edit': {
          const ref = resolve(edit.node),
            value = textAt(content, nodeAt(content, ref), edit.field),
            count = value.split(edit.oldText).length - 1
          if (count != 1)
            fail('text.match-count', `Expected one exact match, found ${count}. Read the field and include more context.`, {
              node: ref,
              field: edit.field,
              matches: count,
            })
          await setText(
            ref,
            edit.field,
            value.replace(edit.oldText, () => edit.newText),
          )
          break
        }
      }
    } catch (error) {
      if (error instanceof AuthoringError || error instanceof AuthoringToolInputError || error instanceof AuthoringOpenApiAuthenticationError)
        throw new AuthoringError(error.code, error.message, { ...error.details, editIndex: index })
      throw new AuthoringError('edit.invalid', error instanceof Error ? error.message : String(error), { editIndex: index })
    }
    index++
  }
  for (const moduleId of touchedModules)
    if (
      !Object.values(content.document.graph.nodes).some((n) => n.kind == 'task' && 'moduleId' in n.task && n.task.moduleId == moduleId) &&
      !Object.values(content.modules).some((m) => m.imports.includes(moduleId))
    )
      apply([{ kind: 'module.delete', moduleId }])
  // Shared binding lifecycle remains owned by the existing authoring implementation.
  const cleaned = cleanVariableBindings(base, operations)
  return { operations: cleaned, content: cleaned.length == 0 ? base : applyFlowChanges(base, cleaned), nodes: aliases }
}

const escapePointer = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1')
export function authoringDiagnostics(content: RevisionContent, diagnostics: readonly Diagnostic[]) {
  const nodes = Object.entries(content.document.graph.nodes)
  return diagnostics.map((diagnostic) => {
    const affected = nodes.filter(([id, node]) => {
      const roots = [`/document/graph/nodes/${escapePointer(id)}`]
      if (node.kind == 'task' && 'moduleId' in node.task) roots.push(`/modules/${escapePointer(node.task.moduleId)}`)
      return roots.some((root) => diagnostic.path == root || diagnostic.path.startsWith(`${root}/`))
    })
    // Diagnostic wording comes from the shared validators; storage identities are replaced at this boundary.
    const message = diagnostic.message
      .replace(/(CodeModule|Managed Task|Task|Binding) "([^"\n]+)"/g, (_, kind: string, id: string) => {
        if (kind == 'Binding') return `Variable "${content.document.bindings[id]?.target ?? 'unresolved'}"`
        const owners = nodes.filter(([, n]) => n.kind == 'task' && kind == 'CodeModule' && 'moduleId' in n.task && n.task.moduleId == id)
        return owners.length
          ? `${kind == 'CodeModule' ? 'Code for' : 'Node'} ${owners.map(([ref, n]) => JSON.stringify(n.name ?? ref)).join(', ')}`
          : kind == 'CodeModule'
            ? 'Referenced code'
            : 'Node configuration'
      })
      .replaceAll('CodeModule', 'Code')
    const parts = diagnostic.path.split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    return {
      code: diagnostic.code,
      message,
      nodes: affected.map(([id]) => id),
      field: affected[0] == null ? 'config' : authoringDiagnosticField(content, affected[0][1], parts),
      ...(diagnostic.line ? { line: diagnostic.line, column: diagnostic.column } : {}),
    }
  })
}
