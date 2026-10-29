import type { FlowDocument } from '../../flow/common/change.ts'

/** Never allow credentials to enter a Revision as literal node inputs. */
export function assertHttpAuthBindings(document: FlowDocument): void {
  for (const node of Object.values(document.graph.nodes)) {
    if (node.kind != 'task' || !('executor' in node.task) || !['openapi', 'http-request'].includes(node.task.executor.kind)) continue
    for (const [handle, mapping] of Object.entries(node.inputs)) {
      if (handle.startsWith('auth.') && mapping.kind == 'value')
        throw new TypeError('HTTP authentication accepts deployment variables and upstream outputs only.')
    }
  }
}
