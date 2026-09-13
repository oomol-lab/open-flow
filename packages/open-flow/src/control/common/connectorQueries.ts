import type { ConnectorAction, ConnectorConnection, ConnectorProvider } from './api.ts'

import { connection, connectorAction, connectorProvider } from './connectorDecoders.ts'
import { exact, invalidResponse, record, string } from './decoding.ts'

export interface RequestQuery<Value> {
  readonly path: string
  readonly decode: (data: unknown) => Value
}

const scope = (flowId?: string) => (flowId == null ? '' : `?flowId=${encodeURIComponent(flowId)}`)

export function connectorProvidersQuery(flowId?: string, locale?: string): RequestQuery<readonly ConnectorProvider[]> {
  const parameters = new URLSearchParams({ ...(flowId == null ? {} : { flowId }), ...(locale == null ? {} : { locale }) }).toString()
  return {
    path: `/v1/connector/providers${parameters ? `?${parameters}` : ''}`,
    decode: (value) => {
      const source = record(value)
      exact(source, ['providers', 'version'])
      if (source.version != 1 || !Array.isArray(source.providers)) return invalidResponse()
      return source.providers.map(connectorProvider)
    },
  }
}

export function connectorActionQuery(actionId: string, flowId?: string, locale?: string): RequestQuery<ConnectorAction> {
  const parameters = new URLSearchParams({ ...(flowId == null ? {} : { flowId }), ...(locale == null ? {} : { locale }) }).toString()
  return {
    path: `/v1/connector/actions/${encodeURIComponent(actionId)}${parameters ? `?${parameters}` : ''}`,
    decode: (value) => {
      const source = record(value)
      exact(source, ['action', 'version'])
      if (source.version != 1) return invalidResponse()
      return connectorAction(source.action)
    },
  }
}

export function allConnectorConnectionsQuery(flowId?: string): RequestQuery<readonly ConnectorConnection[]> {
  return {
    path: `/v1/connector/connections${scope(flowId)}`,
    decode: (value) => {
      const source = record(value)
      exact(source, ['connections', 'version'])
      if (source.version != 1 || !Array.isArray(source.connections)) return invalidResponse()
      return source.connections.map(connection)
    },
  }
}

export function connectorConnectionsQuery(serviceId: string, flowId?: string): RequestQuery<readonly ConnectorConnection[]> {
  return {
    path: `/v1/connector/connections/${encodeURIComponent(serviceId)}${scope(flowId)}`,
    decode: (value) => {
      const source = record(value)
      exact(source, ['connections', 'serviceId', 'version'])
      if (source.version != 1 || string(source.serviceId) != serviceId || !Array.isArray(source.connections)) return invalidResponse()
      return source.connections.map(connection)
    },
  }
}
