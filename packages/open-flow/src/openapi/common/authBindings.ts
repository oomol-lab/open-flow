import type { FlowDocument } from '../../flow/common/change.ts'

/** Never allow credentials to enter a Revision as literal node inputs. */
export function assertOpenApiAuthBindings(document: FlowDocument): void {
  for (const graph of [document.graph, ...Object.values(document.subflows).map((subflow) => subflow.graph)]) {
    for (const node of Object.values(graph.nodes)) {
      if (node.kind != 'task' || node.taskId == null || document.tasks[node.taskId]?.executor.kind != 'openapi') continue
      for (const [handle, mapping] of Object.entries(node.inputs)) {
        if (handle.startsWith('auth.') && (mapping.kind == 'value' || (mapping.kind == 'sources' && mapping.sources.some((source) => source.kind == 'flow'))))
          throw new TypeError('OpenAPI authentication accepts deployment variables and upstream outputs only.')
      }
    }
  }
}
