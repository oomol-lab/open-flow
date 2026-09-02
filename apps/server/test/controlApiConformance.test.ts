import type { ConnectorAction, ConnectorConnection, ConnectorProvider } from '@oomol-lab/open-flow/control-api'
import type { ControlApiConformanceHarness } from '@oomol-lab/open-flow/control-api-conformance'

import {
  connectorControlApiConformanceCases,
  controlApiConformanceCases,
  publicationControlApiConformanceCases,
  triggerControlApiConformanceCases,
} from '@oomol-lab/open-flow/control-api-conformance'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { ConnectorTaskError } from '../node/connector.ts'
import { createServerApp } from '../node/http.ts'
import { createConnectorHost } from './connectorHost.ts'
import { closeService, openService, startService } from './serviceFixture.ts'

const connectorProvider: ConnectorProvider = {
  icon: 'https://connector.example/icons/mail.svg',
  serviceId: 'mail',
  serviceName: 'Mail',
}

const connectorConnection: ConnectorConnection = {
  connectionId: 'mail-work',
  displayName: 'Work mailbox',
  isDefault: true,
  serviceId: 'mail',
  status: 'active',
}

const connectorAction: ConnectorAction = {
  actionId: 'mail.send',
  authenticated: true,
  defaultConnection: connectorConnection,
  description: 'Send one message.',
  inputs: {
    to: {
      description: 'Recipient.',
      jsonSchema: { description: 'Recipient.', type: 'string' },
      nullable: false,
    },
  },
  name: 'send',
  outputs: {
    message: {
      jsonSchema: { type: 'object' },
      nullable: false,
    },
  },
  serviceId: 'mail',
  serviceName: 'Mail',
}

async function createHarness(start = false): Promise<ControlApiConformanceHarness> {
  const directory = await mkdtemp(path.join(tmpdir(), 'open-flow-control-conformance-'))
  const file = path.join(directory, 'open-flow.sqlite')
  const connector = createConnectorHost({
    getAction: async (actionId) => {
      if (actionId != connectorAction.actionId) throw new ConnectorTaskError('connector.action-not-found', 'The Connector Action was not found.')
      return connectorAction
    },
    listActions: async () => [connectorAction],
    listConnections: async (serviceId) => (serviceId == connectorConnection.serviceId ? [connectorConnection] : []),
    listProviders: async () => [connectorProvider],
    ready: async () => true,
    searchActions: async () => [connectorAction],
  })
  let now = Date.UTC(2026, 7, 22)
  const open = async () => {
    const service = await openService(file, {
      capabilities: {
        connector: connector == null ? undefined : () => connector,
        connectorConsoleOrigin: () => new URL('https://connector.example'),
      },
      clock: () => {
        now += 1_000
        return now
      },
    })
    if (start) await startService(service)
    return service
  }
  const options = {
    resolveControlActor: (request: Request) => (request.headers.get('authorization') == 'Bearer control-api-conformance' ? 'server-operator' : undefined),
  }
  let service = await open()
  let app = createServerApp(service, options)
  return {
    async dispose() {
      await closeService(service)
      await rm(directory, { force: true, recursive: true })
    },
    origin: 'http://server.local',
    async request(request) {
      const headers = new Headers(request.headers)
      headers.set('authorization', 'Bearer control-api-conformance')
      if (request.method == 'GET' && new URL(request.url).pathname.includes('/publish-operations/')) await service.tickMaintenance()
      const response = await app.request(new Request(request, { headers }))
      if (request.method == 'POST' && new URL(request.url).pathname.endsWith('/pause') && response.ok) {
        await closeService(service)
        service = await open()
        app = createServerApp(service, options)
      }
      return response
    },
  }
}

describe('Server P0 Control API conformance', () => {
  for (const conformance of controlApiConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness(conformance.runtime)
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server P1 Publication Control API conformance', () => {
  for (const conformance of publicationControlApiConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness()
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server P2 Trigger Control API conformance', () => {
  for (const conformance of triggerControlApiConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness()
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})

describe('Server P3 Connector Control API conformance', () => {
  for (const conformance of connectorControlApiConformanceCases) {
    it(conformance.name, async () => {
      const harness = await createHarness()
      try {
        await conformance.verify(harness)
      } finally {
        await harness.dispose()
      }
    })
  }
})
