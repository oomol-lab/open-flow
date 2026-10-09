# Flow Error

Flow Error sends the failure context of a production automatic Run to another Flow.
Use it to send notifications, record incidents, or run custom handling.

## Configuration

1. Create an error-handler Flow.
2. Add **Flow Error** to the root graph.
3. Connect Flow Error to the handler nodes.
4. In the property panel's upstream workflow selector, search for and select one or more published Flows.
5. Publish the handler Flow.
6. Confirm that the Flow is enabled and Flow Error is not paused.

The subscription takes effect when these conditions are met. You do not need to change or republish upstream Flows.

You cannot select the current Flow, an unpublished Flow, or a deleted Flow.
You can select a published upstream Flow whose execution is paused. Listening resumes when automatic execution resumes.
Each Flow Error can listen to multiple upstream Flows. Multiple handler Flows can listen to the same upstream Flow.

The Flow Error node stores the subscription list in `sourceFlowIds`. The list is saved with the Draft and supports undo and redo.
Historical published versions are read-only.

If a selected upstream Flow becomes unavailable, the UI keeps the selection and shows a warning. You can remove the selection.
Server checks upstream eligibility again at publication. An empty list means that the node listens to no Flows.

## Relationships and activation

Publishing the handler Flow updates its live `error_subscriptions` index in the same transaction.
Unpublished Draft changes do not affect live subscriptions. Removing Flow Error and publishing again clears the subscriptions.

When a source Run fails, Server finds listeners that are currently published, enabled, and not paused.
It saves one pending dispatch record for each handler Flow.

At dispatch, Server rechecks the subscription and handler availability. If the subscription has been removed, Server records a start failure.
Dispatch admission fixes the handler Flow's current Live version.

## Trigger rules

Only production automatic Runs, such as Webhook, Schedule, and Poll Runs, dispatch errors when they finally fail or have an unknown outcome (`indeterminate`).
Manual Draft and Live Runs, successful Runs, and canceled Runs do not trigger dispatch.

Each failed Run creates at most one handler Run for each subscribed handler Flow.
When the queue is full, dispatch waits for capacity. Dispatch continues after a service restart.
If the target is unavailable at dispatch, Server records an error-handler start failure.
A failed handler Run does not trigger other handler Flows. Mutual subscriptions therefore cannot create a loop.

The source Run keeps its failed state. Successful error handling does not mean that the source Run was retried successfully.
`indeterminate` means that execution could not be confirmed. External side effects might already have occurred, so this state does not establish that a retry is safe.

## Outputs and testing

Flow Error provides three object outputs:

- `workflow`: source Flow name, ID, fixed Revision, and Publication.
- `execution`: source Run ID, terminal state, start time, and end time.
- `error`: error code, message, and available failed-node and execution IDs.

Select Flow Error in the handler Flow's Run menu to test downstream branches with prefilled sample data.
This does not create a fake production failure or dispatch another error handler.

The source Run detail shows whether dispatch is pending, a handler Run was created, or the handler could not start.
If a handler Run exists, you can open it from the source Run. The handler Run detail links back to the source Run.
