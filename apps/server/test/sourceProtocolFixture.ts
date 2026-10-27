import type { JsonValue } from '@oomol-lab/open-flow/flow-change'

import { ConnectorTaskError } from '../node/deployment/connector-contract.ts'

export function sourceReferenceFixture() {
  const sources = new Map<string, import('@oomol-lab/open-flow/event-source').SourceReferenceSnapshot>()
  let revision = 0
  return (request: import('@oomol-lab/open-flow/event-source').SourceReferenceOperation, accountId = 'cli_test'): unknown => {
    if (request.action === 'route') {
      const body = JSON.parse(Buffer.from(request.rawBody, 'base64').toString()) as { verify?: boolean; response?: unknown }
      if (body.verify)
        for (const source of sources.values())
          if (source.reference.applicationId === request.applicationId) {
            source.ready = true
            source.view.verifiedAt = new Date(1_800_000_000_000).toISOString()
            source.revision = ++revision
          }
      return {
        references: body.response
          ? []
          : [...sources.values()].filter((source) => source.reference.applicationId === request.applicationId).map((source) => source.reference),
        response: body.response,
      }
    }
    if (request.action === 'create') {
      if (!accountId) throw new ConnectorTaskError('connector.input-invalid', 'Connector did not confirm the application identity.')
      const existing = sources.get(request.requestKey)
      if (existing != null) return { source: existing }
      const source = {
        reference: { applicationId: String(request.input.appId ?? accountId), sourceId: request.requestKey },
        revision: ++revision,
        eventTypes: [...(request.input.eventTypes as string[])],
        ready: false,
        view: {
          appId: String(request.input.appId ?? accountId),
          workspaceId: request.input.workspaceId as string | undefined,
          projectId: request.input.project != null ? '100' : undefined,
          signingSecretConfigured: true,
          manageSubscriptions: Boolean(request.input.manageSubscriptions),
          verificationTokenConfigured: request.input.verificationToken != null,
          encryptKeyConfigured: request.input.encryptKey != null,
          verifiedAt: null,
        },
      }
      sources.set(request.requestKey, source)
      return { source }
    }
    const sourceId = 'requestKey' in request.reference ? request.reference.requestKey : request.reference.sourceId
    const source = sources.get(sourceId)
    if (source == null && request.action === 'delete') return { deleted: true }
    if (source == null) throw new ConnectorTaskError('connector.input-invalid', 'Source not found.')
    switch (request.action) {
      case 'get':
        return { source }
      case 'delete':
        sources.delete(sourceId)
        return { deleted: true }
      case 'update': {
        source.eventTypes = [...(request.input.eventTypes as string[])]
        source.revision = ++revision
        if (request.input.signingSecret != null || request.input.encryptKey != null || request.input.verificationToken != null)
          for (const item of sources.values()) {
            item.ready = false
            item.view = { ...item.view, verifiedAt: null }
            item.revision = revision
          }
        return { source }
      }
      case 'resource':
        source.ready = request.active
        source.view = {
          ...source.view,
          subscriptionStatus: request.active ? 'ready' : 'idle',
          verifiedAt: request.active ? new Date(1_800_000_000_000).toISOString() : null,
        }
        return { source, outcome: 'ready' }
      case 'prepare':
        if (!source.ready && !source.view.projectId) throw new ConnectorTaskError('connector.input-invalid', 'Verify the Source first.')
        return { source, subscriptions: request.config.resource == null ? [] : [{ key: JSON.stringify(request.config.resource) }] }
      case 'receive': {
        const result = JSON.parse(Buffer.from(request.rawBody, 'base64').toString()) as {
          verify?: boolean
          event?: Record<string, JsonValue>
          response?: unknown
        }
        if (result.verify)
          for (const item of sources.values()) {
            item.ready = true
            item.view = { ...item.view, verifiedAt: new Date(1_800_000_000_000).toISOString() }
            item.revision = ++revision
          }
        return { source, ...result, event: result.event == null ? undefined : { ...result.event, matches: request.consumers.map((consumer) => consumer.id) } }
      }
    }
  }
}
