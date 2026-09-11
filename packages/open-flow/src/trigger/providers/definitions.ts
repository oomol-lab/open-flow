import type { IntegrationDefinition } from '../common/integration.ts'
import type { PollDefinition } from '../common/poll.ts'

import { airtableRecordChanged } from './airtable/on-record-changed.ts'
import { githubRepoEvent } from './github/on-repo-event.ts'
import { githubPullRequestListener } from './github/watch-pull-request.ts'
import { gitlabProjectEvent } from './gitlab/on-project-event.ts'
import { gmailMessageReceived } from './gmail/on-message-received.ts'
import { googleCalendarEventChanged } from './google-calendar/on-event-changed.ts'
import { googleDriveChangeListener, googleDriveChanges } from './google-drive/changes.ts'
import { googleDriveFileChange } from './google-drive/on-file-change.ts'
import { googleSheetsRowAdded } from './google-sheets/on-row-added.ts'
import { linearIssueChanged } from './linear/on-issue-changed.ts'
import { notionDatabasePageEvent } from './notion/on-database-page-event.ts'
import { oneDriveItemChanged } from './one-drive/on-item-changed.ts'
import { outlookMessageReceived } from './outlook/on-message-received.ts'
import { shopifyShopEvent } from './shopify/on-shop-event.ts'
import { slackMessagePosted } from './slack/on-message-posted.ts'
import { stripeEvent } from './stripe/on-event.ts'
import { telegramUpdate } from './telegram/on-update.ts'
import { wooCommerceStoreEvent } from './woocommerce/on-store-event.ts'
import { zendeskEvent } from './zendesk/on-event.ts'

export type ProviderTriggerDefinition = IntegrationDefinition | PollDefinition

export const triggerDefinitions: readonly ProviderTriggerDefinition[] = [
  airtableRecordChanged,
  gmailMessageReceived,
  githubRepoEvent,
  githubPullRequestListener,
  gitlabProjectEvent,
  googleCalendarEventChanged,
  googleDriveChanges,
  googleDriveChangeListener,
  googleDriveFileChange,
  googleSheetsRowAdded,
  linearIssueChanged,
  notionDatabasePageEvent,
  oneDriveItemChanged,
  outlookMessageReceived,
  shopifyShopEvent,
  slackMessagePosted,
  stripeEvent,
  telegramUpdate,
  wooCommerceStoreEvent,
  zendeskEvent,
]

export const pollDefinitions: readonly PollDefinition[] = triggerDefinitions.filter(
  (definition): definition is PollDefinition => definition.snapshot.type == 'poll',
)

export const integrationDefinitions: readonly IntegrationDefinition[] = triggerDefinitions.filter(
  (definition): definition is IntegrationDefinition => definition.snapshot.type == 'integration',
)

export type { TriggerConfigOption, TriggerConfigOptionsContext } from '../common/configOptions.ts'

export { localizeTrigger } from './localization.ts'
