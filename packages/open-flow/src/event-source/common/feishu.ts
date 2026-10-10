import type { CreateEventSource, EventSource, UpdateEventSource } from '../../control/common/eventSources.ts'
import type { FeishuEvent } from '../../trigger/providers/feishu/events.ts'
import type { EventSourceDefinition } from './definition.ts'

import { PermanentIntegrationError } from '../../trigger/common/integration.ts'
import { receiveFeishuEvent, matchesFeishuEvent } from '../../trigger/providers/feishu/events.ts'
import { feishuSubscriptions } from '../../trigger/providers/feishu/subscriptions.ts'
import { SourceIdentityError } from './definition.ts'

export const feishuApplication: EventSourceDefinition<
  CreateEventSource,
  UpdateEventSource,
  Pick<EventSource, 'appId' | 'manageSubscriptions' | 'verificationTokenConfigured' | 'encryptKeyConfigured' | 'verifiedAt'>
> = {
  kind: 'feishu',
  provider: 'feishu_app_bot',
  maximumBodyBytes: 64 * 1024,
  initialize(input, accountId) {
    if (accountId == null || !/^cli_[a-zA-Z0-9]+$/.test(accountId)) throw new SourceIdentityError('Connector must provide the verified application identity.')
    return {
      identity: accountId,
      eventTypes: input.eventTypes,
      config: { manageSubscriptions: input.manageSubscriptions },
      secrets: { verificationToken: input.verificationToken, encryptKey: input.encryptKey },
      state: {},
    }
  },
  update(source, input) {
    const secrets = {
      verificationToken: input.verificationToken ?? source.secrets.verificationToken!,
      encryptKey: input.encryptKey ?? source.secrets.encryptKey!,
    }
    const changed = secrets.verificationToken != source.secrets.verificationToken || secrets.encryptKey != source.secrets.encryptKey
    return {
      identity: source.identity,
      eventTypes: input.eventTypes,
      config: source.config,
      secrets,
      state: changed ? {} : source.state,
    }
  },
  view(source) {
    return {
      appId: source.identity,
      manageSubscriptions: source.config.manageSubscriptions === true,
      verificationTokenConfigured: true,
      encryptKeyConfigured: true,
      verifiedAt: typeof source.state.verifiedAt == 'number' ? new Date(source.state.verifiedAt).toISOString() : null,
    }
  },
  ready: (source) => typeof source.state.verifiedAt == 'number',
  async receive(source, bytes, headers, now) {
    const received = await receiveFeishuEvent(
      bytes,
      headers,
      { appId: source.identity, verificationToken: source.secrets.verificationToken as string, encryptKey: source.secrets.encryptKey as string },
      now,
    )
    if ('challenge' in received) return { response: Response.json(received), state: { ...source.state, verifiedAt: now } }
    const event = received.event
    return {
      event: {
        id: event.id,
        type: event.type,
        payload: { event: event.type, deliveryId: event.id, appId: event.appId, tenantKey: event.tenantKey, occurredAt: event.occurredAt, body: event.body },
      },
    }
  },
  matches(config, event) {
    return matchesFeishuEvent(config, {
      type: event.type,
      body: event.payload.body as FeishuEvent['body'],
    })
  },
  resources: {
    triggerId: 'feishu_app_bot.on_event',
    requests(source, provider, config) {
      const subscriptions = feishuSubscriptions(config, provider)
      if (subscriptions.length > 0 && source.config.manageSubscriptions !== true)
        throw new PermanentIntegrationError('This source does not manage resource subscriptions.')
      return subscriptions
    },
  },
}
