import type { ConnectorProxyResult } from '../../../connector/common/proxy.ts'
import type { JsonValue, TriggerKeySnapshot } from '../../../flow/common/change.ts'
import type { IntegrationDefinition, IntegrationReconcileContext } from '../../common/integration.ts'

import { IntegrationConnectionError, PermanentIntegrationError, TransientIntegrationError } from '../../common/integration.ts'

interface Config {
  readonly chatIds: readonly string[]
  readonly dropPendingUpdates: boolean
  readonly updates: readonly string[]
  readonly userIds: readonly string[]
}

interface TelegramEnvelope {
  readonly description?: string
  readonly ok?: boolean
  readonly result?: { readonly url?: string } | boolean
}

const optInUpdates = new Set(['chat_member', 'message_reaction', 'message_reaction_count'])
const updateTypes = [
  '*',
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
  'guest_message',
  'message_reaction',
  'message_reaction_count',
  'inline_query',
  'chosen_inline_result',
  'callback_query',
  'shipping_query',
  'pre_checkout_query',
  'purchased_paid_media',
  'poll',
  'poll_answer',
  'my_chat_member',
  'chat_member',
  'chat_join_request',
  'chat_boost',
  'removed_chat_boost',
  'managed_bot',
  'subscription',
] as const
const defaultUpdates = updateTypes.filter((value) => value != '*' && !optInUpdates.has(value))

const snapshot = {
  configSchema: {
    additionalProperties: false,
    description: 'Configuration for telegram.on_update.',
    properties: {
      chatIds: {
        default: [],
        description: 'Only accept updates from these numeric Telegram chat IDs. Empty means every chat.',
        items: { pattern: '^-?[0-9]{1,20}$', type: 'string' },
        maxItems: 100,
        type: 'array',
        uniqueItems: true,
      },
      dropPendingUpdates: {
        default: true,
        description: 'Discard updates queued before the webhook is created or resumed.',
        type: 'boolean',
      },
      updates: {
        description: 'Telegram update types that trigger a Run. Use * for the Telegram default set.',
        items: { enum: updateTypes },
        minItems: 1,
        type: 'array',
        uniqueItems: true,
      },
      userIds: {
        default: [],
        description: 'Only accept updates from these numeric Telegram user IDs. Empty means every user.',
        items: { pattern: '^[0-9]{1,20}$', type: 'string' },
        maxItems: 100,
        type: 'array',
        uniqueItems: true,
      },
    },
    required: ['updates'],
    title: 'Telegram Bot Update Config',
    type: 'object',
  },
  definitionVersion: 1,
  description: 'Triggers when the connected Telegram bot receives a selected update.',
  displayName: 'Bot Update',
  endpoint: { body: { allowArray: false, allowEmpty: false, formats: ['json'] }, methods: ['POST'], successStatus: 200 },
  key: 'telegram.on_update',
  name: 'on_update',
  payloadSchema: {
    additionalProperties: false,
    properties: {
      body: { type: 'object' },
      deliveryId: { type: 'string' },
      event: { type: 'string' },
    },
    required: ['event', 'deliveryId', 'body'],
    title: 'Telegram Bot Update Payload',
    type: 'object',
  },
  provider: 'telegram',
  type: 'integration',
} as const satisfies TriggerKeySnapshot & { readonly type: 'integration' }

export const telegramUpdate: IntegrationDefinition = {
  snapshot,
  receive(context) {
    if (!sameSecret(context.header('x-telegram-bot-api-secret-token'), context.callbackSecret)) {
      return { body: '', contentType: 'text/plain', outcome: 'respond', status: 404 }
    }
    if (!isRecord(context.payload) || !Number.isSafeInteger(context.payload.update_id)) {
      return { outcome: 'ignored', reason: 'Telegram update_id is missing.' }
    }
    const event = Object.keys(context.payload).find((key) => key != 'update_id')
    if (event == null) return { outcome: 'ignored', reason: 'Telegram update body is missing.' }
    const config = resolveConfig(context.config)
    const subscribed = subscribedUpdates(config) ?? defaultUpdates
    if (!subscribed.includes(event)) return { outcome: 'ignored', reason: 'Telegram update type is not subscribed.' }
    const update = context.payload[event]
    if (config.chatIds.length > 0) {
      const chatId = resolveChatId(update)
      if (chatId == null || !config.chatIds.includes(chatId)) return { outcome: 'ignored', reason: 'Telegram chat does not match.' }
    }
    if (config.userIds.length > 0) {
      const userId = resolveUserId(update)
      if (userId == null || !config.userIds.includes(userId)) return { outcome: 'ignored', reason: 'Telegram user does not match.' }
    }
    const deliveryId = String(context.payload.update_id)
    return {
      dedupeKey: deliveryId,
      outcome: 'event',
      payload: { body: context.payload as Readonly<Record<string, JsonValue>>, deliveryId, event },
    }
  },
  async reconcile(context) {
    const current = await webhookUrl(context)
    if (!context.active) {
      if (current == context.endpointUrl) await deleteWebhook(context)
      return { outcome: 'ready' }
    }
    if (current != '' && current != context.endpointUrl) {
      throw new PermanentIntegrationError(`The Telegram bot already sends updates to ${host(current)}.`)
    }
    const config = resolveConfig(context.config)
    await request(context, 'setWebhook', {
      allowed_updates: subscribedUpdates(config) ?? [],
      drop_pending_updates: current == '' && config.dropPendingUpdates,
      secret_token: context.callbackSecret,
      url: context.endpointUrl,
    })
    return { outcome: 'ready' }
  },
}

function resolveConfig(value: Readonly<Record<string, JsonValue>>): Config {
  return {
    chatIds: (value.chatIds as readonly string[] | undefined) ?? [],
    dropPendingUpdates: (value.dropPendingUpdates as boolean | undefined) ?? true,
    updates: value.updates as readonly string[],
    userIds: (value.userIds as readonly string[] | undefined) ?? [],
  }
}

function subscribedUpdates(config: Config): readonly string[] | null {
  if (!config.updates.includes('*')) return config.updates
  const named = config.updates.filter((value) => value != '*')
  return named.length == 0 ? null : [...new Set([...defaultUpdates, ...named])]
}

function sameSecret(candidate: string | undefined, expected: string): boolean {
  if (candidate == null || candidate.length != expected.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= candidate.charCodeAt(index) ^ expected.charCodeAt(index)
  return difference == 0
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value != null && typeof value == 'object' && !Array.isArray(value)
}

function id(value: JsonValue | undefined): string | undefined {
  if (!isRecord(value)) return
  return typeof value.id == 'string' || typeof value.id == 'number' ? String(value.id) : undefined
}

function resolveChatId(value: JsonValue | undefined): string | undefined {
  if (!isRecord(value)) return
  return id(value.chat) ?? (isRecord(value.message) ? id(value.message.chat) : undefined)
}

function resolveUserId(value: JsonValue | undefined): string | undefined {
  if (!isRecord(value)) return
  return id(value.from) ?? id(value.user)
}

async function webhookUrl(context: IntegrationReconcileContext): Promise<string> {
  const envelope = await request(context, 'getWebhookInfo')
  const url = isRecord(envelope.result) ? envelope.result.url : undefined
  if (typeof url != 'string') throw new TransientIntegrationError('Telegram getWebhookInfo response is missing result.url.')
  return url
}

async function deleteWebhook(context: IntegrationReconcileContext): Promise<void> {
  await request(context, 'deleteWebhook', { drop_pending_updates: false })
}

async function request(context: IntegrationReconcileContext, endpoint: string, body?: Readonly<Record<string, JsonValue>>): Promise<TelegramEnvelope> {
  let result: ConnectorProxyResult
  try {
    result = await context.connector.execute(
      { ...(body == null ? {} : { body }), endpoint: `/${endpoint}`, method: body == null ? 'GET' : 'POST' },
      context.signal,
    )
  } catch (cause) {
    if (cause instanceof IntegrationConnectionError) throw cause
    throw new TransientIntegrationError(`Telegram ${endpoint} request failed.`, { cause })
  }
  const envelope = isRecord(result.data) ? (result.data as TelegramEnvelope) : {}
  if (result.status >= 200 && result.status < 300 && envelope.ok === true) return envelope
  const message = typeof envelope.description == 'string' ? envelope.description : `HTTP ${result.status}`
  if (result.status == 401 || result.status == 403) throw new IntegrationConnectionError(`Telegram ${endpoint} rejected the Connection.`)
  if (result.status >= 400 && result.status < 500 && result.status != 429) {
    throw new PermanentIntegrationError(`Telegram ${endpoint} rejected the subscription: ${message}`)
  }
  throw new TransientIntegrationError(`Telegram ${endpoint} failed: ${message}`)
}

function host(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return 'an invalid URL'
  }
}
