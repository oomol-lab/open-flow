import type { ConnectorActionMetadata, FlowCheck } from '@oomol-lab/open-flow/control-api'
import type { RevisionContent } from '@oomol-lab/open-flow/flow-change'

import { ConnectorTaskError } from '../deployment/connector.ts'

type Diagnostic = FlowCheck['diagnostics'][number]

/** Missing accounts are valid draft data, but authenticated actions are not ready to run. */
export async function actionAccountDiagnostics(
  content: RevisionContent,
  dependencies: { readonly nodes: Iterable<string> },
  resolve: (actionId: string) => Promise<ConnectorActionMetadata>,
): Promise<readonly Diagnostic[]> {
  const references: { action: string; path: string }[] = []
  for (const [id, node] of Object.entries(content.document.graph.nodes)) {
    if (node.kind !== 'task' || !('moduleId' in node.task)) continue
    for (const [index, capability] of (node.task.capabilities ?? []).entries()) {
      if (!('mode' in capability) || capability.mode !== 'independent') continue
      for (const [actionIndex, entry] of capability.actions.entries()) {
        if (entry.connectionId == null)
          references.push({ action: entry.action, path: `/document/graph/nodes/${id}/task/capabilities/${index}/actions/${actionIndex}/connectionId` })
      }
    }
  }
  for (const id of dependencies.nodes) {
    const node = content.document.graph.nodes[id]
    const task = node?.kind == 'task' && 'executor' in node.task ? node.task : undefined
    if (task?.executor.kind !== 'agent') continue
    for (const [index, tool] of task.executor.tools.entries()) {
      if (tool.connectionId == null) references.push({ action: tool.action, path: `/document/graph/nodes/${id}/task/executor/tools/${index}/connectionId` })
    }
  }
  const definitions = new Map<string, Promise<ConnectorActionMetadata>>()
  return (
    await Promise.all(
      references.map(async ({ action, path }): Promise<Diagnostic[]> => {
        try {
          let definition = definitions.get(action)
          if (definition == null) {
            definition = resolve(action)
            definitions.set(action, definition)
          }
          if (!(await definition).authenticated) return []
          return [
            {
              code: 'task.action-connection-required',
              path,
              line: 0,
              column: 0,
              message: `Action "${action}" requires an account before running.`,
              values: { action },
            },
          ]
        } catch (error) {
          if (!(error instanceof ConnectorTaskError)) throw error
          return [{ code: error.code, message: error.message, path, line: 0, column: 0, values: { action } }]
        }
      }),
    )
  ).flat()
}
