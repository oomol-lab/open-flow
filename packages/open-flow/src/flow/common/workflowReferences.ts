import type { GraphNode } from './change.ts'
import type { WorkflowCapability } from './model.ts'

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
