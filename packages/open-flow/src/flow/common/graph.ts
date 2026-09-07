import type {
  BindingSource,
  FlowDocument,
  FlowSource,
  Graph,
  GraphNode,
  InputMapping,
  InputPortDefinition,
  NodeSource,
  PortDefinition,
  RevisionContent,
  TriggerNode,
} from './change.ts'
import type { Diagnostic, SemanticClosure } from './semantics.ts'

import { portsByHandle, validVariableName } from './change.ts'
import { triggerPayloadSchema, schemaObject, schemaList, matchesSchema, portsAssignable, variableInputCompatible, hasRetiredRef } from './schema.ts'
function graphDiagnostic(code: string, message: string, path: string, values?: Readonly<Record<string, string | number>>): Diagnostic {
  return { code, column: 0, line: 1, message, path, ...(values == null ? {} : { values }) }
}

function validateTrigger(triggerId: string, trigger: TriggerNode, document: FlowDocument, path: string, diagnostics: Diagnostic[]): void {
  if (trigger.kind == 'webhook') {
    const handles = new Set<string>()
    for (const [index, input] of trigger.inputsDef.entries()) {
      if (handles.has(input.handle)) {
        diagnostics.push(
          graphDiagnostic(
            'trigger.input-duplicate',
            `Webhook Trigger input "${input.handle}" is declared more than once.`,
            `${path}/inputsDef/${index}/handle`,
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
  const configSchema = schemaObject(trigger.definition.configSchema)
  const missingConfig =
    schemaList(configSchema?.required)?.filter((name): name is string => typeof name == 'string' && !Object.hasOwn(trigger.config, name)) ?? []
  if (missingConfig.length > 0) {
    diagnostics.push(
      graphDiagnostic('trigger.config-incomplete', `Complete the required Trigger config fields: ${missingConfig.join(', ')}.`, `${path}/config`, {
        fields: missingConfig.join(', '),
      }),
    )
  } else if (!matchesSchema(trigger.config, trigger.definition.configSchema)) {
    diagnostics.push(
      graphDiagnostic('trigger.config-invalid', `Trigger "${triggerId}" config does not match its fixed definition.`, `${path}/config`, { triggerId }),
    )
  }
}

export function nodeInputPorts(document: FlowDocument, node: GraphNode): Readonly<Record<string, InputPortDefinition>> {
  switch (node.kind) {
    case 'condition':
      return { [node.input.handle]: node.input }
    case 'value':
      return {}
    case 'subflow':
      return portsByHandle(document.subflows[node.subflowId]?.inputs ?? [])
    case 'task':
      return portsByHandle([...(node.task != null ? node.task.inputs : (document.tasks[node.taskId]?.inputs ?? [])), ...(node.additionalInputs ?? [])])
    case 'wait':
      return { [node.input.handle]: node.input }
    case 'cron':
    case 'integration':
    case 'poll':
    case 'manual':
    case 'webhook':
      return {}
  }
}

function nodeOutputPorts(document: FlowDocument, node: GraphNode): Readonly<Record<string, PortDefinition>> {
  switch (node.kind) {
    case 'condition': {
      const outputs = [...node.cases.map((condition) => condition.output), ...(node.defaultOutput == null ? [] : [node.defaultOutput])]
      return Object.fromEntries(outputs.map((handle) => [handle, node.input]))
    }
    case 'value':
      return portsByHandle(node.values)
    case 'subflow':
      return portsByHandle(document.subflows[node.subflowId]?.outputs ?? [])
    case 'task':
      return portsByHandle(node.task != null ? node.task.outputs : (document.tasks[node.taskId]?.outputs ?? []))
    case 'wait':
      return Object.fromEntries(node.actions.map((action) => [action, node.input]))
    case 'cron':
    case 'integration':
    case 'poll':
    case 'manual':
    case 'webhook':
      return { payload: { jsonSchema: triggerPayloadSchema(node), nullable: false } }
  }
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
        diagnostics.push(graphDiagnostic('graph.binding-invalid', `Binding "${source.bindingId}" must be a Variable.`, path, { bindingId: source.bindingId }))
      } else if (targetInput != null && !variableInputCompatible(targetInput.jsonSchema)) {
        diagnostics.push(
          graphDiagnostic('graph.variable-incompatible', `Variable binding "${source.bindingId}" is not compatible with this input.`, path, {
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
      } else if (targetInput != null && !portsAssignable(input, targetInput)) {
        diagnostics.push(
          graphDiagnostic('graph.flow-input-incompatible', `Flow input "${source.input}" is not compatible with this input.`, path, {
            input: source.input,
          }),
        )
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
      } else if (targetInput != null && !portsAssignable(output, targetInput)) {
        diagnostics.push(
          graphDiagnostic(
            'graph.node-output-incompatible',
            `Upstream node "${source.nodeId}" output "${source.output}" is not compatible with this input.`,
            path,
            { nodeId: source.nodeId, output: source.output },
          ),
        )
      }
      return output
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
  return ready
}

const pathsByGraph = new WeakMap<
  Graph,
  {
    readonly paths: Map<string, readonly Readonly<Record<string, string>>[]>
    readonly ancestors: Map<string, Set<string>>
  }
>()

function graphPaths(graph: Graph) {
  const cached = pathsByGraph.get(graph)
  if (cached != null) return cached
  const paths = new Map<string, readonly Readonly<Record<string, string>>[]>()
  const ancestors = new Map<string, Set<string>>()
  const incoming = new Map<string, Graph['edges'][number][]>()
  for (const edge of graph.edges) {
    const edges = incoming.get(edge.target) ?? []
    edges.push(edge)
    incoming.set(edge.target, edges)
  }
  for (const id of graphOrder(graph)) {
    const node = graph.nodes[id]!
    const edges = incoming.get(id) ?? []
    const parents = new Set<string>()
    const routes: Readonly<Record<string, string>>[] = []
    for (const edge of edges) {
      parents.add(edge.source)
      for (const parent of ancestors.get(edge.source) ?? []) parents.add(parent)
      for (const route of paths.get(edge.source) ?? []) {
        const next = edge.sourceHandle == null ? route : { ...route, [edge.source]: edge.sourceHandle }
        if (routes.some((known) => Object.entries(known).every(([key, value]) => next[key] == value))) continue
        for (let index = routes.length - 1; index >= 0; index--) {
          if (Object.entries(next).every(([key, value]) => routes[index]![key] == value)) routes.splice(index, 1)
        }
        routes.push(next)
      }
    }
    ancestors.set(id, parents)
    paths.set(id, edges.length == 0 ? ('inputs' in node ? [{}] : [{ $trigger: id }]) : routes)
  }
  const analysis = { ancestors, paths }
  pathsByGraph.set(graph, analysis)
  return analysis
}

function sourcePaths(graph: Graph, paths: ReturnType<typeof graphPaths>['paths'], source: BindingSource | FlowSource | NodeSource) {
  if (source.kind != 'node') return [{}]
  const node = graph.nodes[source.nodeId]
  const routes = paths.get(source.nodeId) ?? []
  return node?.kind == 'condition' || node?.kind == 'wait' ? routes.map((route) => ({ ...route, [source.nodeId]: source.output })) : routes
}

function covers(routes: readonly Readonly<Record<string, string>>[], target: Readonly<Record<string, string>>, graph: Graph): boolean {
  const possible = routes.filter((route) => Object.entries(route).every(([key, value]) => target[key] == null || target[key] == value))
  if (possible.some((route) => Object.entries(route).every(([key, value]) => target[key] == value))) return true
  const key = possible.flatMap((route) => Object.keys(route)).find((candidate) => target[candidate] == null)
  if (key == null) return false
  const node = graph.nodes[key]
  const choices =
    node?.kind == 'condition'
      ? [...node.cases.map((item) => item.output), node.defaultOutput ?? '']
      : node?.kind == 'wait'
        ? node.actions
        : ['', ...Object.keys(graph.nodes).filter((id) => !('inputs' in graph.nodes[id]!))]
  return choices.every((value) => covers(possible, { ...target, [key]: value }, graph))
}

function mappingAvailable(graph: Graph, target: string | undefined, mapping: InputMapping, analysis: ReturnType<typeof graphPaths>): boolean {
  if (mapping.kind == 'value') return true
  const { ancestors, paths } = analysis
  if (mapping.sources.length == 0) return false
  if (target != null && mapping.sources.some((source) => source.kind == 'node' && !ancestors.get(target)?.has(source.nodeId))) return false
  const sources = mapping.sources.map((source) => sourcePaths(graph, paths, source))
  const targetPaths = target == null ? [{}] : (paths.get(target) ?? [])
  if (!targetPaths.every((route) => covers(sources.flat(), route, graph))) return false
  return sources.every((routes, index) =>
    sources.slice(index + 1).every((other) =>
      routes.every((left) =>
        other.every((right) =>
          targetPaths.every((targetRoute) => {
            const values = { ...targetRoute, ...left }
            return (
              Object.entries(left).some(([key, value]) => targetRoute[key] != null && targetRoute[key] != value) ||
              Object.entries(right).some(([key, value]) => values[key] != null && values[key] != value)
            )
          }),
        ),
      ),
    ),
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

function validateWait(
  nodeId: string,
  node: Extract<GraphNode, { readonly kind: 'wait' }>,
  graph: Graph,
  document: FlowDocument,
  flowInputs: Readonly<Record<string, InputPortDefinition>> | undefined,
  allowed: boolean,
  path: string,
  diagnostics: Diagnostic[],
): void {
  const fields = new Set(['actions', 'description', 'icon', 'input', 'inputs', 'kind', 'name', 'notification', 'prompt'])
  const unsupported = Object.keys(node).filter((field) => !fields.has(field))
  if (unsupported.length > 0) {
    diagnostics.push(
      graphDiagnostic('wait.field-unsupported', `Wait node "${nodeId}" contains unsupported fields: ${unsupported.join(', ')}.`, path, {
        fields: unsupported.join(', '),
        nodeId,
      }),
    )
  }
  if (!allowed) diagnostics.push(graphDiagnostic('wait.not-allowed', 'Wait nodes are only allowed in Flows.', path))
  if (node.input.handle != 'value') diagnostics.push(graphDiagnostic('wait.input-invalid', 'Wait input handle must be "value".', `${path}/input/handle`))
  if (typeof node.prompt != 'string' || node.prompt.trim().length == 0 || [...node.prompt].length > 1_000) {
    diagnostics.push(graphDiagnostic('wait.prompt-invalid', 'Wait prompt must contain between 1 and 1,000 Unicode code points.', `${path}/prompt`))
  }
  if (
    !Array.isArray(node.actions) ||
    !((node.actions.length == 1 && node.actions[0] == 'continue') || (node.actions.length == 2 && node.actions[0] == 'approve' && node.actions[1] == 'reject'))
  ) {
    diagnostics.push(graphDiagnostic('wait.actions-invalid', 'Wait actions must be ["continue"] or ["approve", "reject"].', `${path}/actions`))
  }
  if (node.notification == null) return
  const notification = node.notification as unknown
  if (typeof notification != 'object' || Array.isArray(notification)) {
    diagnostics.push(graphDiagnostic('wait.notification-invalid', 'Wait notification must be an object.', `${path}/notification`))
    return
  }
  const source = notification as Readonly<Record<string, unknown>>
  if (
    Object.keys(source).length != 3 ||
    !Object.hasOwn(source, 'inputs') ||
    !Object.hasOwn(source, 'messageHandle') ||
    !Object.hasOwn(source, 'taskId') ||
    typeof source.taskId != 'string' ||
    typeof source.messageHandle != 'string' ||
    source.inputs == null ||
    typeof source.inputs != 'object' ||
    Array.isArray(source.inputs)
  ) {
    diagnostics.push(graphDiagnostic('wait.notification-invalid', 'Wait notification has an invalid shape.', `${path}/notification`))
    return
  }
  const task = document.tasks[source.taskId]
  if (task == null) {
    diagnostics.push(
      graphDiagnostic('graph.target-missing', `Task "${source.taskId}" does not exist.`, `${path}/notification/taskId`, {
        taskId: source.taskId,
        variant: 'task',
      }),
    )
    return
  }
  if (task.executor.kind != 'connector') {
    diagnostics.push(graphDiagnostic('wait.notification-task-invalid', 'Wait notification must use a Connector Task.', `${path}/notification/taskId`))
  }
  const ports = portsByHandle(task.inputs)
  if (ports[source.messageHandle] == null) {
    diagnostics.push(
      graphDiagnostic(
        'wait.notification-message-missing',
        `Notification Task "${source.taskId}" does not expose input "${source.messageHandle}".`,
        `${path}/notification/messageHandle`,
      ),
    )
  }
  const inputs = source.inputs as Readonly<Record<string, InputMapping>>
  if (Object.hasOwn(inputs, source.messageHandle)) {
    diagnostics.push(
      graphDiagnostic('wait.notification-message-mapped', 'The notification message input is populated by the system.', `${path}/notification/inputs`),
    )
  }
  for (const [handle, mapping] of Object.entries(inputs)) {
    const inputPath = `${path}/notification/inputs/${handle}`
    const port = ports[handle]
    if (port == null) {
      diagnostics.push(
        graphDiagnostic('graph.input-missing', `Notification Task "${source.taskId}" does not expose input "${handle}".`, inputPath, {
          handle,
          nodeId,
        }),
      )
      continue
    }
    if (mapping.kind == 'sources') for (const candidate of mapping.sources) checkSource(candidate, graph, document, flowInputs, port, inputPath, diagnostics)
  }
  for (const [handle, port] of Object.entries(ports)) {
    if (handle == source.messageHandle || Object.hasOwn(inputs, handle) || Object.hasOwn(port, 'value')) continue
    diagnostics.push(
      graphDiagnostic('wait.notification-input-missing', `Notification input "${handle}" requires a mapping or default value.`, `${path}/notification/inputs`, {
        handle,
      }),
    )
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
    } else if (source.kind == 'condition' || source.kind == 'wait') {
      const exits =
        source.kind == 'wait' ? source.actions : [...source.cases.map((item) => item.output), ...(source.defaultOutput == null ? [] : [source.defaultOutput])]
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
  if (graphOrder(graph).length != Object.keys(graph.nodes).length) {
    diagnostics.push(graphDiagnostic('graph.cycle', 'Graph contains an execution dependency cycle.', path))
  }
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    const nodePath = `${path}/nodes/${nodeId}`
    if (!('inputs' in node)) {
      if (hasRetiredRef(triggerPayloadSchema(node))) {
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
    for (const [handle, mapping] of Object.entries(node.inputs)) {
      if (!mappingAvailable(graph, nodeId, mapping, analysis))
        diagnostics.push(
          graphDiagnostic(
            'graph.source-unavailable',
            'Input sources must provide exactly one value from completed ancestors on every execution path.',
            `${nodePath}/inputs/${handle}`,
          ),
        )
    }
    if (node.kind == 'wait' && node.notification != null) {
      for (const [handle, mapping] of Object.entries(node.notification.inputs)) {
        if (!mappingAvailable(graph, nodeId, mapping, analysis))
          diagnostics.push(
            graphDiagnostic(
              'graph.source-unavailable',
              'Notification sources must provide exactly one value from completed ancestors.',
              `${nodePath}/notification/inputs/${handle}`,
            ),
          )
      }
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
    for (const [handle, mapping] of Object.entries(node.inputs)) {
      const mappingPath = `${nodePath}/inputs/${handle}`
      if (!inputs.has(handle)) {
        diagnostics.push(graphDiagnostic('graph.input-missing', `Node "${nodeId}" does not expose input "${handle}".`, mappingPath, { handle, nodeId }))
      }
      if (mapping.kind == 'sources') {
        const variableSources = mapping.sources.filter((source) => source.kind == 'binding' && document.bindings[source.bindingId]?.kind == 'variable')
        if (variableSources.length > 0 && (variableSources.length != 1 || mapping.sources.length != 1)) {
          diagnostics.push(graphDiagnostic('graph.variable-source-mixed', 'A Variable must be the only source for an input.', mappingPath))
        }
        for (const source of mapping.sources) checkSource(source, graph, document, flowInputs, inputPorts[handle], mappingPath, diagnostics)
      }
    }
    if (node.kind == 'wait') validateWait(nodeId, node, graph, document, flowInputs, allowTriggers, nodePath, diagnostics)
    if (node.kind != 'condition') continue
    const outputs = new Set<string>()
    for (const [index, condition] of node.cases.entries()) {
      if (outputs.has(condition.output)) {
        diagnostics.push(
          graphDiagnostic(
            'condition.output-duplicate',
            `Condition output "${condition.output}" is declared more than once.`,
            `${nodePath}/cases/${index}/output`,
            { output: condition.output },
          ),
        )
      }
      outputs.add(condition.output)
      for (const [expressionIndex, expression] of condition.expressions.entries()) {
        if (expression.input == node.input.handle) continue
        diagnostics.push(
          graphDiagnostic(
            'condition.input-missing',
            `Condition expression references unknown input "${expression.input}".`,
            `${nodePath}/cases/${index}/expressions/${expressionIndex}/input`,
            { input: expression.input },
          ),
        )
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
        graphDiagnostic('binding.variable-invalid', `Variable binding "${bindingId}" has an invalid target.`, `/document/bindings/${bindingId}/target`, {
          bindingId,
        }),
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
            'Subflow output sources must provide exactly one final value.',
            `${path}/outputs/${output.handle}/sources`,
          ),
        )
      }
      for (const source of output.sources) {
        const sourcePort = checkSource(source, subflow.graph, revision.document, inputs, undefined, `${path}/outputs/${output.handle}/sources`, diagnostics)
        if (sourcePort != null && !portsAssignable(sourcePort, output)) {
          diagnostics.push(
            graphDiagnostic(
              'graph.subflow-output-incompatible',
              `A source is not compatible with Subflow output "${output.handle}".`,
              `${path}/outputs/${output.handle}/sources`,
              { output: output.handle },
            ),
          )
        }
      }
    }
  }
  validateSubflowCycles(revision.document, diagnostics)
  return diagnostics
}
