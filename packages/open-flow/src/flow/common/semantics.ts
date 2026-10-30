import { dequal } from 'dequal/lite'
import { decisionTaskIssues } from '../../decision/common/decision.ts'
import { httpRequestIssues, httpAuthHandles, httpRequestTask, httpRequestUrl } from '../../http/common/httpRequest.ts'
import { openApiIssues, authHandles } from '../../openapi/common/openapi.ts'
import { isTriggerNode } from './change.ts'
import { nodeWorkflowReferences } from './workflowReferences.ts'
export { renderPrompt } from './promptTemplate.ts'
export { connectionUsage, removeConnectionUsage } from './connectionUsage.ts'
import { matchesTriggerOutputs, normalizeTriggerOutputs } from '../../trigger/common/contract.ts'
import { nodeInputMappings } from './condition.ts'
import { connectionUsage } from './connectionUsage.ts'
export { matchesTriggerOutputs, normalizeTriggerOutputs, triggerOutputDefinitions, triggerOutputPorts } from '../../trigger/common/contract.ts'
import type { EngineContract } from '../../runtime/common/engineContract.ts'
import type { RuntimeProgram } from '../../runtime/common/runtime.ts'
import type { ConnectorActionCapability, ConnectorCapability, Graph, InputMapping, JsonValue, Port, RevisionContent, SchemaMismatch } from './change.ts'

import { findEngineContract } from '../../runtime/common/engineContract.ts'
import { agentConfigIssues } from './agent.ts'
import { decodeTaskCapabilities } from './change.ts'
import { canonicalJsonBytes, canonicalModule, canonicalRevisionGraph, digestBytes } from './encoding.ts'
import { nodeInputPorts, validateFlowGraph } from './graph.ts'
import { inputValue } from './inputValue.ts'
import { compareDiagnostics, validateModuleGraph } from './modules.ts'
import { hasRetiredRef } from './schema.ts'
export { availableOutputs, graphOrder, nodeInputPorts } from './graph.ts'
export { validateModules } from './modules.ts'
export { matchesSchema, schemaValidationErrors, variableInputCompatible } from './schema.ts'
export { agentInput, agentToolInput, agentToolSchema } from './agent.ts'

export interface SemanticClosure {
  readonly dependencies: {
    readonly bindings: ReadonlySet<string>
    readonly nodes: ReadonlySet<string>
    readonly modules: ReadonlySet<string>
  }
  readonly digest: string
}

function entries<T>(value: Readonly<Record<string, T>>): readonly (readonly [string, T])[] {
  return Object.keys(value)
    .toSorted()
    .map((key) => [key, value[key]!] as const)
}

export function flowDependencies(content: RevisionContent, triggerId?: string): SemanticClosure['dependencies'] {
  if (triggerId != null) return flowDependencies(runRevision(content, triggerId))
  const bindings = new Set<string>()
  const modules = new Set<string>()

  function visitModule(id: string): void {
    if (modules.has(id)) return
    modules.add(id)
    const module = content.modules[id]
    if (module == null) return
    for (const imported of module.imports.toSorted()) visitModule(imported)
  }

  function visitInputMappings(value: Readonly<Record<string, InputMapping>>): void {
    for (const mapping of Object.values(value)) {
      if (mapping.kind != 'sources') continue
      for (const source of mapping.sources) {
        if (source.kind != 'binding') continue
        bindings.add(source.bindingId)
      }
    }
  }

  function visitGraph(value: Graph): void {
    for (const [, node] of entries(value.nodes)) {
      if (!isTriggerNode(node)) visitInputMappings(nodeInputMappings(node))
      switch (node.kind) {
        case 'condition':
          break
        case 'task':
          if ('moduleId' in node.task) visitModule(node.task.moduleId)
          break
        case 'outputs':
        case 'value':
          break
        case 'approval':
        case 'wait':
          break
        case 'poll':
        case 'integration':
        case 'cron':
        case 'error':
        case 'manual':
        case 'start':
        case 'webhook':
          break
      }
    }
  }

  visitGraph(content.document.graph)

  return { bindings, modules, nodes: new Set(Object.keys(content.document.graph.nodes)) }
}

export async function flowClosure(content: RevisionContent): Promise<SemanticClosure> {
  const dependencies = flowDependencies(content)
  return { dependencies, digest: await digestBytes(closureBytes(content, dependencies)) }
}

/** Canonical semantic bytes, also used by transactional storage upgrades. */
export function encodeFlowClosure(content: RevisionContent, triggerId?: string): Uint8Array {
  const scoped = triggerId == null ? content : runRevision(content, triggerId)
  return closureBytes(scoped, flowDependencies(scoped))
}

function closureBytes(content: RevisionContent, dependencies: SemanticClosure['dependencies']): Uint8Array {
  const { bindings, modules } = dependencies
  return canonicalJsonBytes({
    bindings: Object.fromEntries([...bindings].toSorted().map((id) => [id, content.document.bindings[id] ?? null])),
    graph: canonicalRevisionGraph(content, content.document.graph),
    kind: 'open-flow-semantic-closure',
    ...(content.modelVersion < 6 ? { subflows: {} } : {}),
    modelVersion: content.modelVersion,
    modules: Object.fromEntries([...modules].toSorted().map((id) => [id, content.modules[id] == null ? null : canonicalModule(content.modules[id])])),
    ...(content.modelVersion < 6 ? { tasks: {} } : {}),
    version: 2,
  })
}

export function variableBindings(revision: RevisionContent, bindingIds: Iterable<string>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...bindingIds].flatMap((bindingId) => {
      const binding = revision.document.bindings[bindingId]
      return binding?.kind == 'variable' ? [[bindingId, binding.target]] : []
    }),
  )
}

export interface FlowResourceReferences {
  readonly calledFlowIds?: readonly string[]
  readonly variableNames: readonly string[]
  readonly connections: readonly { readonly providerId: string; readonly connectionId: string }[]
  readonly errorSourceFlowIds: readonly string[]
}

export function flowResourceReferences(content: RevisionContent): FlowResourceReferences {
  const connections = new Map<string, { readonly providerId: string; readonly connectionId: string }>()
  for (const use of connectionUsage(content.document)) {
    if (use.connectionId == null || use.connectionId === '') continue
    connections.set(JSON.stringify([use.providerId, use.connectionId]), { providerId: use.providerId, connectionId: use.connectionId })
  }
  return {
    calledFlowIds: [
      ...new Set(
        Object.values(content.document.graph.nodes).flatMap((node) =>
          nodeWorkflowReferences(node)
            .map(({ target }) => target.flowId)
            .filter(Boolean),
        ),
      ),
    ].toSorted(),
    variableNames: [...new Set(Object.values(variableBindings(content, flowDependencies(content).bindings)))].toSorted(),
    connections: [...connections].toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([, value]) => value),
    errorSourceFlowIds: [
      ...new Set(Object.values(content.document.graph.nodes).flatMap((node) => (node.kind == 'error' ? (node.sourceFlowIds ?? []) : []))),
    ].toSorted(),
  }
}

export interface Diagnostic {
  readonly code: string
  readonly column: number
  readonly fields?: readonly string[]
  readonly line: number
  readonly message: string
  readonly mismatch?: SchemaMismatch
  readonly path: string
  readonly values?: Readonly<Record<string, string | number>>
}

export interface FlowValidation {
  readonly closure: SemanticClosure
  readonly diagnostics: readonly Diagnostic[]
  readonly valid: boolean
}

export type FlowInputsValidation = 'invalid' | 'valid'

export function validRunTrigger(revision: RevisionContent, value: unknown): boolean {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return false
  const trigger = value as Readonly<Record<string, unknown>>
  if (Object.keys(trigger).some((key) => key != 'nodeId' && key != 'outputs') || typeof trigger.nodeId != 'string' || !Object.hasOwn(trigger, 'outputs'))
    return false
  const node = revision.document.graph.nodes[trigger.nodeId]
  return node != null && isTriggerNode(node) && matchesTriggerOutputs(node, trigger.outputs)
}

export function normalizeRunTrigger(
  revision: RevisionContent,
  value: unknown,
): { readonly nodeId: string; readonly outputs: Readonly<Record<string, JsonValue>> } | undefined {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return
  const trigger = value as Readonly<Record<string, unknown>>
  if (Object.keys(trigger).some((key) => key != 'nodeId' && key != 'outputs') || typeof trigger.nodeId != 'string' || !Object.hasOwn(trigger, 'outputs')) return
  const node = revision.document.graph.nodes[trigger.nodeId]
  if (node == null || !isTriggerNode(node)) return
  const outputs = normalizeTriggerOutputs(node, trigger.outputs)
  return outputs == null ? undefined : { nodeId: trigger.nodeId, outputs }
}

export function validateFlowInputs(revision: RevisionContent, value: unknown): FlowInputsValidation {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return 'invalid'
  const graph = revision.document.graph
  for (const [nodeId, candidate] of Object.entries(value)) {
    const node = graph.nodes[nodeId]
    if (node == null || isTriggerNode(node) || node.kind == 'condition' || candidate == null || typeof candidate != 'object' || Array.isArray(candidate)) {
      return 'invalid'
    }
    const inputs = nodeInputPorts(node)
    for (const handle of Object.keys(candidate)) {
      const port = inputs[handle]
      if (port == null || hasRetiredRef(port.jsonSchema) || nodeInputMappings(node)[handle] != null || Object.hasOwn(port, 'value')) return 'invalid'
    }
  }
  return 'valid'
}

export async function validateFlow(revision: RevisionContent, engine: EngineContract): Promise<FlowValidation> {
  const closure = await flowClosure(revision)
  const checked = validateModuleGraph(revision, [...closure.dependencies.modules], engine)
  checked.diagnostics.push(...validateFlowGraph(revision))
  const missingEntryModules = new Set<string>()
  for (const [nodeId, node] of Object.entries(revision.document.graph.nodes)) {
    if (node.kind != 'task' || !('moduleId' in node.task)) continue
    if (revision.modules[node.task.moduleId] == null) {
      checked.diagnostics.push({
        code: 'task.module-missing',
        column: 0,
        line: 1,
        message: `Inline Task "${nodeId}" references missing CodeModule "${node.task.moduleId}".`,
        path: `/document/graph/nodes/${nodeId}/task/moduleId`,
        values: { moduleId: node.task.moduleId, nodeId },
      })
    } else if (checked.analysis.get(node.task.moduleId)?.exports.has('default') == false && !missingEntryModules.has(node.task.moduleId)) {
      missingEntryModules.add(node.task.moduleId)
      checked.diagnostics.push({
        code: 'task.missing-entry',
        column: 0,
        line: 1,
        message: `CodeModule "${node.task.moduleId}" used by an Inline Task must export a default function.`,
        path: `/modules/${node.task.moduleId}/source`,
        values: { moduleId: node.task.moduleId },
      })
    }
    try {
      decodeTaskCapabilities(node.task.capabilities === undefined ? [] : node.task.capabilities)
    } catch {
      checked.diagnostics.push({
        code: 'task.capability-incomplete',
        column: 0,
        line: 1,
        message: `Inline Task "${nodeId}" has an incomplete Connector Capability.`,
        path: `/document/graph/nodes/${nodeId}/task/capabilities`,
        values: { nodeId },
      })
    }
  }
  for (const [nodeId, node] of Object.entries(revision.document.graph.nodes)) {
    if (node.kind != 'task' || !('executor' in node.task)) continue
    const task = node.task
    for (const issue of decisionTaskIssues(task))
      checked.diagnostics.push({
        code: 'decision.config-invalid',
        column: 0,
        line: 1,
        message: issue.message,
        path: `/document/graph/nodes/${nodeId}/task/executor`,
      })
    for (const message of openApiIssues(task))
      checked.diagnostics.push({ code: 'openapi.config-invalid', column: 0, line: 1, message, path: `/document/graph/nodes/${nodeId}/task/executor` })
    if (task.executor.kind == 'http-request') {
      for (const issue of httpRequestIssues(task.executor))
        checked.diagnostics.push({
          code: 'http-request.config-invalid',
          column: 0,
          line: 1,
          message: issue.message,
          path: `/document/graph/nodes/${nodeId}/task/executor/${issue.field}`,
        })
      if (node.inputs.url?.kind == 'value') {
        try {
          httpRequestUrl(node.inputs.url.value)
        } catch {
          checked.diagnostics.push({
            code: 'http-request.url-invalid',
            column: 0,
            line: 1,
            message: 'Enter an HTTP(S) URL without embedded credentials.',
            path: `/document/graph/nodes/${nodeId}/inputs/url`,
          })
        }
      }
      if (task.executor.bodyFormat != 'none' && (node.inputs.body == null || node.inputs.body.kind == 'unset'))
        checked.diagnostics.push({
          code: 'http-request.body-required',
          column: 0,
          line: 1,
          message: 'Set or bind the request body; JSON null is an explicit value.',
          path: `/document/graph/nodes/${nodeId}/inputs/body`,
        })
      const expected = httpRequestTask(task.executor)

      if (
        !dequal(httpPortContracts(task.inputs), httpPortContracts(expected.inputs)) ||
        !dequal(httpPortContracts(task.outputs), httpPortContracts(expected.outputs))
      )
        checked.diagnostics.push({
          code: 'http-request.ports-invalid',
          column: 0,
          line: 1,
          message: 'HTTP Request ports must match its configuration.',
          path: `/document/graph/nodes/${nodeId}/task`,
        })
    }
    if (task.executor.kind == 'openapi' || task.executor.kind == 'http-request') {
      const handles = task.executor.kind == 'openapi' ? authHandles(task.executor.auth) : httpAuthHandles(task.executor)
      for (const handle of handles) {
        const mapping = node.inputs[handle]
        if (mapping?.kind != 'sources' || mapping.sources.length == 0)
          checked.diagnostics.push({
            code: `${task.executor.kind}.auth-source`,
            column: 0,
            line: 1,
            message: 'Authentication requires a deployment variable or upstream output.',
            path: `/document/graph/nodes/${nodeId}/inputs/${handle}`,
          })
      }
    }
    for (const message of agentConfigIssues(task)) {
      checked.diagnostics.push({ code: 'agent.config-invalid', column: 0, line: 1, message, path: `/document/graph/nodes/${nodeId}/task/executor` })
    }
    if (task.executor.kind == 'connector' && task.executor.action == 'leina.send_notification') {
      const mapping = node.inputs.leinaId
      const value = inputValue(mapping, nodeInputPorts(node).leinaId?.value)
      if ((mapping?.kind != 'sources' || mapping.sources.length == 0) && (typeof value != 'string' || value.trim().length == 0)) {
        checked.diagnostics.push({
          code: 'leina.robot-required',
          column: 0,
          line: 1,
          message: 'Select a Leina robot or bind its identifier to an input source.',
          path: `/document/graph/nodes/${nodeId}/inputs/leinaId`,
        })
      }
    }
    if (task.executor.kind == 'connector' && task.executor.action.length == 0) {
      checked.diagnostics.push({
        code: 'task.connector-incomplete',
        column: 0,
        line: 1,
        message: `Connector Task "${nodeId}" requires an action.`,
        path: `/document/graph/nodes/${nodeId}/task/executor`,
        values: { nodeId },
      })
    }
  }
  const diagnostics = checked.diagnostics.toSorted(compareDiagnostics)
  return { closure, diagnostics, valid: diagnostics.length == 0 }
}

export interface PreparedFlow {
  readonly inputDefs: readonly Port[]
  readonly outputDefs: readonly Port[]
  readonly outputMappings: Readonly<Record<string, InputMapping>>
  readonly closureDigest: string
  readonly engineContract: string
  readonly graph: Graph
  readonly modules: RevisionContent['modules']
}

export type PrepareFlowResult =
  | { readonly kind: 'engine-unsupported' }
  | { readonly kind: 'flow-invalid'; readonly validation: FlowValidation }
  | { readonly flow: PreparedFlow; readonly kind: 'prepared'; readonly validation: FlowValidation }

function runRevision(revision: RevisionContent, triggerId: string): RevisionContent {
  const graph = revision.document.graph
  const reachable = new Set([triggerId])
  for (const nodeId of reachable) {
    for (const edge of graph.edges) if (edge.source == nodeId) reachable.add(edge.target)
  }
  function inputs(nodeId: string, mappings: Readonly<Record<string, InputMapping>>): Readonly<Record<string, InputMapping>> {
    const ancestors = new Set<string>()
    for (const edge of graph.edges) if (edge.target == nodeId) ancestors.add(edge.source)
    for (const ancestor of ancestors) {
      for (const edge of graph.edges) if (edge.target == ancestor) ancestors.add(edge.source)
    }
    return Object.fromEntries(
      Object.entries(mappings).map(([handle, mapping]) => [
        handle,
        mapping.kind != 'sources'
          ? mapping
          : {
              ...mapping,
              sources: mapping.sources.filter(
                (source) => source.kind != 'node' || graph.nodes[source.nodeId] == null || reachable.has(source.nodeId) || !ancestors.has(source.nodeId),
              ),
            },
      ]),
    )
  }
  const nodes: Record<string, Graph['nodes'][string]> = {}
  for (const nodeId of reachable) {
    const node = graph.nodes[nodeId]
    if (node == null) continue
    nodes[nodeId] =
      node.kind == 'outputs'
        ? { ...node, outputMappings: inputs(nodeId, node.outputMappings) }
        : isTriggerNode(node)
          ? node
          : {
              ...node,
              inputs: inputs(nodeId, node.inputs),
            }
  }
  const content = {
    ...revision,
    document: {
      ...revision.document,
      graph: { nodes, edges: graph.edges.filter((edge) => reachable.has(edge.source)) },
    },
  }
  const { bindings } = flowDependencies(content)
  return {
    ...content,
    document: { ...content.document, bindings: Object.fromEntries(Object.entries(content.document.bindings).filter(([id]) => bindings.has(id))) },
  }
}

const httpPortContracts = (ports: import('./change.ts').ManagedTaskDefinition['inputs']) =>
  ports
    .filter((port) => 'handle' in port)
    .map(({ handle, jsonSchema, nullable }) => ({ handle, jsonSchema, nullable }))
    .toSorted((a, b) => a.handle.localeCompare(b.handle))

export async function prepareFlow(revision: RevisionContent, engineContract: string, triggerId?: string): Promise<PrepareFlowResult> {
  const engine = findEngineContract(engineContract)
  if (engine == null) return { kind: 'engine-unsupported' }
  if (
    !engine.httpRequests &&
    Object.values(revision.document.graph.nodes).some((node) => node.kind == 'task' && 'executor' in node.task && node.task.executor.kind == 'http-request')
  )
    return { kind: 'engine-unsupported' }
  if (!engine.workflowTools && Object.values(revision.document.graph.nodes).some((node) => nodeWorkflowReferences(node).some((ref) => ref.tool != null)))
    return { kind: 'engine-unsupported' }
  if (triggerId != null) {
    const trigger = revision.document.graph.nodes[triggerId]
    if (trigger == null || !isTriggerNode(trigger))
      return {
        kind: 'flow-invalid',
        validation: {
          closure: await flowClosure(revision),
          diagnostics: [
            {
              code: 'graph.trigger-invalid',
              column: 0,
              line: 1,
              message: 'Select an existing Trigger node.',
              path: '/document/graph',
              values: { nodeId: triggerId },
            },
          ],
          valid: false,
        },
      }
    revision = runRevision(revision, triggerId)
  }
  if (
    !engine.webhookResponses &&
    Object.values(revision.document.graph.nodes).some(
      (node) => node.kind === 'webhook-response' || (node.kind === 'webhook' && node.options?.responseBody?.kind === 'webhook-response'),
    )
  )
    return { kind: 'engine-unsupported' }
  if (!engine.waitAutoContinue && Object.values(revision.document.graph.nodes).some((node) => node.kind == 'wait' && node.autoContinue != null))
    return { kind: 'engine-unsupported' }
  const validation = await validateFlow(revision, engine)
  if (!validation.valid) return { kind: 'flow-invalid', validation }
  const { closure } = validation
  const start = Object.values(revision.document.graph.nodes).find((node) => node.kind == 'start')
  const outputs = Object.values(revision.document.graph.nodes).find((node) => node.kind == 'outputs')
  return {
    flow: {
      closureDigest: closure.digest,
      engineContract,
      inputDefs: start?.inputDefs ?? [],
      outputDefs: outputs?.outputDefs ?? [],
      outputMappings: outputs?.outputMappings ?? {},
      graph: revision.document.graph,
      modules: Object.fromEntries([...closure.dependencies.modules].toSorted().map((id) => [id, revision.modules[id]!])),
    },
    kind: 'prepared',
    validation,
  }
}

export function createRuntimeProgram(prepared: PreparedFlow, entryModuleId: string, engineDigest: string): RuntimeProgram | undefined {
  if (!Object.hasOwn(prepared.modules, entryModuleId)) return
  return {
    engineContract: prepared.engineContract,
    engineDigest,
    entryModuleId,
    modules: prepared.modules,
  }
}

export function agentActions(flow: Pick<PreparedFlow, 'graph'>): readonly ConnectorActionCapability[] {
  return Object.values(flow.graph.nodes).flatMap((node) => {
    if (node.kind != 'task' || !('executor' in node.task)) return []
    const task = node.task
    if (task.executor.kind != 'agent') return []
    const notice = task.executor.notification
    return [...task.executor.tools.filter((tool) => tool.kind != 'workflow'), ...(notice != null ? [notice] : [])]
      .filter((tool) => tool.connectionId !== '')
      .map((tool) => ({
        kind: 'connector' as const,
        action: tool.action,
        connections: tool.connectionId == null ? [] : [{ connectionId: tool.connectionId }],
      }))
  })
}

export function codeActions(flow: Pick<PreparedFlow, 'graph'>): readonly ConnectorCapability[] {
  return Object.values(flow.graph.nodes).flatMap((node) =>
    node.kind == 'task' && 'moduleId' in node.task ? (node.task.capabilities ?? []).filter((item) => item.kind == 'connector') : [],
  )
}
