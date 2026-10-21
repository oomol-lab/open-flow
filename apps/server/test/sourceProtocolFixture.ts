import type { SourceConfiguration, SourceOperation } from '@oomol-lab/open-flow/event-source'
import type { JsonValue } from '@oomol-lab/open-flow/flow-change'

import { ConnectorTaskError } from '../node/deployment/connector-contract.ts'

const projection = (source: SourceConfiguration): SourceConfiguration => ({
  ...source,
  state: {
    ...source.state,
    projection: {
      ready: typeof source.state.verifiedAt === 'number',
      view: {
        appId: String(source.config.appId),
        manageSubscriptions: true,
        verificationTokenConfigured: true,
        encryptKeyConfigured: true,
        verifiedAt: typeof source.state.verifiedAt === 'number' ? new Date(source.state.verifiedAt).toISOString() : null,
      },
    },
  },
})

export function sourceProtocolFixture(request: SourceOperation, accountId = 'cli_test', now = 1_800_000_000_000): unknown {
  switch (request.action) {
    case 'initialize': {
      if (!accountId) throw new ConnectorTaskError('connector.input-invalid', 'Connector did not confirm the application identity.')
      const input = request.input
      return {
        source: projection({
          identity: JSON.stringify([input.teamId, input.connectionId, accountId]),
          eventTypes: input.eventTypes as string[],
          config: { appId: input.appId ?? accountId, accountId },
          secrets: { verificationToken: input.verificationToken ?? '', encryptKey: input.encryptKey ?? '', signingSecret: input.signingSecret ?? '' },
          state: {},
        }),
      }
    }
    case 'update': {
      const secrets = { ...request.source.secrets }
      let rotated = false
      for (const field of ['verificationToken', 'encryptKey', 'signingSecret'])
        if (request.input[field] != null && request.input[field] !== secrets[field]) {
          secrets[field] = request.input[field]!
          rotated = true
        }
      return {
        source: projection({ ...request.source, eventTypes: request.input.eventTypes as string[], secrets, state: rotated ? {} : request.source.state }),
      }
    }
    case 'inspect':
      return { source: projection(request.source) }
    case 'prepare':
      return {
        source: projection(request.source),
        subscriptions: request.config.resource == null ? [] : [{ key: JSON.stringify(request.config.resource), config: request.config }],
      }
    case 'receive': {
      // The test supplies Connector responses as the callback body; no provider protocol runs here.
      const result = JSON.parse(Buffer.from(request.rawBody, 'base64').toString()) as {
        response?: unknown
        event?: Record<string, JsonValue>
        verify?: boolean
      }
      return {
        source: projection({ ...request.source, state: result.verify ? { ...request.source.state, verifiedAt: now } : request.source.state }),
        ...result,
        event: result.event == null ? undefined : { ...result.event, matches: request.consumers.map((consumer) => consumer.id) },
      }
    }
  }
}
