import type { FlowDocument, RevisionContent } from './change.ts'

export interface ConnectionUsage {
  readonly providerId: string
  readonly connectionId?: string
  readonly actionId?: string
  readonly triggerId?: string
  readonly nodeId: string
  readonly name: string

  readonly kind: 'connector' | 'agent' | 'trigger' | 'notification' | 'code'
}

export function connectionUsage(document: FlowDocument): readonly ConnectionUsage[] {
  const uses: ConnectionUsage[] = []

  for (const [nodeId, node] of Object.entries(document.graph.nodes)) {
    const task = node.kind == 'task' && 'executor' in node.task ? node.task : undefined
    const name = node.name ?? task?.name ?? nodeId
    const add = (kind: ConnectionUsage['kind'], actionId: string, connectionId?: string) => {
      uses.push({ kind, providerId: actionId.split('.')[0]!, actionId, connectionId, nodeId, name })
    }
    if (node.kind == 'poll' || node.kind == 'integration') {
      uses.push({
        kind: 'trigger',
        triggerId: node.definition.key,
        providerId: node.definition.provider,
        connectionId: node.connectionId,
        nodeId,
        name,
      })
    }
    if (task?.executor.kind == 'connector') add('connector', task.executor.action, task.executor.connectionId)
    if (node.kind == 'task' && 'moduleId' in node.task) {
      for (const capability of node.task.capabilities ?? []) {
        if ('mode' in capability && capability.mode == 'independent') for (const action of capability.actions) add('code', action.action, action.connectionId)
      }
    }
    if (task?.executor.kind == 'agent') {
      for (const tool of task.executor.tools) if (tool.kind != 'workflow') add('agent', tool.action, tool.connectionId)
      const notification = task.executor.notification
      if (notification != null) add('notification', notification.action, notification.connectionId)
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
      graph: clearNodeConnections(document.graph, connectionId),
    },
  }
}

export function clearNodeConnections(graph: FlowDocument['graph'], connectionId?: string): FlowDocument['graph'] {
  return {
    ...graph,
    nodes: Object.fromEntries(
      Object.entries(graph.nodes).map(([id, node]) => {
        if ((node.kind == 'poll' || node.kind == 'integration') && (connectionId == null || node.connectionId == connectionId)) {
          const { connectionId: _, ...remaining } = node
          return [id, remaining]
        }
        if (node.kind != 'task') return [id, node]
        if ('executor' in node.task) {
          const executor = node.task.executor
          const clear = <T extends { readonly connectionId?: string }>(value: T): T => {
            if (value.connectionId === '') return value
            if (connectionId != null && value.connectionId != connectionId) return value
            const { connectionId: _, ...rest } = value
            return rest as T
          }
          if (executor.kind == 'connector') return [id, { ...node, task: { ...node.task, executor: clear(executor) } }]
          if (executor.kind == 'agent')
            return [
              id,
              {
                ...node,
                task: {
                  ...node.task,
                  executor: {
                    ...executor,
                    tools: executor.tools.map(clear),
                    ...(executor.notification == null ? {} : { notification: clear(executor.notification) }),
                  },
                },
              },
            ]
          return [id, node]
        }
        const capabilities = node.task.capabilities?.map((capability) => {
          if (capability.kind == 'workflow' || capability.kind == 'http') return capability
          if (!('mode' in capability)) {
            if ('action' in capability) {
              const { connectionId: selected, ...rest } = capability
              return {
                ...rest,
                connections: capability.connections.filter((item) => connectionId != null && item.connectionId != connectionId),
                ...(selected != null && connectionId != null && selected != connectionId ? { connectionId: selected } : {}),
              }
            }
            return {
              ...capability,
              ...(connectionId == null && (capability.connectionHints?.length ?? 0) > 0
                ? { actionHints: [...new Set([...(capability.actionHints ?? []), ...capability.connectionHints!.map((hint) => hint.action)])] }
                : {}),
              ...(capability.connectionHints == null
                ? {}
                : { connectionHints: capability.connectionHints.filter((item) => connectionId != null && item.connectionId != connectionId) }),
            }
          }
          if (capability.mode != 'independent') return capability
          return {
            ...capability,
            actions: capability.actions.map((action) => {
              if (action.connectionId === '') return action
              if (connectionId != null && action.connectionId != connectionId) return action
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
