import type { FlowDocument, GraphTarget, RevisionContent } from './change.ts'

export interface ConnectionUsage {
  readonly providerId: string
  readonly connectionId?: string
  readonly actionId?: string
  readonly nodeId: string
  readonly name: string
  readonly target: GraphTarget
  readonly kind: 'connector' | 'agent' | 'trigger' | 'notification' | 'code'
}

export function connectionUsage(document: FlowDocument): readonly ConnectionUsage[] {
  const uses: ConnectionUsage[] = []
  const graphs = [
    { graph: document.graph, target: { kind: 'flow' } as GraphTarget, name: '' },
    ...Object.entries(document.subflows).map(([id, subflow]) => ({ graph: subflow.graph, target: { kind: 'subflow', id } as GraphTarget, name: subflow.name })),
  ]
  for (const { graph, target, name: graphName } of graphs) {
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
      const task = node.kind == 'task' && node.taskId != null ? document.tasks[node.taskId] : undefined
      const name = [graphName, node.name ?? task?.name ?? nodeId].filter(Boolean).join(' / ')
      const add = (kind: ConnectionUsage['kind'], actionId: string, connectionId?: string) => {
        uses.push({ kind, providerId: actionId.split('.')[0]!, actionId, connectionId, nodeId, name, target })
      }
      if (node.kind == 'poll' || node.kind == 'integration') {
        uses.push({
          kind: 'trigger',
          providerId: node.definition.provider,
          connectionId: node.connectionId,
          nodeId,
          name,
          target,
        })
      }
      if (task?.executor.kind == 'connector') add('connector', task.executor.action, task.executor.connectionId)
      if (node.kind == 'task' && node.task != null) {
        for (const capability of node.task.capabilities ?? []) {
          if ('mode' in capability && capability.mode == 'independent') for (const action of capability.actions) add('code', action.action, action.connectionId)
        }
      }
      if (task?.executor.kind == 'agent') {
        for (const tool of task.executor.tools) add('agent', tool.action, tool.connectionId)
        const notification = task.executor.notification == null ? undefined : document.tasks[task.executor.notification.taskId]?.executor
        if (notification?.kind == 'connector') add('notification', notification.action, notification.connectionId)
      }
    }
  }
  return uses
}

export function removeConnectionUsage(content: RevisionContent, connectionId: string): RevisionContent {
  const document = content.document
  return {
    ...content,
    document: {
      ...document,
      tasks: Object.fromEntries(
        Object.entries(document.tasks).map(([id, task]) => {
          const executor = task.executor
          if (executor.kind == 'connector' && executor.connectionId == connectionId) {
            const { connectionId: _, ...next } = executor
            return [id, { ...task, executor: next }]
          }
          if (executor.kind == 'agent')
            return [
              id,
              {
                ...task,
                executor: {
                  ...executor,
                  tools: executor.tools.map((tool) => {
                    if (tool.connectionId != connectionId) return tool
                    const { connectionId: _, ...next } = tool
                    return next
                  }),
                },
              },
            ]
          return [id, task]
        }),
      ),
      graph: clearNodeConnections(document.graph, connectionId),
      subflows: Object.fromEntries(
        Object.entries(document.subflows).map(([id, subflow]) => [id, { ...subflow, graph: clearNodeConnections(subflow.graph, connectionId) }]),
      ),
    },
  }
}

function clearNodeConnections(graph: FlowDocument['graph'], connectionId: string): FlowDocument['graph'] {
  return {
    ...graph,
    nodes: Object.fromEntries(
      Object.entries(graph.nodes).map(([id, node]) => {
        if ((node.kind == 'poll' || node.kind == 'integration') && node.connectionId == connectionId) {
          const { connectionId: _, ...remaining } = node
          return [id, remaining]
        }
        if (node.kind != 'task' || node.task == null) return [id, node]
        const capabilities = node.task.capabilities?.map((capability) => {
          if (!('mode' in capability) || capability.mode != 'independent') return capability
          return {
            ...capability,
            actions: capability.actions.map((action) => {
              if (action.connectionId != connectionId) return action
              const { connectionId: _, ...remaining } = action
              return remaining
            }),
          }
        })
        return [id, capabilities == null ? node : { ...node, task: { ...node.task, capabilities } }]
      }),
    ),
  }
}
