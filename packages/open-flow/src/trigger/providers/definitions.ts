import type { IntegrationDefinition } from '../common/integration.ts'
import type { PollDefinition } from '../common/poll.ts'

import { remoteTriggerDefinitions } from './remote.ts'
import { sourceEvents } from './source-events.ts'
export type ProviderTriggerDefinition = IntegrationDefinition | PollDefinition
export const triggerDefinitions: readonly ProviderTriggerDefinition[] = [...sourceEvents, ...remoteTriggerDefinitions]

export const pollDefinitions: readonly PollDefinition[] = triggerDefinitions.filter(
  (definition): definition is PollDefinition => definition.snapshot.type == 'poll',
)

export const integrationDefinitions: readonly IntegrationDefinition[] = triggerDefinitions.filter(
  (definition): definition is IntegrationDefinition => definition.snapshot.type == 'integration',
)

export type { TriggerConfigOption, TriggerConfigOptionsContext } from '../common/configOptions.ts'

export { localizeTrigger } from './localization.ts'
