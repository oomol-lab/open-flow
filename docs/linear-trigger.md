# Linear Issue Trigger

`linear.on_issue_changed` listens for new and updated Issues in one Linear Team. Workbench displays
it as **Linear: Issue Created or Updated** in the application Trigger catalog.

## Configuration

- **Connection:** a Linear Connection with read access to the Team. Workbench selects an active
  default Connection when creating the Trigger, or the only active Connection if no default exists.
- **Team:** choose from the Teams accessible to the selected Connection.
- **Issue statuses:** choose from that Team's current statuses. Names and colors come from Linear;
  configuration stores stable status IDs in `stateIds`, so renaming a status does not break the filter.
  Leave the selection empty to include all statuses.
- **Schedule:** the standard Trigger schedule, initially every five minutes.

Changing the Connection clears the Team and status selections in the same Draft change. Changing the
Team clears the status selections in the same change. Missing Teams or statuses remain visible as errors;
the editor does not silently replace them or broaden the selection. Failed lookups support retry, and
responses from an obsolete Connection or Team are discarded. Read-only views never save configuration.

Programmatic authoring uses `teamId` and optional `stateIds` (UUIDs). Workbench loads choices through
`GET /v1/flows/:flowId/triggers/:triggerNodeId/options/:field`. The Server resolves the saved Draft's
Connection and configuration in the Flow's Connector Team scope; clients cannot supply arbitrary proxy
requests or credentials. Listing options does not create Runs, subscriptions or production bindings.

Status filtering applies to the Issue's current state when Linear answers the query. An Issue updated
while already in `Done` also matches `Done`; the filter does not mean “only when entering Done”.

## Initialization and output

Publication preparation verifies Team access and saves the current time as the starting point. It
creates no Runs for existing Issues. Later queries include Issues created or updated after that point,
including existing Issues that subsequently change. Archived Issues are included if still readable.

Each accepted page creates at most one Run, with up to 50 fresh entries in `payload.events`. Each entry
contains `id`, `identifier`, `title`, `url`, `teamId`, `createdAt`, `updatedAt`, and `state` (`id`, `name`,
`type`). The output is a current-state snapshot; it does not classify each update as a separate historical
creation or transition event. Use the Issue ID with a Linear Action when more fields are needed.

## Reading and recovery

The Trigger uses the existing unified reader through a Poll definition. It queries Linear GraphQL via
the selected Connection; it does not create a Webhook or need an Integration callback URL. Linear
Webhook management requires workspace admin privileges or OAuth `admin` scope, which the current
Connector's OAuth scope set does not request.

Each scan fixes its upper time bound and retains that bound across pagination and retries. Completed
scans overlap the previous minute, never going before the original baseline. Stable Issue ID plus
`updatedAt` identities let the runtime suppress repeated entries across pages and overlap scans within
its dedupe retention period. Capacity failures do not advance accepted progress; pauses, restarts and
unchanged publications use the existing persisted progress and lifecycle rules.

GraphQL errors are checked even when HTTP status is 200. A partial response with errors is not accepted.
Authorization failures, unavailable Teams, rate limits, malformed pages and invalid saved checkpoints
are reported without silently rebuilding the baseline.

The query is not an immutable change log. Deletions, loss of access, moves out of the Team, and intermediate
states that disappear before a query cannot be reconstructed. The one-minute overlap reduces boundary
and short indexing delays; it does not guarantee recovery from arbitrary indexing delays or clock skew.
A long pause can recover only the matching current states still exposed by Linear, not every intervening
change. Updates to related entities that do not change Issue `updatedAt` are outside this Trigger's scope.

## Protocol references

- [Linear GraphQL](https://linear.app/developers/graphql)
- [Filtering](https://linear.app/developers/filtering) and [pagination](https://linear.app/developers/pagination)
- [Rate limits and GraphQL error codes](https://linear.app/developers/rate-limiting)
- [Webhook permissions](https://linear.app/developers/webhooks)
- [Official SDK GraphQL schema](https://github.com/linear/linear/blob/master/packages/sdk/src/schema.graphql)
