import type { ConditionOperand, FlowDocument, Graph, GraphNode, Group, InputPort, RevisionContent } from '../../flow/common/change.ts'
import type { ConnectorAction, Draft, Flow, Live } from './api.ts'

import { nodeInputPorts, nodeOutputPorts } from '../../flow/common/graph.ts'

export async function inspectFlowDraft(flow: Flow, readDraft: () => Draft | Promise<Draft>) {
  try {
    return { flow, draft: await readDraft(), version: 1 as const }
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error.code != 'flow.invalid' && error.code != 'flow.revision-upgrade-required')) throw error
    return {
      flow,
      draft: null,
      draftIssue: { code: error.code, message: error.message, revisionId: flow.draftRevisionId },
      version: 1 as const,
    }
  }
}

export function flowInspection(inspected: Awaited<ReturnType<typeof inspectFlowDraft>>, live: Live | undefined, full = false) {
  if (inspected.draft == null) return inspected
  if (full) return { ...inspected, live }
  const { flow, draft } = inspected
  const { document, modules } = draft.content
  return {
    flow: { flowId: flow.flowId, name: flow.name, status: flow.status },
    draft: {
      revisionId: draft.revisionId,
      graph: inspectGraph(document, document.graph),
      subflows: Object.fromEntries(
        Object.entries(document.subflows).map(([id, subflow]) => [
          id,
          {
            name: subflow.name,
            inputs: inspectPorts(subflow.inputs),
            outputs: subflow.outputs.map((port) => ({ handle: port.handle, sources: port.sources })),
            graph: inspectGraph(document, subflow.graph),
          },
        ]),
      ),
      bindings: document.bindings,
      modules: Object.fromEntries(Object.entries(modules).map(([id, module]) => [id, { name: module.name, imports: module.imports }])),
    },
    ...(live == null
      ? {}
      : {
          live: {
            status: live.status,
            hasUnpublishedChanges: live.hasUnpublishedChanges,
            publication:
              live.publication == null
                ? null
                : {
                    publicationId: live.publication.publicationId,
                    revisionId: live.publication.revisionId,
                  },
          },
        }),
    version: 1 as const,
  }
}

function inspectPorts(ports: readonly (InputPort | Group)[]) {
  return ports.flatMap((port) => ('handle' in port ? [{ handle: port.handle, ...(Object.hasOwn(port, 'value') ? { value: port.value } : {}) }] : []))
}

function inspectGraph(document: FlowDocument, graph: Graph) {
  return {
    nodes: Object.fromEntries(Object.entries(graph.nodes).map(([id, node]) => [id, inspectNode(document, node)])),
    edges: graph.edges,
  }
}

function inspectNode(document: FlowDocument, node: GraphNode): Record<string, unknown> {
  const inputs = nodeInputPorts(document, node)
  const defaults = Object.fromEntries(
    Object.entries(inputs).flatMap(([handle, port]) =>
      Object.hasOwn(port, 'value') && !('inputs' in node && Object.hasOwn(node.inputs, handle)) ? [[handle, port.value]] : [],
    ),
  )
  const ports = {
    inputHandles: Object.keys(inputs),
    outputHandles: Object.keys(nodeOutputPorts(document, node)),
    ...(Object.keys(defaults).length == 0 ? {} : { inputDefaults: defaults }),
  }
  switch (node.kind) {
    case 'task': {
      const { task: inline, additionalInputs: _additional, ...instance } = node
      const task = inline ?? document.tasks[node.taskId]
      return {
        ...instance,
        ...ports,
        ...(task == null ? {} : 'executor' in task ? { executor: task.executor } : { moduleId: task.moduleId, capabilities: task.capabilities }),
      }
    }
    case 'poll':
    case 'integration': {
      const { definition, ...instance } = node
      return {
        ...instance,
        ...ports,
        definition: {
          key: definition.key,
          provider: definition.provider,
          definitionVersion: definition.definitionVersion,
          configInputs: inspectPorts(definition.configInputs),
          ...(definition.type == 'integration' ? { endpoint: definition.endpoint } : {}),
        },
      }
    }
    case 'webhook': {
      const { bodyFields, ...instance } = node
      return { ...instance, ...ports, bodyFields: inspectPorts(bodyFields) }
    }
    case 'wait':
    case 'approval': {
      const { inputDefinitions: _definitions, ...instance } = node
      return { ...instance, ...ports }
    }
    case 'value':
      return { ...node, ...ports, values: inspectPorts(node.values) }
    case 'condition':
      return {
        ...node,
        ...ports,
        cases: node.cases.map((branch) => ({
          ...branch,
          groups: branch.groups.map((group) => ({
            expressions: group.expressions.map((expression) => ({
              ...expression,
              left: inspectOperand(expression.left),
              ...(expression.right == null ? {} : { right: inspectOperand(expression.right) }),
            })),
          })),
        })),
      }
    case 'manual':
    case 'cron':
    case 'subflow':
      return { ...node, ...ports }
  }
}

function inspectOperand(operand: ConditionOperand) {
  if (operand.kind == 'source') return operand
  const { jsonSchema: _, ...value } = operand
  return value
}

export function actionSummary(action: ConnectorAction) {
  return {
    actionId: action.actionId,
    authenticated: action.authenticated,
    ...(action.defaultConnection == null
      ? {}
      : {
          defaultConnection: {
            connectionId: action.defaultConnection.connectionId,
            displayName: action.defaultConnection.displayName,
            status: action.defaultConnection.status,
          },
        }),
    description: action.description,
    name: action.name,
    serviceId: action.serviceId,
    serviceName: action.serviceName,
  }
}

export function nodeDetails(
  content: RevisionContent,
  nodeId: string,
  node: GraphNode,
): {
  node: GraphNode
  nodeId: string
  module?: RevisionContent['modules'][string]
  task?: FlowDocument['tasks'][string]
} {
  if (node.kind != 'task') return { node, nodeId }
  if (node.task != null) {
    const module = content.modules[node.task.moduleId]
    return { node, nodeId, ...(module == null ? {} : { module }) }
  }
  const task = content.document.tasks[node.taskId]
  return { node, nodeId, ...(task == null ? {} : { task }) }
}
