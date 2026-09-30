import type { ConnectorProxy, TriggerOperationRequest } from '../../connector/common/proxy.ts'
import type { TriggerKeySnapshot } from '../../flow/common/change.ts'
import type { TriggerConfigOption } from '../common/configOptions.ts'
import type {
  IntegrationDefinition,
  IntegrationReceiveResult,
  IntegrationReconcileResult,
  IntegrationStateContext,
  ListenerPage,
} from '../common/integration.ts'
import type { PollDefinition, PollResult } from '../common/poll.ts'

import { isJsonObject } from '../../base/common/json.ts'
import { validateListenerPage, PermanentIntegrationError, IntegrationConnectionError } from '../common/integration.ts'
import { eventsPollOutputs, PermanentPollError, PollConnectionError } from '../common/poll.ts'
import catalog from './catalog.generated.json' with { type: 'json' }

async function execute(connector: ConnectorProxy, request: TriggerOperationRequest, signal?: AbortSignal, integration = false): Promise<unknown> {
  if (connector.trigger == null) throw new Error('Trigger operation transport is unavailable.')
  try {
    return await connector.trigger(request, signal)
  } catch (error) {
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'connector.input-invalid')
        throw !integration && (request.operation === 'read' || request.operation === 'options')
          ? new PermanentPollError(error.message)
          : new PermanentIntegrationError(error.message)
      if (error.code === 'connector.connection-required')
        throw !integration && (request.operation === 'read' || request.operation === 'options')
          ? new PollConnectionError(error.message)
          : new IntegrationConnectionError(error.message)
    }
    throw error
  }
}
async function saveState(value: unknown, state: IntegrationStateContext | undefined, checkpoint: 'always' | 'initialize' | 'never' = 'always') {
  if (!isJsonObject(value) || !isJsonObject(value.subscription) || typeof value.reconcileAt !== 'number' || !('checkpoint' in value))
    throw new Error('Invalid Trigger subscription response.')
  if (state == null) throw new Error('Trigger subscription state is unavailable.')
  if (checkpoint === 'always' || (checkpoint === 'initialize' && state.checkpoint === null)) await state.saveCheckpoint(value.checkpoint!)
  await state.saveSubscription(value.subscription, new Date(value.reconcileAt))
  return value
}
export const remoteTriggerDefinitions: readonly (PollDefinition | IntegrationDefinition)[] = catalog
  .filter((item) => !('eventSource' in item))
  .map(createDefinition)

function createDefinition(item: (typeof catalog)[number]): PollDefinition | IntegrationDefinition {
  const snapshot = item.snapshot as unknown as TriggerKeySnapshot
  const configOptions = item.options
    ? async (context: import('../common/configOptions.ts').TriggerConfigOptionsContext) => {
        if (!snapshot.configInputs.some((input) => 'handle' in input && input.handle === context.field))
          throw new PermanentPollError('Unknown Trigger configuration field.')
        const result = await execute(context.connector, { operation: 'options', config: context.config, field: context.field }, context.signal)
        if (!Array.isArray(result) || result.some((option) => !isJsonObject(option) || typeof option.value !== 'string' || typeof option.label !== 'string'))
          throw new Error('Invalid Trigger options response.')
        return result as TriggerConfigOption[]
      }
    : undefined
  if (snapshot.type === 'poll')
    return {
      snapshot,
      configOptions,
      buildOutputs: eventsPollOutputs,
      async poll(context) {
        const result = await execute(context.connector, { operation: 'read', config: context.config, checkpoint: context.checkpoint }, context.signal)
        if (
          !isJsonObject(result) ||
          !Array.isArray(result.events) ||
          !('checkpoint' in result) ||
          result.events.some((event) => !isJsonObject(event) || typeof event.dedupeKey !== 'string' || !isJsonObject(event.payload))
        )
          throw new Error('Invalid Trigger read response.')
        return result as unknown as PollResult
      },
    } satisfies PollDefinition
  return {
    snapshot,
    configOptions,
    initialState: { checkpoint: null, subscription: {} },
    ...('intervalMs' in item
      ? {
          listener: {
            intervalMs: item.intervalMs!,
            async read(context: import('../common/integration.ts').ListenerReadContext) {
              const result = await execute(
                context.connector,
                { operation: 'read', config: context.config, checkpoint: context.checkpoint },
                context.signal,
                true,
              )
              validateListenerPage(result)
              return result as ListenerPage
            },
          },
        }
      : {}),
    async reconcile(context) {
      if (context.state != null && Object.keys(context.state.subscription).length > 0 && typeof context.state.subscription.id !== 'string')
        throw new PermanentIntegrationError(
          'This subscription predates connector-owned Triggers. Remove its remote webhook with the previous deployment before recreating it.',
        )
      const result = await saveState(
        await execute(
          context.connector,
          {
            operation: 'reconcile',
            subscriptionId: typeof context.state?.subscription.id === 'string' ? context.state.subscription.id : undefined,
            config: context.config,
            requestKey: context.idempotencyKey,
            endpointUrl: context.endpointUrl,
            active: context.active,
          },
          context.signal,
        ),
        context.state,
        'intervalMs' in item ? 'initialize' : 'always',
      )
      if (result.outcome !== 'ready' && result.outcome !== 'pending') throw new Error('Invalid Trigger reconciliation response.')
      return { outcome: result.outcome } as IntegrationReconcileResult
    },
    async receive(context) {
      const id = context.state?.subscription.id
      if (typeof id !== 'string') return { outcome: 'respond', status: 503, body: '', contentType: 'text/plain' }
      const headers: Record<string, string> = {}
      for (const name of [
        'content-type',
        'idempotency-key',
        'stripe-signature',
        'x-github-delivery',
        'x-github-event',
        'x-gitlab-event',
        'x-gitlab-token',
        'x-goog-changed',
        'x-goog-channel-id',
        'x-goog-channel-token',
        'x-goog-message-number',
        'x-goog-resource-id',
        'x-goog-resource-state',
        'x-goog-resource-uri',
        'x-hub-signature-256',
        'x-shopify-api-version',
        'x-shopify-event-id',
        'x-shopify-shop-domain',
        'x-shopify-topic',
        'x-shopify-triggered-at',
        'x-shopify-webhook-id',
        'x-telegram-bot-api-secret-token',
        'x-wc-webhook-delivery-id',
        'x-wc-webhook-event',
        'x-wc-webhook-id',
        'x-wc-webhook-resource',
        'x-wc-webhook-signature',
        'x-wc-webhook-source',
        'x-wc-webhook-topic',
        'x-zendesk-webhook-signature',
        'x-zendesk-webhook-signature-timestamp',
      ]) {
        const value = context.header(name)
        if (value != null) headers[name] = value
      }
      const query: Record<string, string> = {}
      for (const name of ['open_flow_callback']) {
        const value = context.query(name)
        if (value != null) query[name] = value
      }
      let binary = ''
      for (const byte of context.rawBody) binary += String.fromCharCode(byte)
      const result = await execute(
        context.connector,
        {
          operation: 'receive',
          subscriptionId: id,
          method: context.method,
          headers,
          query,
          rawBody: btoa(binary),
          admit: context.admit,
          current: context.current,
        },
        context.signal,
      )
      if (!isJsonObject(result) || !isJsonObject(result.result) || typeof result.result.outcome !== 'string')
        throw new Error('Invalid Trigger callback response.')
      // 业务 checkpoint 由运行时在事件准入后提交。
      if (result.result.outcome !== 'respond') await saveState(result, context.state, 'never')
      return result.result as unknown as IntegrationReceiveResult
    },
  } satisfies IntegrationDefinition
}
