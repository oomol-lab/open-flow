import type { TriggerDisplay } from '../../control/common/triggerCatalog.ts'

type FieldDescriptions = Pick<TriggerDisplay, 'configInputs' | 'outputs'>

const driveChangesConfig = {
  driveId: 'Shared drive ID. Leave empty to monitor the connected account.',
  includeCorpusRemovals: 'Include the accessible file resource when an item leaves the change corpus.',
  includeItemsFromAllDrives: 'Include items from My Drive and shared drives.',
  includeRemoved: 'Include changes caused by deletion or loss of access.',
  pageSize: 'Maximum number of changes included in one Flow Run.',
  restrictToMyDrive: 'Restrict changes to the My Drive hierarchy.',
}

export const englishTriggerFieldDescriptions = {
  'feishu_app_bot.on_event': {
    configInputs: {
      sourceId: 'Event source that receives events for this trigger.',
      eventTypes: 'Feishu event types that trigger a Run.',
      chatIds: 'Chat IDs to receive events from. Leave empty to receive events from every chat available to the source.',
      resource: 'Optional document, calendar, or approval resource to subscribe to.',
    },
    outputs: {
      event: 'Feishu event type.',
      deliveryId: 'Unique delivery ID for this event.',
      appId: 'ID of the Feishu application that received the event.',
      tenantKey: 'Key of the Feishu tenant that produced the event.',
      occurredAt: 'Time when the event occurred, when supplied by Feishu.',
      body: 'Original Feishu event payload.',
    },
  },
  'airtable.on_record_changed': {
    configInputs: {
      baseId: 'ID of the Airtable base to monitor.',
      fields: 'Fields to include in each returned record. Leave empty to include every field.',
      formula: 'Airtable formula used to filter records. Leave empty to include every record.',
      maxRecordsPerPoll: 'Maximum number of records processed per poll.',
      tableIdOrName: 'ID or name of the Airtable table to monitor.',
      triggerField: 'Date or time field used to detect created or updated records.',
      view: 'Airtable view used to filter and order records. Leave empty to use the table default.',
    },
    outputs: { events: 'Records created or updated since the previous poll.' },
  },
  'gmail.on_message_received': {
    configInputs: {
      includeDrafts: 'Also trigger on draft messages.',
      includeSpamAndTrash: 'Also trigger on messages in Spam and Trash.',
      labelNamesOrIds: 'Only trigger on messages carrying all of these labels, referenced by name or ID.',
      maxMessagesPerPoll: 'Maximum number of messages processed per poll.',
      readStatus: 'Only trigger on read messages, unread messages, or both.',
      search: 'Gmail search query that each message must match.',
      sender: 'Only trigger on messages whose sender matches this address or name.',
    },
    outputs: { events: 'Messages received since the previous poll.' },
  },
  'github.on_repo_event': {
    configInputs: {
      events: 'GitHub webhook events that trigger a Run.',
      insecureSsl: 'Allow GitHub to deliver webhooks without SSL certificate verification.',
      owner: 'Owner of the GitHub repository.',
      repo: 'Name of the GitHub repository.',
    },
    outputs: {
      body: 'Original GitHub webhook payload.',
      deliveryId: 'Unique GitHub webhook delivery ID.',
      event: 'GitHub webhook event name.',
    },
  },
  'github.watch_pull_request': {
    configInputs: {
      owner: 'Owner of the GitHub repository.',
      repo: 'Name of the GitHub repository.',
      number: 'Number of the pull request to watch.',
    },
    outputs: {
      pullRequest: 'Current pull request details after an observed change.',
      version: 'Stable identifier for the observed pull request version.',
    },
  },
  'gitlab.on_project_event': {
    configInputs: {
      events: 'GitLab project events that trigger a Run.',
      insecureSsl: 'Allow GitLab to deliver webhooks without SSL certificate verification.',
      project: 'Numeric project ID or URL-encoded project path.',
      pushBranchFilter: 'Branch or wildcard pattern used to filter push events. Leave empty to include every branch.',
    },
    outputs: {
      body: 'Original GitLab webhook payload.',
      deliveryId: 'Unique ID generated for this webhook delivery.',
      event: 'Normalized GitLab event name.',
      gitlabEvent: 'Original GitLab event header value.',
    },
  },
  'googlecalendar.on_event_changed': {
    configInputs: {
      calendarId: 'ID of the Google Calendar to monitor.',
      changes: 'Calendar event changes that trigger a Run.',
      matchTerm: 'Text that must appear in the event summary, description, location, or attendees. Leave empty to match every event.',
      maxEventsPerPoll: 'Maximum number of calendar events processed per poll.',
    },
    outputs: { events: 'Calendar events created, updated, or cancelled since the previous poll.' },
  },
  'googledrive.changes_detected': {
    configInputs: driveChangesConfig,
    outputs: { events: 'Google Drive changes available when the notification was received.' },
  },
  'googledrive.watch_changes': {
    configInputs: driveChangesConfig,
    outputs: { events: 'Google Drive changes observed by notifications or periodic scans.' },
  },
  'googledrive.on_file_change': {
    configInputs: {
      changeType: 'Whether created or updated items trigger a Run.',
      driveId: 'Shared drive ID. Leave empty to use My Drive.',
      folderId: 'ID of the Google Drive folder to monitor.',
      itemTypes: 'Whether to monitor files, folders, or both.',
      maxFilesPerPoll: 'Maximum number of changed items processed per poll.',
      mimeTypes: 'Only trigger on these MIME types. Leave empty to include every MIME type.',
      namePrefix: 'Only trigger on items whose names start with this text. Leave empty to include every name.',
    },
    outputs: { events: 'Files or folders created or updated since the previous poll.' },
  },
  'googlesheets.on_row_added': {
    configInputs: {
      columnRange: 'A1 column range to read, such as A:Z.',
      dateTimeRender: 'How date and time values are returned.',
      firstDataRow: 'First row containing data below the header.',
      headerRow: 'Row whose cells become output field names.',
      maxRowsPerPoll: 'Maximum number of new rows processed per poll.',
      sheet: 'Name of the worksheet to monitor.',
      spreadsheetId: 'ID of the Google Sheets spreadsheet.',
      valueRender: 'How cell values are returned.',
    },
    outputs: { events: 'Rows appended since the previous poll.' },
  },
  'linear.on_issue_changed': {
    configInputs: {
      teamId: 'Linear Team UUID. Use Copy model UUID in Linear to find it.',
      stateIds: 'Statuses from the selected Team. Leave empty for every status. Matches current status, not every transition into it.',
    },
    outputs: { events: 'Linear issues created or updated since the previous poll.' },
  },
  'notion.on_database_page_event': {
    configInputs: {
      dataSourceId: 'Data source ID within the database. Leave empty to use the primary data source.',
      databaseId: 'ID of the Notion database to monitor.',
      events: 'Page changes that trigger a Run.',
      includeProperties: 'Include page properties in each output event.',
      maxItemsPerPoll: 'Maximum number of changed pages processed per poll.',
    },
    outputs: { events: 'Database pages added or updated since the previous poll.' },
  },
  'one_drive.on_item_changed': {
    configInputs: {
      events: 'OneDrive item changes that trigger a Run.',
      itemId: 'Only monitor this file or folder ID. Leave empty to monitor multiple items.',
      itemTypes: 'Whether to monitor files, folders, or both.',
      maxItemsPerPoll: 'Maximum number of changed items processed per poll.',
      parentFolderId: 'Only monitor items in this parent folder. Leave empty to monitor the whole drive.',
    },
    outputs: { events: 'OneDrive items created, updated, or deleted since the previous poll.' },
  },
  'outlook.on_message_received': {
    configInputs: {
      folder: 'Well-known mail folder name, folder ID, or an empty value for the whole mailbox.',
      includeDrafts: 'Also trigger on draft messages.',
      maxMessagesPerPoll: 'Maximum number of messages processed per poll.',
      readStatus: 'Only trigger on read messages, unread messages, or both.',
      senderAddress: 'Exact sender address. Leave empty to allow any sender.',
      subjectContains: 'Case-insensitive text that must appear in the message subject.',
      withAttachmentsOnly: 'Only trigger on messages that have attachments.',
    },
    outputs: { events: 'Outlook messages received since the previous poll.' },
  },
  'shopify.on_shop_event': {
    configInputs: { topics: 'Shopify webhook topics that trigger a Run.' },
    outputs: {
      apiVersion: 'Shopify API version used for the webhook.',
      body: 'Original Shopify webhook payload.',
      eventId: 'Unique Shopify event ID.',
      shopDomain: 'Domain of the Shopify shop that produced the event.',
      topic: 'Shopify webhook topic.',
      triggeredAt: 'Time when Shopify triggered the webhook.',
      webhookId: 'ID of the Shopify webhook subscription.',
    },
  },
  'slack.on_message_posted': {
    configInputs: {
      channelId: 'Slack conversation ID to watch, such as C0122KQ70S7E.',
      fromUserIds: 'Only trigger on messages from these Slack user IDs. Leave empty to allow any author.',
      ignoreUserIds: 'Never trigger on messages from these Slack user IDs.',
      includeBotMessages: 'Also trigger on messages posted by bots and apps.',
      includeSystemMessages: 'Also trigger on Slack system notices.',
      maxMessagesPerPoll: 'Maximum number of messages processed per poll.',
      textContains: 'Only trigger when message text contains this string, ignoring case.',
    },
    outputs: { events: 'Slack messages posted since the previous poll.' },
  },
  'stripe.on_event': {
    configInputs: {
      apiVersion: 'Stripe API version used for webhook events. Leave empty to use the account default.',
      events: 'Stripe event types that trigger a Run.',
      includeConnectedAccounts: 'Also receive events from connected Stripe accounts.',
    },
    outputs: {
      body: 'Original Stripe event payload.',
      event: 'Stripe event type.',
      eventId: 'Unique Stripe event ID.',
      livemode: 'Whether the event was created in live mode.',
    },
  },
  'telegram.on_update': {
    configInputs: {
      chatIds: 'Only accept updates from these numeric Telegram chat IDs. Leave empty to allow every chat.',
      dropPendingUpdates: 'Discard updates queued before the webhook is created or resumed.',
      updates: 'Telegram update types that trigger a Run. Use * for the Telegram default set.',
      userIds: 'Only accept updates from these numeric Telegram user IDs. Leave empty to allow every user.',
    },
    outputs: {
      body: 'Original Telegram update payload.',
      deliveryId: 'Unique ID generated for this Telegram update.',
      event: 'Telegram update type.',
    },
  },
  'woocommerce.on_store_event': {
    configInputs: {
      events: 'WooCommerce store events that trigger a Run.',
      webhookName: 'Name shown for the webhook in WooCommerce.',
    },
    outputs: {
      body: 'Original WooCommerce webhook payload.',
      deliveryId: 'Unique WooCommerce webhook delivery ID.',
      event: 'WooCommerce event action.',
      resource: 'WooCommerce resource type.',
      source: 'URL of the WooCommerce store that produced the event.',
      topic: 'Full WooCommerce webhook topic.',
      webhookId: 'ID of the WooCommerce webhook subscription.',
    },
  },
  'zendesk.on_event': {
    configInputs: { events: 'Zendesk event types that trigger a Run.' },
    outputs: {
      body: 'Original Zendesk event payload.',
      deliveryId: 'Unique ID generated for this Zendesk event delivery.',
      event: 'Zendesk event type.',
      subject: 'Zendesk subject associated with the event.',
    },
  },
} as const satisfies Readonly<Record<string, FieldDescriptions>>
