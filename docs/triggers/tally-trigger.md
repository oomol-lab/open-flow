# Tally Form Response Trigger

`tally.on_form_response` receives new submissions for one Tally form through an automatically managed,
signed webhook. Select a Tally Connection and a form in Workbench. The connection must have access to
the form and permission to manage webhooks. Publishing requires the Server's public HTTPS integration
callback configuration.

The form picker loads forms through the selected Connection, supports pagination, and retains a saved
form ID if a lookup fails or the form is no longer accessible. An unavailable form is marked invalid;
it is never silently replaced. Opening the picker refreshes its choices.

Programmatic authoring supplies the form as an input:

```json
{
  "op": "node.add",
  "type": "integration",
  "as": "submission",
  "name": "Customer enquiries",
  "config": {
    "key": "tally.on_form_response",
    "connectionId": "your-tally-connection"
  },
  "inputs": {
    "formId": { "kind": "value", "value": "your-form-id" }
  }
}
```

The single `response` output contains `eventId`, `createdAt`, `formId`, `submissionId`, `responseId`,
and `fields`, plus the other data supplied by Tally. Fields retain their stable `key`, `type`, `label`,
`value`, and optional `options`. Labels may repeat or be null. File values retain their metadata;
the Trigger does not download attachments. Treat file access URLs as sensitive data when using
downstream logging Actions.

The Connector verifies `tally-signature` using Tally's documented JSON serialization, filters by event
type and form ID, and uses `eventId` for deduplication. Repeated deliveries of the same event do not
create another Run. The callback acknowledges accepted events with HTTP 200. The Connector currently
limits the decoded callback body to 64 KiB.

The Connector owns webhook identity and signing secrets. Reconciliation aligns the owned webhook and
removes it when the subscription is stopped. If creation loses its response, reconciliation searches
all webhook pages for the same form and exact callback URL before creating anything. Multiple matches
or an unresolved creation outcome require operator verification; the Trigger reports the problem
instead of creating another webhook. Failed deletion remains retryable.

Manual acceptance should be performed separately against each Connector backend:

1. Connect a Tally test account, choose a form, publish, and confirm the subscription becomes ready.
   Confirm that the form has one webhook owned by this subscription.
2. Submit text with non-ASCII characters, numbers, null values, repeated labels, choices, and a file.
   Inspect the `response` output and pass selected values to a spreadsheet or notification Action.
3. Redeliver the same event and confirm that only one Run exists. Make another submission and confirm
   it creates a new Run.
4. Verify that an invalid signature and an event for another form create no Runs.
5. Stop the publication, confirm the owned webhook is removed, and confirm that old deliveries create
   no Runs. Republish and verify that new submissions work again.
6. Interrupt webhook creation and cleanup, restart the deployment, and verify recovery without
   duplicate subscriptions. Check diagnostics for permission failures and unavailable forms.

Automated protocol and Server tests use deterministic fixtures. They do not establish external Tally
acceptance, account permissions, or public callback reachability.
