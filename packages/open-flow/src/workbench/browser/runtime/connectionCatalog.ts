import type { ConnectorActionMetadata, ConnectorConnection } from './api.ts'

/** Consumer-derived account state; never part of the Action API or metadata cache. */
export interface ConnectorActionView extends ConnectorActionMetadata {
  readonly defaultConnection?: ConnectorConnection
}

export function actionWithConnections(action: ConnectorActionMetadata, connections: readonly ConnectorConnection[] | undefined): ConnectorActionView {
  const preferred = action.authenticated && connections != null ? connectionCatalog(connections).preferred : undefined
  return { ...action, ...(preferred == null ? {} : { defaultConnection: preferred }) }
}

export interface ConnectionCatalog {
  readonly active: readonly ConnectorConnection[]
  readonly all: readonly ConnectorConnection[]
  readonly byId: ReadonlyMap<string, ConnectorConnection>
  readonly preferred?: ConnectorConnection
}

export function connectionCatalog(connections: readonly ConnectorConnection[]): ConnectionCatalog {
  const active: ConnectorConnection[] = []
  const byId = new Map<string, ConnectorConnection>()
  let defaultConnection: ConnectorConnection | undefined
  for (const connection of connections) {
    byId.set(connection.connectionId, connection)
    if (connection.status != 'active') continue
    active.push(connection)
    if (connection.isDefault) defaultConnection = connection
  }
  return {
    active,
    all: connections,
    byId,
    preferred: defaultConnection ?? (active.length == 1 ? active[0] : undefined),
  }
}
