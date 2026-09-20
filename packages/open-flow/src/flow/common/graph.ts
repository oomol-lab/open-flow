import type {
  BindingSource,
  FlowDocument,
  FlowSource,
  Graph,
  GraphNode,
  InputMapping,
  InputPortDefinition,
  JsonValue,
  NodeSource,
  PortDefinition,
  RevisionContent,
  SchemaMismatch,
  TriggerNode,
} from './change.ts'
import type { Diagnostic, SemanticClosure } from './semantics.ts'

import { missingTriggerConfig, resolveTriggerConfig } from '../../trigger/common/config.ts'
import { triggerOutputDefinitions, triggerOutputPorts } from '../../trigger/common/contract.ts'
import { portsByHandle, validVariableName } from './change.ts'
import { conditionInputPorts, nodeInputMappings, otherwiseOutput, unaryOperator, comparisonIssue, valueType } from './condition.ts'
import { schemaObject, matchesSchema, comparePorts, portsAssignable, variableInputCompatible, hasRetiredRef } from './schema.ts'
import { sourceFields, sourcePort, sourceOutputLabel } from './sourceField.ts'

export function isResolutionNode(node: GraphNode | undefined): node is Extract<GraphNode, { readonly kind: 'approval' | 'wait' }> {
  return node?.kind == 'approval' || node?.kind == 'wait'
}
function graphDiagnostic(
  code: string,
  message: string,
  path: string,
  values?: Readonly<Record<string, string | number>>,
  mismatch?: SchemaMismatch,
): Diagnostic {
  return { code, column: 0, line: 1, message, mismatch, path, ...(values == null ? {} : { values }) }
}

function validateTrigger(triggerId: string, trigger: TriggerNode, document: FlowDocument, path: string, diagnostics: Diagnostic[]): void {
  const outputHandles = triggerOutputDefinitions(trigger).map((port) => port.handle)
  if (new Set(outputHandles).size !== outputHandles.length)
    diagnostics.push(graphDiagnostic('graph.port-duplicate', 'Trigger output handles must be unique.', `${path}/definition/outputs`))
  if (trigger.kind == 'webhook') {
    const handles = new Set<string>()
    for (const [index, input] of trigger.bodyFields.entries()) {
      if (handles.has(input.handle)) {
        diagnostics.push(
          graphDiagnostic(
            'trigger.input-duplicate',
            `Webhook Trigger input "${input.handle}" is declared more than once.`,
            `${path}/bodyFields/${index}/handle`,
            { input: input.handle },
          ),
        )
      }
      handles.add(input.handle)
    }
    return
  }
  if (trigger.kind == 'cron' || trigger.kind == 'manual') return
  const binding = document.bindings[trigger.bindingId]
  if (binding == null) {
    diagnostics.push(
      graphDiagnostic('trigger.connection-missing', `Trigger Connection binding "${trigger.bindingId}" does not exist.`, `${path}/bindingId`, {
        bindingId: trigger.bindingId,
      }),
    )
  } else if (binding.kind != 'connection') {
    diagnostics.push(
      graphDiagnostic('trigger.connection-invalid', `Trigger binding "${trigger.bindingId}" must be a Connection.`, `${path}/bindingId`, {
        bindingId: trigger.bindingId,
      }),
    )
  }
  const missingConfig = missingTriggerConfig(trigger.definition.configInputs, trigger.config)
  if (missingConfig.length > 0) {
    diagnostics.push(
      graphDiagnostic('trigger.config-incomplete', `Complete the required Trigger config fields: ${missingConfig.join(', ')}.`, `${path}/config`, {
        fields: missingConfig.join(', '),
      }),
    )
  } else {
    try {
      resolveTriggerConfig(trigger.definition.configInputs, trigger.config)
    } catch {
      diagnostics.push(
        graphDiagnostic('trigger.config-invalid', `Trigger "${triggerId}" config does not match its fixed definition.`, `${path}/config`, { triggerId }),
      )
    }
  }
}

export function nodeInputPorts(document: FlowDocument, node: GraphNode): Readonly<Record<string, InputPortDefinition>> {
  switch (node.kind) {
    case 'condition':
      return conditionInputPorts(node)
    case 'value':
      return {}
    case 'subflow':
      return portsByHandle(document.subflows[node.subflowId]?.inputs ?? [])
    case 'task':
      return portsByHandle([...(node.task != null ? node.task.inputs : (document.tasks[node.taskId]?.inputs ?? [])), ...(node.additionalInputs ?? [])])
    case 'approval':
    case 'wait':
      return portsByHandle(node.inputDefinitions)
    case 'cron':
    case 'integration':
    case 'poll':
    case 'manual':
    case 'webhook':
      return {}
  }
}

export function resolutionActions(node: Extract<GraphNode, { readonly kind: 'approval' | 'wait' }>): readonly ['continue'] | readonly ['approve', 'reject'] {
  return node.kind == 'wait' ? ['continue'] : ['approve', 'reject']
}

const objectPort = (properties: Record<string, JsonValue>): PortDefinition => ({
  nullable: false,
  jsonSchema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
})

export function resolutionOutputPorts(node: Extract<GraphNode, { readonly kind: 'approval' | 'wait' }>): Readonly<Record<string, PortDefinition>> {
  const actions = resolutionActions(node)
  const inputs = {
    type: 'object',
    properties: Object.fromEntries(node.inputDefinitions.map((port) => [port.handle, {}])),
    required: node.inputDefinitions.map((port) => port.handle),
    additionalProperties: false,
  }

  return {
    pending: objectPort({
      inputs,
      prompt: { type: 'string' },
      ...Object.fromEntries(actions.map((action) => [`${action}Url`, { type: 'string' }])),
      expiresAt: { type: 'string' },
    }),
    ...Object.fromEntries(
      actions.map((action) => [
        action,
        objectPort({
          inputs,
          action: { const: action },
          resolvedAt: { type: 'string' },
          comment: { type: ['string', 'null'] },
        }),
      ]),
    ),
  }
}

export function nodeOutputPorts(document: FlowDocument, node: GraphNode): Readonly<Record<string, PortDefinition>> {
  switch (node.kind) {
    case 'condition':
      return {}
    case 'value':
      return portsByHandle(node.values)
    case 'subflow':
      return portsByHandle(document.subflows[node.subflowId]?.outputs ?? [])
    case 'task':
      return portsByHandle(node.task != null ? node.task.outputs : (document.tasks[node.taskId]?.outputs ?? []))
    case 'approval':
    case 'wait':
      return resolutionOutputPorts(node)
    case 'cron':
    case 'integration':
    case 'poll':
    case 'manual':
    case 'webhook':
      return triggerOutputPorts(node)
  }
}

export function nodeOutputDescription(document: FlowDocument, graph: Graph, nodeId: string, output: string): string | undefined {
  const node = graph.nodes[nodeId]
  return node == null ? undefined : nodeOutputPorts(document, node)[output]?.description
}

function checkSource(
  source: BindingSource | FlowSource | NodeSource,
  graph: Graph,
  document: FlowDocument,
  flowInputs: Readonly<Record<string, InputPortDefinition>> | undefined,
  targetInput: InputPortDefinition | undefined,
  path: string,
  diagnostics: Diagnostic[],
): PortDefinition | undefined {
  switch (source.kind) {
    case 'binding':
      if (document.bindings[source.bindingId] == null) {
        diagnostics.push(graphDiagnostic('graph.binding-missing', `Binding "${source.bindingId}" does not exist.`, path, { bindingId: source.bindingId }))
      } else if (document.bindings[source.bindingId].kind != 'variable') {
        diagnostics.push(
          graphDiagnostic('graph.binding-invalid', `Binding "${source.bindingId}" must be an environment variable.`, path, { bindingId: source.bindingId }),
        )
      } else if (targetInput != null && !variableInputCompatible(targetInput.jsonSchema)) {
        diagnostics.push(
          graphDiagnostic('graph.variable-incompatible', `Environment variable binding "${source.bindingId}" is not compatible with this input.`, path, {
            bindingId: source.bindingId,
          }),
        )
      }
      return
    case 'flow': {
      const input = flowInputs != null && Object.hasOwn(flowInputs, source.input) ? flowInputs[source.input] : undefined
      if (input == null) {
        diagnostics.push(
          graphDiagnostic('graph.source-missing', `Flow input "${source.input}" does not exist in this graph.`, path, {
            input: source.input,
            variant: 'flow-input',
          }),
        )
      } else if (targetInput != null) {
        const comparison = comparePorts(input, targetInput)
        if (comparison.kind != 'compatible') {
          diagnostics.push(
            graphDiagnostic(
              'graph.flow-input-incompatible',
              `Flow input "${source.input}" is not compatible with this input.`,
              path,
              { input: source.input },
              comparison.kind == 'incompatible' ? comparison.mismatch : undefined,
            ),
          )
        }
      }
      return input
    }
    case 'node': {
      const upstream = graph.nodes[source.nodeId]
      if (upstream == null) {
        diagnostics.push(
          graphDiagnostic('graph.source-missing', `Upstream node "${source.nodeId}" does not exist.`, path, {
            nodeId: source.nodeId,
            variant: 'node',
          }),
        )
        return
      }
      const output = nodeOutputPorts(document, upstream)[source.output]
      if (output == null) {
        diagnostics.push(
          graphDiagnostic('graph.source-missing', `Upstream node "${source.nodeId}" does not expose output "${source.output}".`, path, {
            nodeId: source.nodeId,
            output: source.output,
            variant: 'output',
          }),
        )
      }
      if (output == null) return
      const selected = sourcePort(output, source.field)
      if (selected == null) {
        diagnostics.push(
          graphDiagnostic('graph.source-missing', `Output "${source.output}" does not declare field ${JSON.stringify(source.field)}.`, path, {
            nodeId: source.nodeId,
            output: source.output,
            field: source.field!,
            variant: 'field',
          }),
        )
        return
      }
      if (targetInput != null) {
        const comparison = comparePorts(selected, targetInput)
        if (comparison.kind != 'compatible') {
          diagnostics.push(
            graphDiagnostic(
              'graph.node-output-incompatible',
              `Upstream node "${source.nodeId}" output ${JSON.stringify(sourceOutputLabel(source))} is not compatible with this input.`,
              path,
              { nodeId: source.nodeId, output: source.output, ...(source.field === undefined ? {} : { field: source.field }) },
              comparison.kind == 'incompatible' ? comparison.mismatch : undefined,
            ),
          )
        }
      }
      return selected
    }
  }
}

export function graphOrder(graph: Graph): readonly string[] {
  const pending = new Map(Object.keys(graph.nodes).map((id) => [id, new Set<string>()]))
  const children = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (!pending.has(edge.source) || !pending.has(edge.target)) continue
    pending.get(edge.target)?.add(edge.source)
    const targets = children.get(edge.source) ?? new Set<string>()
    targets.add(edge.target)
    children.set(edge.source, targets)
  }
  const ready = [...pending]
    .filter(([, parents]) => parents.size == 0)
    .map(([id]) => id)
    .toSorted()
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index]!
    pending.delete(id)
    for (const child of children.get(id) ?? []) {
      const parents = pending.get(child)
      parents?.delete(id)
      if (parents?.size == 0) ready.push(child)
    }
  }
  return [...ready, ...[...pending.keys()].toSorted()]
}

const pathsByGraph = new WeakMap<
  Graph,
  {
    readonly paths: Map<string, readonly Route[]>
    readonly ancestors: Map<string, Set<string>>
    readonly resolutionOutputs: Map<string, Set<string>>
  }
>()

// Each route fixes branch choices by node ID; $trigger identifies the selected trigger.
// An absent key leaves that choice unrestricted, so {} covers every execution path.
type Route = Readonly<Record<string, string>>

function routeCovers(route: Route, target: Route): boolean {
  return Object.entries(route).every(([key, value]) => target[key] == value)
}

function routesCompatible(left: Route, right: Route): boolean {
  return Object.entries(left).every(([key, value]) => right[key] == null || right[key] == value)
}

function resolutionOutputKey(nodeId: string, output: string): string {
  return JSON.stringify([nodeId, output])
}

function graphPaths(graph: Graph) {
  const cached = pathsByGraph.get(graph)
  if (cached != null) return cached
  const paths = new Map<string, readonly Route[]>()
  const ancestors = new Map<string, Set<string>>()
  const resolutionOutputs = new Map<string, Set<string>>()
  const incoming = new Map<string, Graph['edges'][number][]>()
  for (const edge of graph.edges) {
    const edges = incoming.get(edge.target) ?? []
    edges.push(edge)
    incoming.set(edge.target, edges)
  }
  const order = graphOrder(graph)
  let changed = true
  while (changed) {
    changed = false
    for (const id of order) {
      const node = graph.nodes[id]!
      const edges = incoming.get(id) ?? []
      const parents = new Set<string>()
      const resolutions = new Set<string>()
      const routes: Route[] = []
      for (const edge of edges) {
        parents.add(edge.source)
        for (const output of resolutionOutputs.get(edge.source) ?? []) resolutions.add(output)
        if (isResolutionNode(graph.nodes[edge.source]) && edge.sourceHandle != null) resolutions.add(resolutionOutputKey(edge.source, edge.sourceHandle))
        for (const parent of ancestors.get(edge.source) ?? []) parents.add(parent)
        for (const route of paths.get(edge.source) ?? []) {
          const next =
            edge.sourceHandle == null || (isResolutionNode(graph.nodes[edge.source]) && edge.sourceHandle == 'pending')
              ? route
              : {
                  ...route,
                  [edge.source]:
                    graph.nodes[edge.source]?.kind == 'condition' &&
                    (graph.nodes[edge.source] as import('./change.ts').ConditionNode).matchMode == 'all' &&
                    edge.sourceHandle != otherwiseOutput
                      ? '$matched'
                      : edge.sourceHandle,
                }
          if (routes.some((known) => routeCovers(known, next))) continue
          for (let index = routes.length - 1; index >= 0; index--) {
            if (routeCovers(next, routes[index]!)) routes.splice(index, 1)
          }
          routes.push(next)
        }
      }
      const nextRoutes = edges.length == 0 ? ('inputs' in node ? [{}] : [{ $trigger: id }]) : routes
      const previous = paths.get(id) ?? []
      if (
        parents.size != (ancestors.get(id)?.size ?? 0) ||
        resolutions.size != (resolutionOutputs.get(id)?.size ?? 0) ||
        nextRoutes.length != previous.length ||
        nextRoutes.some((route) => !previous.some((known) => routeCovers(known, route) && routeCovers(route, known)))
      )
        changed = true
      ancestors.set(id, parents)
      resolutionOutputs.set(id, resolutions)
      paths.set(id, nextRoutes)
    }
  }
  const analysis = { ancestors, paths, resolutionOutputs }
  pathsByGraph.set(graph, analysis)
  return analysis
}

function sourcePaths(graph: Graph, paths: ReturnType<typeof graphPaths>['paths'], source: BindingSource | FlowSource | NodeSource) {
  if (source.kind != 'node') return [{}]
  const node = graph.nodes[source.nodeId]
  const routes = paths.get(source.nodeId) ?? []
  return node?.kind == 'condition' || (isResolutionNode(node) && source.output != 'pending')
    ? routes.map((route) => ({ ...route, [source.nodeId]: source.output }))
    : routes
}

function mappingAvailable(graph: Graph, target: string | undefined, mapping: InputMapping, analysis: ReturnType<typeof graphPaths>): boolean {
  if (mapping.kind == 'value') return true
  const { ancestors, paths } = analysis
  if (target != null && mapping.sources.some((source) => source.kind == 'node' && !ancestors.get(target)?.has(source.nodeId))) return false
  if (
    target != null &&
    mapping.sources.some(
      (source) =>
        source.kind == 'node' &&
        isResolutionNode(graph.nodes[source.nodeId]) &&
        !analysis.resolutionOutputs.get(target)?.has(resolutionOutputKey(source.nodeId, source.output)),
    )
  )
    return false
  const sources = mapping.sources.map((source) => sourcePaths(graph, paths, source))
  const targetPaths = target == null ? [{}] : (paths.get(target) ?? [])
  // Sources may be absent, but must never overlap on the same execution path.
  for (const [index, routes] of sources.entries()) {
    for (const [offset, other] of sources.slice(index + 1).entries()) {
      const leftSource = mapping.sources[index]!
      const rightSource = mapping.sources[index + offset + 1]!
      if (
        target != null &&
        leftSource.kind == 'node' &&
        rightSource.kind == 'node' &&
        leftSource.nodeId != rightSource.nodeId &&
        !ancestors.get(leftSource.nodeId)?.has(rightSource.nodeId) &&
        !ancestors.get(rightSource.nodeId)?.has(leftSource.nodeId)
      )
        continue
      for (const left of routes) {
        for (const targetRoute of targetPaths) {
          if (!routesCompatible(left, targetRoute)) continue
          const path = { ...targetRoute, ...left }
          if (other.some((right) => routesCompatible(right, path))) return false
        }
      }
    }
  }
  return true
}

export type InputSourceCheck =
  | { readonly kind: 'available' }
  | { readonly kind: 'source-missing' }
  | { readonly kind: 'output-missing' }
  | { readonly kind: 'field-missing' }
  | { readonly kind: 'not-ready' }
  | { readonly kind: 'schema'; readonly mismatch: SchemaMismatch }
  | { readonly kind: 'schema-error' }

export type InputSourceCandidateCheck = Extract<InputSourceCheck, { readonly kind: 'available' | 'schema' | 'schema-error' }>

interface InputSourceFieldCandidate {
  readonly description?: string
  readonly output: string
  readonly field: string
  readonly check: InputSourceCandidateCheck
}

export interface InputSourceCandidate {
  readonly description?: string
  readonly field?: string
  readonly fields?: readonly InputSourceFieldCandidate[]
  readonly output: string
  readonly check: InputSourceCandidateCheck
}

export interface InputSourcesCheck {
  readonly conflict: boolean
  readonly sources: readonly InputSourceCheck[]
}

function sourceCompatibility(source: PortDefinition, input: PortDefinition): InputSourceCandidateCheck {
  const result = comparePorts(source, input)
  if (result.kind == 'compatible') return { kind: 'available' }
  return result.kind == 'incompatible' ? { kind: 'schema', mismatch: result.mismatch } : { kind: 'schema-error' }
}

/** Check one saved binding without enumerating candidate ports. */
export function checkInputSource(
  document: FlowDocument,
  graph: Graph,
  target: string,
  handle: string,
  source: Pick<NodeSource, 'nodeId' | 'output' | 'field'>,
): InputSourceCheck {
  const node = graph.nodes[source.nodeId]
  const targetNode = graph.nodes[target]
  if (node == null) return { kind: 'source-missing' }
  if (targetNode == null) return { kind: 'not-ready' }
  const output = nodeOutputPorts(document, node)[source.output]
  const input = nodeInputPorts(document, targetNode)[handle]
  if (output == null) return { kind: 'output-missing' }
  if (input == null) return { kind: 'not-ready' }
  const analysis = graphPaths(graph)
  if (analysis.ancestors.get(target)?.has(source.nodeId) !== true) return { kind: 'not-ready' }
  if (isResolutionNode(node) && !analysis.resolutionOutputs.get(target)?.has(resolutionOutputKey(source.nodeId, source.output))) return { kind: 'not-ready' }
  const selected = sourcePort(output, source.field)
  if (selected == null) return { kind: 'field-missing' }
  return sourceCompatibility(selected, input)
}

export function checkInputSources(
  document: FlowDocument,
  graph: Graph,
  target: string,
  handle: string,
  sources: readonly Pick<NodeSource, 'nodeId' | 'output' | 'field'>[],
): InputSourcesCheck {
  const checks = sources.map((source) => checkInputSource(document, graph, target, handle, source))
  const conflict =
    checks.length > 1 &&
    checks.every((check) => check.kind == 'available') &&
    !mappingAvailable(graph, target, { kind: 'sources', sources: sources.map((source) => ({ kind: 'node', ...source })) }, graphPaths(graph))
  return { conflict, sources: checks }
}

/** Enumerate structurally available outputs while retaining their compatibility with one input. */
export function inputSourceCandidates(
  document: FlowDocument,
  graph: Graph,
  target: string,
  handle: string,
): Readonly<Record<string, readonly InputSourceCandidate[]>> {
  const targetNode = graph.nodes[target]
  const input = targetNode == null ? undefined : nodeInputPorts(document, targetNode)[handle]
  if (input == null) return {}
  const analysis = graphPaths(graph)
  return Object.fromEntries(
    [...(analysis.ancestors.get(target) ?? [])].flatMap((nodeId) => {
      const node = graph.nodes[nodeId]
      if (node == null) return []
      const outputs = Object.entries(nodeOutputPorts(document, node)).flatMap(([output, definition]) => {
        if (!mappingAvailable(graph, target, { kind: 'sources', sources: [{ kind: 'node', nodeId, output }] }, analysis)) return []
        const check = sourceCompatibility(definition, input)
        const fields = sourceFields(definition).map(({ field, port }) =>
          Object.assign({ output, field, check: sourceCompatibility(port, input) }, port.description == null ? {} : { description: port.description }),
        )
        return [{ ...(definition.description == null ? {} : { description: definition.description }), output, check, ...(fields.length > 0 ? { fields } : {}) }]
      })
      return outputs.length == 0 ? [] : [[nodeId, outputs]]
    }),
  )
}

export function availableOutputs(document: FlowDocument, graph: Graph, target: string, handle?: string): Readonly<Record<string, readonly string[]>> {
  const analysis = graphPaths(graph)
  return Object.fromEntries(
    [...(analysis.ancestors.get(target) ?? [])].flatMap((id) => {
      const node = graph.nodes[id]
      if (node == null) return []
      const outputs = Object.keys(nodeOutputPorts(document, node)).filter(
        (output) =>
          mappingAvailable(graph, target, { kind: 'sources', sources: [{ kind: 'node', nodeId: id, output }] }, analysis) &&
          (handle == null || portsAssignable(nodeOutputPorts(document, node)[output]!, nodeInputPorts(document, graph.nodes[target]!)[handle]!)),
      )
      return outputs.length == 0 ? [] : [[id, outputs]]
    }),
  )
}

function validateResolution(
  nodeId: string,
  node: Extract<GraphNode, { readonly kind: 'approval' | 'wait' }>,
  allowed: boolean,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const fields = new Set(['description', 'icon', 'inputDefinitions', 'inputs', 'kind', 'maxExecutions', 'name', 'prompt'])
  const label = node.kind == 'wait' ? 'Wait' : 'Approval'
  const unsupported = Object.keys(node).filter((field) => !fields.has(field))
  if (unsupported.length > 0) {
    diagnostics.push(
      graphDiagnostic(`${node.kind}.field-unsupported`, `${label} node "${nodeId}" contains unsupported fields: ${unsupported.join(', ')}.`, path, {
        fields: unsupported.join(', '),
        nodeId,
      }),
    )
  }
  if (!allowed) diagnostics.push(graphDiagnostic(`${node.kind}.not-allowed`, `${label} nodes are only allowed in Flows.`, path))
  const names = node.inputDefinitions.map((port) => port.handle)
  if (new Set(names).size != names.length)
    diagnostics.push(graphDiagnostic(`${node.kind}.input-invalid`, `${label} input names must be unique.`, `${path}/inputDefinitions`))
  if (typeof node.prompt != 'string' || node.prompt.trim().length == 0 || [...node.prompt].length > 1_000) {
    diagnostics.push(graphDiagnostic(`${node.kind}.prompt-invalid`, `${label} prompt must contain between 1 and 1,000 Unicode code points.`, `${path}/prompt`))
  }
}

function validateGraph(
  graph: Graph,
  document: FlowDocument,
  flowInputs: Readonly<Record<string, InputPortDefinition>> | undefined,
  allowTriggers: boolean,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const analysis = graphPaths(graph)
  const manualTriggers = Object.entries(graph.nodes).filter(([, node]) => node.kind == 'manual')
  if (manualTriggers.length > 1) {
    for (const [nodeId] of manualTriggers) {
      diagnostics.push(graphDiagnostic('graph.manual-trigger-duplicate', 'A graph can contain only one manual Trigger.', `${path}/nodes/${nodeId}`))
    }
  }
  const seen = new Set<string>()
  for (const [index, edge] of graph.edges.entries()) {
    const edgePath = `${path}/edges/${index}`
    const source = graph.nodes[edge.source]
    const target = graph.nodes[edge.target]
    if (source == null || target == null || !('inputs' in target)) {
      diagnostics.push(graphDiagnostic('graph.edge-invalid', 'Execution edges require an existing source and an executable target.', edgePath))
    } else if (source.kind == 'condition' || isResolutionNode(source)) {
      const exits = isResolutionNode(source) ? Object.keys(resolutionOutputPorts(source)) : [...source.cases.map((item) => item.output), otherwiseOutput]
      if (edge.sourceHandle == null || !exits.some((exit) => exit == edge.sourceHandle)) {
        diagnostics.push(graphDiagnostic('graph.edge-invalid', 'Choose a declared execution branch.', edgePath))
      }
    } else if (edge.sourceHandle != null) {
      diagnostics.push(graphDiagnostic('graph.edge-invalid', 'Ordinary execution edges do not select a data output.', edgePath))
    }
    const key = JSON.stringify([edge.source, edge.sourceHandle, edge.target])
    if (seen.has(key)) diagnostics.push(graphDiagnostic('graph.edge-duplicate', 'Execution edge is duplicated.', edgePath))
    seen.add(key)
  }
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    const nodePath = `${path}/nodes/${nodeId}`
    if ('inputs' in node && node.maxExecutions != null && (!Number.isSafeInteger(node.maxExecutions) || node.maxExecutions < 1)) {
      diagnostics.push(graphDiagnostic('node.max-executions-invalid', 'Maximum executions must be a positive safe integer.', `${nodePath}/maxExecutions`))
    }
    if (!('inputs' in node)) {
      if (triggerOutputDefinitions(node).some((port) => hasRetiredRef(port.jsonSchema))) {
        diagnostics.push(graphDiagnostic('graph.schema-unsupported', 'Runtime Ref schemas are not supported.', nodePath))
      }
      if (!allowTriggers) {
        diagnostics.push(graphDiagnostic('graph.trigger-not-allowed', 'Trigger nodes are only allowed in Flows.', nodePath))
      } else {
        validateTrigger(nodeId, node, document, nodePath, diagnostics)
      }
      continue
    }
    if (node.kind == 'task' && node.task == null && document.tasks[node.taskId] == null) {
      diagnostics.push(
        graphDiagnostic('graph.target-missing', `Task "${node.taskId}" does not exist.`, `${nodePath}/taskId`, {
          taskId: node.taskId,
          variant: 'task',
        }),
      )
    } else if (node.kind == 'subflow' && document.subflows[node.subflowId] == null) {
      diagnostics.push(
        graphDiagnostic('graph.target-missing', `Subflow "${node.subflowId}" does not exist.`, `${nodePath}/subflowId`, {
          subflowId: node.subflowId,
          variant: 'subflow',
        }),
      )
    }
    for (const [handle, mapping] of Object.entries(nodeInputMappings(node))) {
      if (!mappingAvailable(graph, nodeId, mapping, analysis))
        diagnostics.push(
          graphDiagnostic(
            'graph.source-unavailable',
            'Input sources must reference execution ancestors, respect pending Wait decisions, and never provide multiple values on the same path.',
            `${nodePath}/inputs/${handle}`,
          ),
        )
    }
    const inputPorts = nodeInputPorts(document, node)
    if (node.kind == 'task') {
      const ports = [...(node.task != null ? node.task.inputs : (document.tasks[node.taskId]?.inputs ?? [])), ...(node.additionalInputs ?? [])]
      const handles = new Set<string>()
      for (const port of ports) {
        if (!('handle' in port)) continue
        if (handles.has(port.handle)) {
          diagnostics.push(
            graphDiagnostic('graph.input-duplicate', `Node "${nodeId}" declares input "${port.handle}" more than once.`, nodePath, {
              handle: port.handle,
              nodeId,
            }),
          )
        }
        handles.add(port.handle)
      }
    }
    const ports = [...Object.values(inputPorts), ...Object.values(nodeOutputPorts(document, node))]
    if (ports.some((port) => hasRetiredRef(port.jsonSchema))) {
      diagnostics.push(graphDiagnostic('graph.schema-unsupported', 'Runtime Ref schemas are not supported.', nodePath))
    }
    const inputs = new Set(Object.keys(inputPorts))
    for (const [handle, mapping] of Object.entries(nodeInputMappings(node))) {
      const mappingPath = `${nodePath}/inputs/${handle}`
      if (!inputs.has(handle)) {
        diagnostics.push(graphDiagnostic('graph.input-missing', `Node "${nodeId}" does not expose input "${handle}".`, mappingPath, { handle, nodeId }))
      }
      if (mapping.kind == 'sources') {
        const variableSources = mapping.sources.filter((source) => source.kind == 'binding' && document.bindings[source.bindingId]?.kind == 'variable')
        if (variableSources.length > 0 && (variableSources.length != 1 || mapping.sources.length != 1)) {
          diagnostics.push(graphDiagnostic('graph.variable-source-mixed', 'An environment variable must be the only source for an input.', mappingPath))
        }
        for (const source of mapping.sources) checkSource(source, graph, document, flowInputs, inputPorts[handle], mappingPath, diagnostics)
      }
    }
    if (isResolutionNode(node)) validateResolution(nodeId, node, allowTriggers, nodePath, diagnostics)
    if (node.kind != 'condition') continue
    if (Object.keys(node.inputs).length > 0)
      diagnostics.push(graphDiagnostic('condition.invalid', 'Condition cannot declare node inputs.', nodePath, { variant: 'inputs' }))
    const outputs = new Set<string>([otherwiseOutput])
    for (const [index, condition] of node.cases.entries()) {
      const casePath = `${nodePath}/cases/${index}`
      if (condition.output.trim().length == 0 || condition.output == '__proto__' || outputs.has(condition.output))
        diagnostics.push(
          graphDiagnostic('condition.invalid', 'Case output must be nonempty, unique, and not reserved.', `${casePath}/output`, { variant: 'output' }),
        )
      outputs.add(condition.output)
      if (condition.groups.length == 0)
        diagnostics.push(graphDiagnostic('condition.invalid', 'Case requires at least one group.', casePath, { variant: 'case' }))
      for (const [g, group] of condition.groups.entries()) {
        const groupPath = `${casePath}/groups/${g}`
        if (group.expressions.length == 0)
          diagnostics.push(graphDiagnostic('condition.invalid', 'Group requires at least one expression.', groupPath, { variant: 'group' }))
        for (const [e, expression] of group.expressions.entries()) {
          const expressionPath = `${groupPath}/expressions/${e}`
          const type = (operand: typeof expression.left | undefined): string | undefined => {
            if (operand == null || (operand.kind == 'value' && operand.value === undefined)) {
              diagnostics.push(graphDiagnostic('condition.invalid', 'Condition operand is incomplete.', expressionPath, { variant: 'operand' }))
              return
            }
            if (operand.kind == 'value') {
              if (operand.jsonSchema != null && !matchesSchema(operand.value!, operand.jsonSchema))
                diagnostics.push(graphDiagnostic('condition.invalid', 'Operand does not match its declared schema.', expressionPath, { variant: 'schema' }))
              return valueType(operand.value!)
            }
            if (operand.source.kind === 'binding') return 'string'
            const port = checkSource(operand.source, graph, document, flowInputs, undefined, expressionPath, [])
            const raw = schemaObject(port?.jsonSchema ?? {})?.type
            return typeof raw == 'string' ? raw : undefined
          }
          const left = type(expression.left)
          const right = unaryOperator(expression.operator) ? undefined : type(expression.right)
          if (unaryOperator(expression.operator) && expression.right != null)
            diagnostics.push(graphDiagnostic('condition.invalid', 'Unary operators cannot have a right operand.', expressionPath, { variant: 'unary' }))
          const issue = comparisonIssue(expression.operator, left, right)
          if (issue != null) diagnostics.push(graphDiagnostic('condition.invalid', issue.message, expressionPath, { variant: 'type' }))
        }
      }
    }
  }
}

function validateSubflowCycles(document: FlowDocument, diagnostics: Diagnostic[]): void {
  const visited = new Set<string>()
  const stack: string[] = []

  function visitGraph(graph: Graph, path: string): void {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      if (node.kind != 'subflow' || document.subflows[node.subflowId] == null) continue
      const cycle = stack.indexOf(node.subflowId)
      if (cycle >= 0) {
        const subflows = [...stack.slice(cycle), node.subflowId].join(' -> ')
        diagnostics.push(graphDiagnostic('subflow.cycle', `Subflow cycle is not executable: ${subflows}.`, `${path}/nodes/${nodeId}/subflowId`, { subflows }))
        continue
      }
      if (visited.has(node.subflowId)) continue
      visited.add(node.subflowId)
      stack.push(node.subflowId)
      visitGraph(document.subflows[node.subflowId].graph, `/document/subflows/${node.subflowId}/graph`)
      stack.pop()
    }
  }

  visitGraph(document.graph, '/document/graph')
}

export function validateFlowGraph(revision: RevisionContent, closure: SemanticClosure): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const [bindingId, binding] of Object.entries(revision.document.bindings)) {
    if (binding.kind == 'variable' && !validVariableName(binding.target)) {
      diagnostics.push(
        graphDiagnostic(
          'binding.variable-invalid',
          `Environment variable binding "${bindingId}" has an invalid target.`,
          `/document/bindings/${bindingId}/target`,
          {
            bindingId,
          },
        ),
      )
    }
  }
  validateGraph(revision.document.graph, revision.document, undefined, true, '/document/graph', diagnostics)
  for (const subflowId of [...closure.dependencies.subflows].toSorted()) {
    const subflow = revision.document.subflows[subflowId]
    if (subflow == null) continue
    const path = `/document/subflows/${subflowId}`
    const inputs = portsByHandle(subflow.inputs)
    validateGraph(subflow.graph, revision.document, inputs, false, `${path}/graph`, diagnostics)
    for (const output of subflow.outputs) {
      if (!mappingAvailable(subflow.graph, undefined, { kind: 'sources', sources: output.sources }, graphPaths(subflow.graph))) {
        diagnostics.push(
          graphDiagnostic(
            'graph.source-unavailable',
            'Subflow output sources must not provide multiple final values.',
            `${path}/outputs/${output.handle}/sources`,
          ),
        )
      }
      for (const source of output.sources) {
        const selectedPort = checkSource(source, subflow.graph, revision.document, inputs, undefined, `${path}/outputs/${output.handle}/sources`, diagnostics)
        const comparison = selectedPort == null ? undefined : comparePorts(selectedPort, output)
        if (comparison != null && comparison.kind != 'compatible') {
          diagnostics.push(
            graphDiagnostic(
              'graph.subflow-output-incompatible',
              `A source is not compatible with Subflow output "${output.handle}".`,
              `${path}/outputs/${output.handle}/sources`,
              { output: output.handle },
              comparison.kind == 'incompatible' ? comparison.mismatch : undefined,
            ),
          )
        }
      }
    }
  }
  validateSubflowCycles(revision.document, diagnostics)
  return diagnostics
}
