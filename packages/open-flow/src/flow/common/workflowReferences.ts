import type { GraphNode } from './change.ts'
import type { WorkflowCapability } from './model.ts'

type WorkflowTarget = Pick<WorkflowCapability, 'flowId' | 'revisionId'>

/** Rewrite only declared workflow identities, preserving business values and saved ports. */
export function mapNodeWorkflowTargets(node: GraphNode, map: (target: WorkflowTarget) => WorkflowTarget): GraphNode {
  if (node.kind != 'task') return node
  const task = node.task
  if ('moduleId' in task)
    return task.capabilities?.some((item) => item.kind == 'workflow')
      ? { ...node, task: { ...task, capabilities: task.capabilities.map((item) => (item.kind == 'workflow' ? Object.assign({}, item, map(item)) : item)) } }
      : node
  const executor = task.executor
  if (executor.kind == 'workflow') return { ...node, task: { ...task, executor: { ...executor, ...map(executor) } } }
  if (executor.kind == 'agent')
    return {
      ...node,
      task: { ...task, executor: { ...executor, tools: executor.tools.map((tool) => (tool.kind == 'workflow' ? Object.assign({}, tool, map(tool)) : tool)) } },
    }
  return node
}

/** Workflow declarations share discovery across authoring, admission and resource indexing. */
export function nodeWorkflowReferences(node: GraphNode): readonly {
  readonly target: Omit<WorkflowCapability, 'kind' | 'name'>
  readonly path: string
  readonly tool?: string
}[] {
  if (node.kind != 'task') return []
  if ('moduleId' in node.task)
    return (node.task.capabilities ?? []).flatMap((item, index) =>
      item.kind == 'workflow' ? [{ target: item, path: `task/capabilities/${index}`, tool: item.name }] : [],
    )
  if (node.task.executor.kind == 'workflow')
    return [
      {
        target: {
          ...node.task.executor,
          inputs: node.task.inputs.filter((port) => 'handle' in port),
          outputs: node.task.outputs.filter((port) => 'handle' in port),
        },
        path: 'task/executor',
      },
    ]
  if (node.task.executor.kind == 'agent')
    return node.task.executor.tools.flatMap((item, index) =>
      item.kind == 'workflow' ? [{ target: item, path: `task/executor/tools/${index}`, tool: item.name }] : [],
    )
  return []
}
