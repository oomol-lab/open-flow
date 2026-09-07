import type { EngineContract } from '../../execution/common/engineContract.ts'
import type { RuntimeProgram } from '../../execution/common/runtime.ts'
import type { ConnectorCapability, FlowDocument, Graph, InputMapping, JsonValue, RevisionContent } from './change.ts'

import { findEngineContract } from '../../execution/common/engineContract.ts'
import { decodeConnectorCapabilities } from './change.ts'
import { canonicalGraph, canonicalJsonBytes, canonicalModule, canonicalOutputs, canonicalPorts, canonicalTask, digestBytes } from './encoding.ts'
import { nodeInputPorts, validateFlowGraph } from './graph.ts'
import { compareDiagnostics, validateModuleGraph } from './modules.ts'
import { hasRetiredRef, matchesSchema, triggerPayloadSchema } from './schema.ts'
export { availableOutputs, graphOrder, nodeInputPorts } from './graph.ts'
export { validateModules } from './modules.ts'
export { matchesSchema, triggerPayloadSchema, variableInputCompatible } from './schema.ts'

export interface SemanticClosure {
  readonly dependencies: {
    readonly bindings: ReadonlySet<string>
    readonly inputBindings: ReadonlySet<string>
    readonly modules: ReadonlySet<string>
    readonly subflows: ReadonlySet<string>
    readonly tasks: ReadonlySet<string>
  }
  readonly digest: string
}

function entries<T>(value: Readonly<Record<string, T>>): readonly (readonly [string, T])[] {
  return Object.keys(value)
    .toSorted()
    .map((key) => [key, value[key]!] as const)
}

export function flowDependencies(content: RevisionContent): SemanticClosure['dependencies'] {
  const bindings = new Set<string>()
  const inputBindings = new Set<string>()
  const modules = new Set<string>()
  const subflows = new Set<string>()
  const tasks = new Set<string>()

  function visitBinding(id: string): void {
    bindings.add(id)
  }

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
        inputBindings.add(source.bindingId)
        visitBinding(source.bindingId)
      }
    }
  }

  function visitGraph(value: Graph): void {
    for (const [, node] of entries(value.nodes)) {
      if ('inputs' in node) visitInputMappings(node.inputs)
      switch (node.kind) {
        case 'condition':
          break
        case 'subflow':
          visitSubflow(node.subflowId)
          break
        case 'task':
          if (node.task != null) visitModule(node.task.moduleId)
          else tasks.add(node.taskId)
          break
        case 'value':
          break
        case 'wait':
          if (node.notification != null) {
            tasks.add(node.notification.taskId)
            visitInputMappings(node.notification.inputs)
          }
          break
        case 'poll':
        case 'integration':
          visitBinding(node.bindingId)
          break
        case 'cron':
        case 'manual':
        case 'webhook':
          break
      }
    }
  }

  function visitSubflow(id: string): void {
    if (subflows.has(id)) return
    subflows.add(id)
    const subflow = content.document.subflows[id]
    if (subflow != null) visitGraph(subflow.graph)
  }

  visitGraph(content.document.graph)

  return { bindings, inputBindings, modules, subflows, tasks }
}

export async function flowClosure(content: RevisionContent): Promise<SemanticClosure> {
  const dependencies = flowDependencies(content)
  const { bindings, modules, subflows, tasks } = dependencies

  const bytes = canonicalJsonBytes({
    bindings: Object.fromEntries([...bindings].toSorted().map((id) => [id, content.document.bindings[id] ?? null])),
    graph: canonicalGraph(content.document.graph),
    kind: 'open-flow-semantic-closure',
    modelVersion: content.modelVersion,
    modules: Object.fromEntries([...modules].toSorted().map((id) => [id, content.modules[id] == null ? null : canonicalModule(content.modules[id])])),
    tasks: Object.fromEntries([...tasks].toSorted().map((id) => [id, content.document.tasks[id] == null ? null : canonicalTask(content.document.tasks[id])])),
    subflows: Object.fromEntries(
      [...subflows].toSorted().map((id) => {
        const subflow = content.document.subflows[id]
        if (subflow == null) return [id, null]
        return [
          id,
          {
            graph: canonicalGraph(subflow.graph),
            inputs: canonicalPorts(subflow.inputs),
            name: subflow.name,
            outputs: canonicalOutputs(subflow.outputs),
          },
        ]
      }),
    ),
    version: 1,
  })
  return { dependencies, digest: await digestBytes(bytes) }
}

export function variableBindings(revision: RevisionContent, bindingIds: Iterable<string>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...bindingIds].flatMap((bindingId) => {
      const binding = revision.document.bindings[bindingId]
      return binding?.kind == 'variable' ? [[bindingId, binding.target]] : []
    }),
  )
}

export interface Diagnostic {
  readonly code: string
  readonly column: number
  readonly line: number
  readonly message: string
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
  if (Object.keys(trigger).some((key) => key != 'nodeId' && key != 'payload') || typeof trigger.nodeId != 'string' || !Object.hasOwn(trigger, 'payload'))
    return false
  const node = revision.document.graph.nodes[trigger.nodeId]
  return node != null && !('inputs' in node) && matchesSchema(trigger.payload as JsonValue, triggerPayloadSchema(node))
}

export function validateFlowInputs(revision: RevisionContent, value: unknown): FlowInputsValidation {
  if (value == null || typeof value != 'object' || Array.isArray(value)) return 'invalid'
  const graph = revision.document.graph
  for (const [nodeId, candidate] of Object.entries(value)) {
    const node = graph.nodes[nodeId]
    if (node == null || !('inputs' in node) || candidate == null || typeof candidate != 'object' || Array.isArray(candidate)) {
      return 'invalid'
    }
    const inputs = nodeInputPorts(revision.document, node)
    for (const handle of Object.keys(candidate)) {
      const port = inputs[handle]
      if (port == null || hasRetiredRef(port.jsonSchema) || node.inputs[handle] != null || Object.hasOwn(port, 'value')) return 'invalid'
    }
  }
  return 'valid'
}

export async function validateFlow(revision: RevisionContent, engine: EngineContract): Promise<FlowValidation> {
  const closure = await flowClosure(revision)
  const checked = validateModuleGraph(revision, [...closure.dependencies.modules], engine)
  checked.diagnostics.push(...validateFlowGraph(revision, closure))
  const graphs = [
    ['/document/graph', revision.document.graph] as const,
    ...[...closure.dependencies.subflows].toSorted().flatMap((subflowId) => {
      const subflow = revision.document.subflows[subflowId]
      return subflow == null ? [] : [[`/document/subflows/${subflowId}/graph`, subflow.graph] as const]
    }),
  ]
  const missingEntryModules = new Set<string>()
  for (const [graphPath, graph] of graphs) {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.kind != 'task' || node.task == null) continue
      if (revision.modules[node.task.moduleId] == null) {
        checked.diagnostics.push({
          code: 'task.module-missing',
          column: 0,
          line: 1,
          message: `Inline Task "${nodeId}" references missing CodeModule "${node.task.moduleId}".`,
          path: `${graphPath}/nodes/${nodeId}/task/moduleId`,
          values: { moduleId: node.task.moduleId, nodeId },
        })
      } else if (!checked.analysis.get(node.task.moduleId)?.exports.has('default') && !missingEntryModules.has(node.task.moduleId)) {
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
        decodeConnectorCapabilities(node.task.capabilities === undefined ? [] : node.task.capabilities)
      } catch {
        checked.diagnostics.push({
          code: 'task.capability-incomplete',
          column: 0,
          line: 1,
          message: `Inline Task "${nodeId}" has an incomplete Connector Capability.`,
          path: `${graphPath}/nodes/${nodeId}/task/capabilities`,
          values: { nodeId },
        })
      }
    }
  }
  for (const taskId of [...closure.dependencies.tasks].toSorted()) {
    const task = revision.document.tasks[taskId]
    if (task == null) continue
    if (task.executor.kind == 'connector' && task.executor.action.length == 0) {
      checked.diagnostics.push({
        code: 'task.connector-incomplete',
        column: 0,
        line: 1,
        message: `Connector Task "${taskId}" requires an action.`,
        path: `/document/tasks/${taskId}/executor`,
        values: { taskId },
      })
    }
  }
  const diagnostics = checked.diagnostics.toSorted(compareDiagnostics)
  return { closure, diagnostics, valid: diagnostics.length == 0 }
}

export interface PreparedFlow {
  readonly closureDigest: string
  readonly engineContract: string
  readonly graph: Graph
  readonly modules: RevisionContent['modules']
  readonly subflows: FlowDocument['subflows']
  readonly tasks: FlowDocument['tasks']
}

export type PrepareFlowResult =
  | { readonly kind: 'engine-unsupported' }
  | { readonly kind: 'flow-invalid'; readonly validation: FlowValidation }
  | { readonly flow: PreparedFlow; readonly kind: 'prepared'; readonly validation: FlowValidation }

export async function prepareFlow(revision: RevisionContent, engineContract: string): Promise<PrepareFlowResult> {
  const engine = findEngineContract(engineContract)
  if (engine == null) return { kind: 'engine-unsupported' }
  const validation = await validateFlow(revision, engine)
  if (!validation.valid) return { kind: 'flow-invalid', validation }
  const { closure } = validation
  return {
    flow: {
      closureDigest: closure.digest,
      engineContract,
      graph: revision.document.graph,
      modules: Object.fromEntries([...closure.dependencies.modules].toSorted().map((id) => [id, revision.modules[id]!])),
      subflows: Object.fromEntries([...closure.dependencies.subflows].toSorted().map((id) => [id, revision.document.subflows[id]!])),
      tasks: Object.fromEntries([...closure.dependencies.tasks].toSorted().map((id) => [id, revision.document.tasks[id]!])),
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

export function codeActions(flow: Pick<PreparedFlow, 'graph' | 'subflows'>): readonly ConnectorCapability[] {
  return [flow.graph, ...Object.values(flow.subflows).map((subflow) => subflow.graph)].flatMap((graph) =>
    Object.values(graph.nodes).flatMap((node) => (node.kind == 'task' && node.task != null ? (node.task.capabilities ?? []) : [])),
  )
}
