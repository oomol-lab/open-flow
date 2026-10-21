# Provider Webhook Triggers

These Triggers use a Connector connection to manage their remote subscriptions. Publishing creates or reconciles the subscription; stopping the final publication removes its owned webhook. The Connector stores signing keys. Do not put keys in node inputs or example payloads.

| Trigger                      | Configuration                                                    | Events and output                                                                                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tally.on_form_response`     | Form                                                             | Complete submissions with original field keys, types, values and file metadata. See [Tally acceptance](tally-trigger.md).                                                                                                                                                       |
| `typeform.on_form_response`  | Form ID                                                          | Complete responses only; partial responses are excluded. `response` preserves answer field IDs/refs and file metadata.                                                                                                                                                          |
| `calendly.on_booking_event`  | User or organization scope; events                               | `invitee.created` and `invitee.canceled`; `body` preserves reschedule links. Requires a Personal Access Token, a webhook-capable plan, and permission for the selected scope. OAuth app signing keys are not supported by this Trigger.                                         |
| `pipedrive.on_crm_event`     | One event                                                        | New deals, new people, actual deal stage changes, or actual status changes. Webhooks v2 use the connected user's visibility. `body` contains current and previous data.                                                                                                         |
| `clickup.on_task_event`      | Workspace ID, optional List ID, events                           | Task creation, status changes and comments. Scope is established in the remote webhook. Updates are identified by history entries, not just task ID.                                                                                                                            |
| `resend.on_email_event`      | Events                                                           | `email.received`, `email.bounced`, `email.complained`. Requires a Full access API key; receiving also requires a configured receiving domain. Use the existing receiving actions for message content and attachments.                                                           |
| `pandadoc.on_document_event` | Completed documents only                                         | `document_state_changed`. Completion means the entire document, not one recipient. `events` contains the matching entries from one delivery. PandaDoc does not automatically retry failures; use the upstream event log for manual retry.                                       |
| `asana.on_task_event`        | Project ID, events, custom field ID when selecting field changes | Tasks added to a project (including existing tasks), completion, and selected custom field changes. `events` is a batch. Task details are fetched current state, not a historical snapshot; removed or inaccessible tasks are not represented as successful historical changes. |
| `vercel.on_deployment_event` | Team ID, Project ID, environment                                 | `deployment.ready` and `deployment.error`. Production requires `target: production`; preview requires a null target. Custom environments are included only with `all`.                                                                                                          |

Webhook receipt does not download files or run downstream actions synchronously. Do not copy file access URLs, callback URLs containing subscription tokens, credentials or raw sensitive payloads into public diagnostics.

The current Connector receive boundary is 64 KiB. Check representative large form, document and task deliveries during acceptance. A larger upstream limit does not increase this boundary.

Shared application/project sources (Slack Bot, Jira, Sentry, Intercom, Zoom and Fireflies) use a separate setup flow. See [Shared provider event sources](shared-event-sources.md).

## Recovery

Typeform uses a stable webhook tag, so retrying a creation updates the same resource. ClickUp, Resend and PandaDoc can recover an existing hook and its signing secret by listing/reading it. Calendly and Pipedrive use the Connector's retained callback secret.

Vercel and Asana only expose signing secrets on creation. When a creation response is lost, reconciliation locates the unique webhook with the owned callback URL, deletes it and recreates it. If multiple matching hooks exist, reconciliation stops for diagnosis. If a creation outcome remains uncertain and no matching hook can be found, it does not blindly create another one. Cleanup errors retain state for retry.

Asana's create request waits for an inbound handshake. Open Flow echoes that handshake at the preparing endpoint without admitting a Run or storing its supplied key. Only the authenticated create response supplies the persisted signing key.

## Manual acceptance

Run this checklist separately against the hosted and self-hosted Connector. Automated tests cover protocol behavior; they do not establish account permissions, upstream plan eligibility or actual event delivery.

1. Connect a dedicated test account with the required permissions. Create the Trigger through the Workbench or public authoring API, read it back, edit one business field, and validate the Flow. Connect a downstream action with an observable result.
2. Publish. Confirm a single owned webhook appears upstream, and the publication becomes ready. Record subscription identity without its secret or callback token.
3. Produce each configured business event. Confirm its output and exactly one Run. For forms, include non-ASCII text, null values, numbers, duplicate labels and files. For documents, distinguish recipient completion from whole-document completion. For Asana, compare current task state with the event reference.
4. Redeliver the same event: no second Run. Produce another change to the same business object: it must not be discarded as a duplicate. For batched PandaDoc/Asana deliveries, confirm the Run contains only matching entries.
5. Verify scope exclusion using another form/project/list/team or account. Verify malformed signatures do not start Runs. Test a no-longer-accessible resource and revoked permissions; errors must remain visible.
6. Stop the publication. Confirm the owned remote subscription is removed and late callbacks do not start Runs. Exercise a failed deletion followed by recovery. Re-publish and confirm there is no extra subscription.
7. For Calendly, test cancel/reschedule links. For Pipedrive, confirm unrelated property changes do not pass stage/status filtering. For Resend, test incoming mail, bounce and complaint separately. For Vercel, test production, preview, success and failure. Ensure downstream comments/status updates have conditions preventing loops.

## Protocol references

- [Typeform Webhooks](https://www.typeform.com/developers/webhooks/reference/create-or-update-webhook/)
- [Calendly signatures](https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures)
- [Pipedrive Webhooks v2](https://pipedrive.readme.io/docs/guide-for-webhooks-v2)
- [ClickUp Webhooks](https://developer.clickup.com/docs/webhooks)
- [Resend signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [PandaDoc verification](https://developers.pandadoc.com/docs/webhook-verification) and [events](https://developers.pandadoc.com/docs/webhook-events)
- [Asana Webhooks](https://developers.asana.com/docs/webhooks-guide)
- [Vercel Webhooks API](https://vercel.com/docs/webhooks/webhooks-api)
