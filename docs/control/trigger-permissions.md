# Trigger permissions and execution

## Permission sources

### Open-source OpenConnector

Self-hosted OpenConnector uses separate `allowedTriggers` authorization. Deployment and runtime policies may also set `blockedTriggers`. Allow rules intersect across layers; block rules take precedence. A legacy runtime token without `allowedTriggers` cannot execute Triggers. Action and general proxy permissions do not grant Trigger access.

Requests select a stable connection ID through `x-oo-connector-app-id`. If a request also supplies an alias, it must resolve to the same connection.

`reconcile`, `receive`, and `resource` require a persistent runtime token created through the management API. Subscriptions are isolated by token ID, connection, verified provider account, and Trigger. Environment tokens and JWTs cannot own remote subscriptions. Request bodies reject `accessGrant`.

The first version executes only local connections. It does not support SaaS or Marketplace sources. Each provider’s permission metadata describes required third-party permissions. Requests use the connection’s upstream permissions.

OpenConnector stores subscription state in SQLite, PostgreSQL, or D1. It encrypts state with the deployment’s secret codec and serializes control operations through leases. Maintenance cleans up a subscription’s remote resources if its Token is revoked or current policy no longer permits it. Open Flow still drives normal renewal.

Complete cleanup before disconnecting or changing accounts. Reauthorization of the verified original account can restore cleanup access. Administrators may explicitly abandon a subscription while retaining a ledger of resources not cleaned up. Management endpoints are `/api/trigger-subscriptions` and each record’s `/cancel` and `/abandon`.

Rotate an OpenConnector token in this order:

1. Clean up subscriptions by the old token ID.
2. Drain Open Flow webhook/watch subscription IDs and the Feishu `source_subscriptions` ready cache.
3. Switch tokens.
4. Explicitly rebuild bindings.

Preserve business checkpoints. Do not reuse remote subscription identities owned by the old token. See the [self-hosting guide](../server/self-hosted-stack/README.md) for deployment steps.

### Managed connector

Users can deploy Open Flow themselves. The connector uses the same Token identity and authorization chain as Action execute. Authentication headers must still come only from a trusted gateway:

| Identity                         | Authorization                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| User/service-account Token       | Query current relation-control app-access for the actual principal. Reject `accessGrant`. |
| team-token with `accessGrant`    | Check that the grant permits the Trigger within the authenticated Team.                   |
| team-token without `accessGrant` | Use Team execution permissions without querying a user’s app-access.                      |

All paths check the connection’s Team, provider, credentials, and scopes. Deployed Open Flow uses a team-token. Like the current Action client, ordinary Trigger calls do not automatically submit a grant. A Team token holder can omit the grant. A client-supplied grant therefore narrows only that call; it is not proof of user permissions that an untrusted deployment cannot bypass.

Permission groups add `triggers: "*" | string[]`, with full Trigger IDs in lists. Default groups, custom groups, and member assignments use the existing app-access model. For example, allow only the new-mail Trigger on one connection:

```json
{ "actions": [], "triggers": ["gmail.on_message_received"] }
```

Omitting `actions` retains access to all Actions. Omitting `triggers` retains all Triggers only for legacy unrestricted authorization. Existing restricted Action grants do not automatically gain Trigger access.

`triggers` does not change existing general proxy or `call_tool` rules. Those calls are allowed only when both `actions` and `appAccessConfig` are unset. Trigger-only grants must explicitly set `actions: []`.

A user holding a broad Token retains its original permissions. Open Flow UI selections cannot narrow the Token’s authority.

## Metadata and operations

`GET /v1/providers/:service/trigger-permissions?locale=zh-CN` returns Trigger IDs, names, descriptions, authentication types, internal requiredScopes, third-party providerPermissions, and instructions. Internal scopes do not represent all fine-grained third-party permissions. The frontend should also display the instructions.

`POST /v1/providers/:service/triggers/:triggerId/execute` uses existing connection selection headers/query parameters. Its body is a strict `operation` union:

| operation   | Fields                                                                               | Purpose                                                              |
| ----------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `options`   | `config`, `field`                                                                    | Query registered configuration options.                              |
| `read`      | `config`, `checkpoint`                                                               | Execute a fixed single-page Poll or listener read.                   |
| `reconcile` | `config`, `endpointUrl`, `requestKey`, `active`, optional `subscriptionId`           | Create, maintain, or delete a server-owned webhook.                  |
| `receive`   | `subscriptionId`, `method`, `headers`, `query`, Base64 `rawBody`, `admit`, `current` | Process third-party callbacks with server configuration and secrets. |
| `resource`  | `config`, `requestKey`, `active`                                                     | Manage shared Feishu resource subscriptions.                         |

Only managed connector team-tokens may include optional `accessGrant` in these request bodies, using the Action execute format. User/service-account callers cannot submit it. No caller can submit an upstream endpoint/method/body, remote hook/channel ID, or cleanup privilege. Request information in `receive` is only callback verification input. Unknown fields and unsupported operations are rejected, with no raw proxy fallback. Third-party transport still reuses connector proxying, credential resolution, and the execution lifecycle.

The server validates configuration fields and cursors. Provider implementations construct upstream requests. Authorization is scoped to a connection and Trigger ID. Repositories, labels, and time windows in configuration are business filters, not separate resource ACLs granted by an administrator.

## State and cleanup

The connector encrypts stored Team, principal, connection, Trigger, immutable configuration, callback, remote resource ID, and verification secrets. User/service-account subscriptions belong to the actual principal. team-token subscriptions belong to the authenticated Team; the audit actor does not affect ownership. team-tokens for the same Team share execution authority and are not isolated by client-reported deployment names.

Idempotency keys are scoped by Team, principal, connection, and Trigger. Later operations may supply a connector-issued subscription ID; the server rechecks ownership. Changing a key cannot reuse another principal’s subscription or alter bound configuration or callbacks.

The server adds a separately generated random identifier to each record’s callback. If a remote creation response is lost, recovery uses only that record’s complete callback URL. It does not claim an existing webhook by the caller’s original URL. Telegram still rejects conflicts with its single webhook. Feishu maintains shared reference counts by connection and resource, canceling only when the last consumer leaves.

Leases prevent concurrent control operations on one record. Expired executions cannot commit state. Open Flow stores opaque subscription IDs and retains business checkpoints, deduplication, Runs, and scheduling. Listener renewal does not overwrite an advanced scan checkpoint. Callbacks only persist wakeups and subscription scheduling.

New operations use the authorization rules above for their Token type. For user/service-account subscriptions, the connector Trigger worker checks the principal’s current permissions. After revocation, it uses a restricted internal cleanup operation to delete resources owned by that record. This capability is not exposed over HTTP.

Team subscriptions do not query user app-access. The worker retries deletions that started but have not finished. Client grants are not stored as ongoing authorization sources. Revoking one user does not revoke the entire Team.

Cleanup is asynchronous and depends on maintenance intervals and third-party availability. It does not guarantee that all in-flight webhooks stop immediately on revocation. This maintenance task does not infer that remote subscriptions must be deleted when a Team token expires. Normal shutdown must explicitly clean up subscriptions. Pending cleanup records remain and retry after credential or upstream failures.

## Implementation and updates

OpenConnector owns open-source third-party implementations, static snapshots, and permission metadata in `src/providers/<service>/trigger-*.ts`. Open Flow’s `catalog.generated.json` is generated. Updating the catalog requires only the public repository and its installed dependencies. Run from the Open Flow root:

```sh
bun run --cwd packages/open-flow generate:provider-triggers /path/to/open-connector
```

This command invokes OpenConnector’s `scripts/export-flow-trigger-catalog.ts` to export registered snapshots, options, listener intervals, and eventSource information. It requires no private connector checkout.

Then run formatting, type, localization, and relevant test checks in Open Flow. Open Flow still handles Feishu event ingestion; display snapshots also come from generated data. Do not reintroduce third-party request implementations into Open Flow.

## Deployment and legacy subscriptions

1. Use the old Open Flow version to clean up existing remote webhooks/watch channels and managed Feishu resource subscriptions before upgrading the executor. Remote IDs in old records cannot be imported directly as trusted connector ownership.
2. Apply `0021_daily_jackal.sql` to the connector and deploy the API and Trigger worker. The maintenance worker needs the existing relation-control configuration to check revocation and perform cleanup.
3. Deploy the permission-group frontend and new Open Flow version. Assign required Triggers to users and republish flows to create server-owned subscriptions.

Poll business checkpoint structure remains unchanged. If the new Open Flow finds nonempty legacy webhook control state without a connector subscription ID, it returns an explicit error instead of silently creating another subscription. The original deployment or connection administrator must clean up remote resources left before the upgrade.

Automated verification covers permissions, fixed request construction, subscription lifecycles, memory and PostgreSQL storage, Open Flow publication/recovery/deduplication, and package artifacts. Real third-party accounts, production gateways, and production deployments require acceptance in those environments. Local tests do not establish that production migration occurred.

After a callback subscription is deleted, the same requestKey may enable it again. Rebuilding resets remote state and rotates callback verification data and the upstream creation idempotency key. Repeated cancellation of a deleted record does not conflict because of configuration changes; ownership checks still apply.

Trigger execution errors are classified as follows:

- Recognized connection problems return `trigger_connection_error` (409).
- Temporary provider failures return `proxy_upstream_error` (503).
- Input parsing errors return `invalid_input` (400).
- Unexpected internal errors return generic `provider_error` (500), without internal exception messages.

Open Flow maps connection problems to `connector.connection-required`.
