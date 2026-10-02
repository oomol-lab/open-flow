export { feishuSubscriptions } from './feishu/subscriptions.ts'
import { feishuEvents } from './feishu/on-event.ts'
export { receiveFeishuEvent, matchesFeishuEvent, type FeishuEvent } from './feishu/events.ts'
import type { IntegrationDefinition } from '../common/integration.ts'
import type { PollDefinition } from '../common/poll.ts'

import { remoteTriggerDefinitions } from './remote.ts'
export type ProviderTriggerDefinition = IntegrationDefinition | PollDefinition
export const triggerDefinitions: readonly ProviderTriggerDefinition[] = [...feishuEvents, ...remoteTriggerDefinitions]

export const pollDefinitions: readonly PollDefinition[] = triggerDefinitions.filter(
  (definition): definition is PollDefinition => definition.snapshot.type == 'poll',
)

export const integrationDefinitions: readonly IntegrationDefinition[] = triggerDefinitions.filter(
  (definition): definition is IntegrationDefinition => definition.snapshot.type == 'integration',
)

export type { TriggerConfigOption, TriggerConfigOptionsContext } from '../common/configOptions.ts'

export { localizeTrigger } from './localization.ts'
