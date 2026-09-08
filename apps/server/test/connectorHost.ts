import type { ConnectorHost } from '../node/deployment/connector.ts'

import { ConnectorTaskError } from '../node/deployment/connector.ts'

async function unavailable(): Promise<never> {
  throw new ConnectorTaskError('connector.unavailable', 'The Connector request could not be completed.')
}

export function createConnectorHost(overrides: Partial<ConnectorHost> = {}): ConnectorHost {
  return {
    execute: unavailable,
    getAction: unavailable,
    listActions: unavailable,
    listConnections: unavailable,
    listProviders: unavailable,
    proxy: unavailable,
    ready: async () => false,
    searchActions: unavailable,
    ...overrides,
  }
}
