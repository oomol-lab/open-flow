import type { ConnectorProxyConfiguration, ConnectorProxyResource } from '../deployment/connector-proxy.ts'

import { controlErrorCode } from '@oomol-lab/open-flow/control-api'
import { Hono } from 'hono'
import { ControlError } from '../error.ts'

interface ConnectorProxyDependencies {
  readonly authenticate: (request: Request) => Promise<string>
  readonly configuration: () => ConnectorProxyConfiguration | undefined
  readonly resolveScope: (flowId?: string) => Promise<string | undefined>
  readonly forward: (configuration: ConnectorProxyConfiguration, resource: ConnectorProxyResource, request: Request, teamId?: string) => Promise<Response>
}

export function createConnectorProxyApp(dependencies: ConnectorProxyDependencies): Hono {
  const app = new Hono()
  for (const resource of ['providers', 'actions', 'apps'] as const) {
    app.get(`/${resource}`, async (context) => {
      const request = context.req.raw
      await dependencies.authenticate(request)
      const configuration = dependencies.configuration()
      if (configuration == null) throw new ControlError(controlErrorCode.connectorUnconfigured, 'Connector is not configured for this deployment.')
      const flowIds = new URL(request.url).searchParams.getAll('flowId')
      const flowId = flowIds[0]
      if (flowIds.length > 1 || (flowId != null && flowId.trim().length == 0)) {
        throw new ControlError(controlErrorCode.flowInvalid, 'flowId must be a nonempty string supplied once.')
      }
      const teamId = await dependencies.resolveScope(flowId)
      return dependencies.forward(configuration, resource, request, teamId)
    })
  }
  return app
}
