import type { ConnectorActionMetadata, ConnectorConnection } from '@oomol-lab/open-flow/control-api'
import type { ConnectorActionCapability, ConnectorCapability } from '@oomol-lab/open-flow/flow-change'
import type { ConnectorAccessContext, ConnectorHost } from '../deployment/connector-contract.ts'

import { accessInvalid, connectionRequired, ConnectorTaskError } from '../deployment/connector-contract.ts'

export async function checkCodeActions(
  declarations: readonly ConnectorActionCapability[],
  connector: ConnectorHost | undefined,
  access?: ConnectorAccessContext,
  signal?: AbortSignal,
): Promise<void> {
  if (declarations.length == 0) return
  if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
  const actions = new Map<string, Promise<ConnectorActionMetadata>>()
  const catalogs = new Map<string, Promise<readonly ConnectorConnection[]>>()
  for (const declaration of declarations) {
    let action = actions.get(declaration.action)
    if (action == null) {
      action = connector.getAction(declaration.action, signal, access)
      actions.set(declaration.action, action)
    }
    const definition = await action
    if (definition.authenticated && declaration.connections.length == 0) throw connectionRequired()
    if (declaration.connections.length == 0) continue
    let catalog = catalogs.get(definition.serviceId)
    if (catalog == null) {
      catalog = connector.listConnections(definition.serviceId, signal, access)
      catalogs.set(definition.serviceId, catalog)
    }
    const connections = await catalog
    for (const allowed of declaration.connections) {
      if (
        !connections.some(
          (connection) => connection.connectionId == allowed.connectionId && connection.serviceId == definition.serviceId && connection.status == 'active',
        )
      )
        throw connectionRequired()
    }
  }
}

export async function checkCodePermissions(
  declarations: readonly ConnectorCapability[],
  connector: ConnectorHost | undefined,
  access: ConnectorAccessContext,
  signal?: AbortSignal,
): Promise<void> {
  const actions = declarations.flatMap((declaration) =>
    'mode' in declaration && declaration.mode == 'independent' ? declaration.actions.filter((entry) => entry.connectionId !== '') : [],
  )
  if (actions.length == 0) return
  if (connector == null) throw new ConnectorTaskError('connector.unconfigured', 'Connector is not configured for this deployment.')
  for (const entry of actions) {
    if (access.scope == 'catalog') throw accessInvalid('Code permissions require a fixed access snapshot.')
    const scoped: ConnectorAccessContext = { ...access, scope: 'action', action: entry.action, connectionId: entry.connectionId }
    const action = await connector.getAction(entry.action, signal, { ...scoped, providerId: entry.action.split('.')[0] })
    if (!action.authenticated && entry.connectionId == null) continue
    if (entry.connectionId == null) throw connectionRequired()
    const connections = await connector.listConnections(action.serviceId, signal, scoped)
    if (!connections.some((connection) => connection.status == 'active' && connection.connectionId == entry.connectionId)) throw connectionRequired()
  }
}
