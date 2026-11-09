# Server container delivery reference

## 1. Image boundaries

`apps/server/Dockerfile` delivers one Server Flow application process. It includes same-origin Workbench, Control API, the MCP HTTP endpoint, Run runtime, Trigger runtime, and SQLite migrations. The image contains no Connector service, Connector database, or multiprocess supervisor.

Through a configured Connector runtime API, Server can use Provider/Action catalogs, authorized Connections, Action execution, and Provider proxying. The image still contains no Connector service. Provider transport, credentials, Connection lifecycle, and management UI are outside Open Flow Server. Without a configured Connector, these capabilities consistently return `connector.unavailable`.

The deployment supports one Server container and one SQLite writer. Do not let multiple containers mount and write the same data volume concurrently.

## 2. Build and delivery verification

Build the image from the repository root:

```bash
docker build --file apps/server/Dockerfile --tag open-flow-server:dev .
```

The Dockerfile uses multiple stages. The builder produces a `dist` that runs outside the monorepo. The final Node.js image copies only these release artifacts:

- `server/main.js`, `server/isolated-vm.js`, and `server/isolated-vm-executor.js`: the server bundle, Isolated VM host, and persistent Executor process.
- `public/`: Workbench static assets.
- `migrations/`: standalone SQL migrations executed in order.
- `node_modules/isolated-vm` and `node_modules/node-gyp-build`: the platform’s native Isolated VM runtime.
- `LICENSE`, `NOTICE`, and `package.json`, which declares the ESM layout.

The `isolated-vm` host, Executor, resource limits, and Engine digest belong to the Server release. They are not exported from the public `@oomol-lab/open-flow` package. The public package provides only the required Engine/Runtime contract and conformance cases.

The explicit Docker smoke test builds a temporary image and verifies Workbench, Operator sessions, Flow creation, real Code node execution, Docker health checks, graceful shutdown, and SQLite volume recovery after restart:

```bash
bun run --filter @oomol-lab/open-flow-server test:docker
```

The command creates an image with a random suffix, four containers, and one volume, then cleans them up. It is excluded from default unit tests because developer machines and CI may lack a Docker daemon.

## 3. Startup

Server can read an Operator token from its startup environment, or a deployer can claim it through Workbench after first startup. The token requires at least 32 UTF-8 bytes. Browsers use it to establish Operator sessions; machine clients use it as a Control API Bearer token.

Server generates a separate browser session signing secret and stores it in the data volume. It does not sign directly with the Operator token. After login, administrators can create email accounts and generate passwords in Settings → User management. Account workflows are isolated. Ordinary users can use administrator-configured capabilities but cannot change deployment settings. See [Server users](users.md).

If an external Secret system manages a fixed credential, inject it through an env file readable only by the deployer. Do not put tokens in Dockerfiles, image layers, or repository files. For example, `.env.server` can contain:

```dotenv
OPEN_FLOW_TOKEN=replace-with-at-least-32-random-bytes
OPEN_FLOW_LOG_LEVEL=info
```

Create a data volume and start Server:

```bash
docker volume create open-flow-data
docker run --detach \
  --name open-flow-server \
  --publish 3000:3000 \
  --volume open-flow-data:/data/open-flow \
  --env-file .env.server \
  open-flow-server:dev
```

MCP shares Server’s listening port at `/v1/mcp` and authenticates each request with personal access Tokens or the deployment Operator credential. See [MCP integration reference](mcp.md) for protocol versions, tools, and client examples.

Workbench and API are at `http://127.0.0.1:3000`. After login, `/variables` manages the signed-in account’s Variables and `/settings` manages external capabilities. The final image listens on `0.0.0.0:3000` by default, runs as root, and stores SQLite at `/data/open-flow/open-flow.sqlite`.

You can also start without `OPEN_FLOW_TOKEN`:

```bash
docker run --detach \
  --name open-flow-server \
  --publish 3000:3000 \
  --volume open-flow-data:/data/open-flow \
  open-flow-server:dev
```

With a new data volume, Server prints a one-time setup code in the startup log’s `operator.setup.required` record. Claim the deployment in this order:

1. Open Workbench.
2. Enter the setup code from the startup log.
3. Set an Operator token with at least 32 UTF-8 bytes.

The setup code is valid only for the current unclaimed process. Initial authorization lasts 10 minutes. A successful claim or Server restart invalidates the old code. SQLite claims atomically, so at most one concurrent request succeeds. Do not expose an unclaimed Server to users who cannot read deployment logs. Do not publish startup logs containing the code.

After a claim, the data volume stores an irreversible Operator token digest and a separate browser session signing secret. The original token is not written to disk. Containers restarted with the same volume keep using this credential. `OPEN_FLOW_TOKEN` locks authentication to the environment and bypasses setup. If the volume was never claimed, removing that variable returns Server to the unclaimed state.

## 4. Configuration

| Environment variable                           | Purpose                                                                                                                                       |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPEN_FLOW_HOST`                               | HTTP listening address. Image default: `0.0.0.0`.                                                                                             |
| `OPEN_FLOW_PORT`                               | HTTP listening port. Image default: `3000`.                                                                                                   |
| `OPEN_FLOW_DATA_DIR`                           | SQLite persistence directory. Image default: `/data/open-flow`.                                                                               |
| `OPEN_FLOW_TOKEN`                              | Optional environment-managed Operator credential. Requires at least 32 UTF-8 bytes; bypasses and locks deployment setup.                      |
| `OPEN_FLOW_SESSION_COOKIE_SECURE`              | Set to `true` behind TLS ingress. Accepts only `true` or `false`.                                                                             |
| `OPEN_FLOW_LOG_LEVEL`                          | Pino log level. Default: `info`.                                                                                                              |
| `OPEN_FLOW_CONNECTOR_ORIGIN`                   | Connector runtime origin reachable by Server.                                                                                                 |
| `OPEN_FLOW_CONNECTOR_TOKEN`                    | Restricted token for Connector runtime API calls. May be empty if local authentication is disabled. OOMOL-hosted tokens also serve LLM calls. |
| `OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN`           | Public Connector Console origin reachable by users’ browsers.                                                                                 |
| `OPEN_FLOW_LLM_ORIGIN`                         | Root origin of an OpenAI-compatible LLM service. Server calls its `/v1/chat/completions`.                                                     |
| `OPEN_FLOW_LLM_TOKEN`                          | Bearer token for the explicitly configured LLM service.                                                                                       |
| `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN`          | Public Integration callback origin reachable by Providers.                                                                                    |
| `OPEN_FLOW_INTEGRATION_CALLBACK_KEY`           | Key of at least 32 UTF-8 bytes for deriving Integration callback secrets.                                                                     |
| `OPEN_FLOW_PUBLIC_ORIGIN`                      | Public Server origin reachable by Wait notification consumers.                                                                                |
| `OPEN_FLOW_RUN_EVENT_RETENTION_DAYS`           | Detailed event retention for terminal Runs, in days. Default: `30`.                                                                           |
| `OPEN_FLOW_MAX_PENDING_RUNS`                   | Deployment-wide limit on nonterminal Runs. Default: `1000`.                                                                                   |
| `OPEN_FLOW_MAX_CONCURRENT_RUNS`                | Deployment-wide concurrent execution limit, with at most one per Flow. Default: `4`.                                                          |
| `OPEN_FLOW_MAX_CONCURRENT_TASKS`               | Deployment-wide active Code and managed Task budget. Default: `16`. Waiting workflow tools lend their slot to child work.                     |
| `OPEN_FLOW_RUN_TIMEOUT_MS`                     | Maximum milliseconds from Run execution start to terminal state. Default: `1800000`.                                                          |
| `OPEN_FLOW_TASK_CPU_MS`                        | CPU milliseconds one Code Task invocation may use across all of its callbacks. Default: `10000`.                                              |
| `OPEN_FLOW_CALLBACK_REQUESTS_PER_MINUTE`       | Per-minute request limit for each Webhook/Integration endpoint or Wait capability. Default: `120`.                                            |
| `OPEN_FLOW_OPERATOR_LOGIN_ATTEMPTS_PER_MINUTE` | Deployment-wide Operator login attempts per minute. Default: `10`.                                                                            |

`OPEN_FLOW_CONNECTOR_ORIGIN` enables Connector. `OPEN_FLOW_CONNECTOR_TOKEN` is optional. If local Connector runtime authentication is disabled, omit it or use an empty string; Server then sends no `Authorization` header. A token without an origin is invalid. The internal runtime origin is independent of the browser’s Console origin. The Console origin must be browser-reachable and contain no credentials, path, query, or fragment. It requires HTTPS except for loopback development. A runtime origin may use HTTP on a trusted private container network. Across untrusted networks, TLS must protect the bearer token.

For OOMOL-hosted Connector with a token (`connector.oomol.com` / `connector.oomol.dev`), connection entry points automatically use `console.oomol.com` / `console.oomol.dev`. They build page links using the Flow or event-source form’s Team. `OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN` is unnecessary. `/providers/:serviceId` applies only to self-hosted OpenConnector Console and must not be appended to hosted runtime domains.

Provide or omit `OPEN_FLOW_LLM_ORIGIN` and `OPEN_FLOW_LLM_TOKEN` together. They configure and lock only LLM, independently of Connector. The origin must use HTTPS without credentials, path, query, or fragment; only loopback development may use HTTP. Server calls `/v1/chat/completions` under that origin. An explicit environment LLM takes precedence even when Connector uses OOMOL.

After login, `/settings` preserves the Connector card with its OOMOL-hosted and self-hosted choices. Selecting a choice activates that Connector profile immediately, including an incomplete profile. Each choice has its own Edit action; saving an editor updates that profile without switching the selected Connector. Connector edits and selection leave LLM configuration unchanged. Incomplete Connector profiles can be saved and selected. Only Connector problems mark the Admin settings navigation entry as incomplete. Integration callbacks remain a separate configuration.

The LLM card presents two visible choices: OOMOL hosted, which can reuse an existing OOMOL connection without entering credentials, and a custom OpenAI-compatible model service, which requires a service URL and API key. Selecting a choice persists the LLM source independently of Connector. The Connect or Configure/Edit action opens only that choice's editor. Saving credentials does not select a source. Both Connector and LLM settings are deployment-wide.

Leaving the custom LLM key field empty preserves its saved value; whitespace-only keys are invalid; switching to OOMOL preserves the custom configuration for later reuse. OOMOL LLM reuses the saved OOMOL authorization even while a self-hosted Connector is active. No address or second copy of the OOMOL API key is required. An exact OOMOL Connector hostname (`connector.oomol.com` or `connector.oomol.dev`) derives `https://new-llm.oomol.com/v1` or `https://new-llm.oomol.dev/v1` using the same token. Console origin does not affect this derivation. Other Connector domains and empty tokens cannot supply OOMOL LLM credentials. Missing credentials or upstream failures never switch the selected source or fall back to custom credentials.

The OOMOL authorization dialog is shared by Connector and LLM. Starting it from LLM does not select a Connector profile. It also remains available when a custom Connector is environment-managed. Hosted environment credentials themselves are read-only. Authorization fills the verification code automatically; Server waits for authorization and returns the API key and Connector origin to the authenticated administrator in a non-cacheable response. The editor saves the authorization and closes after saving succeeds; failed saves retain the draft for retry. Manual API key entry is also available, and blank fields preserve stored keys unless explicitly cleared. An existing `connector.oomol.dev` profile uses the development environment. Private authorization state stays on Server, and public configuration responses remain redacted. Authorization can be canceled and must restart after expiry. A changed configuration revision prevents stale authorization results and saves. Closing a modified editor asks whether to save or discard changes.

Environment settings lock only their corresponding block. `OPEN_FLOW_LLM_*` does not lock Connector, and `OPEN_FLOW_CONNECTOR_*` does not lock LLM. A complete environment block cannot be changed, cleared, or mixed with SQLite fields. A hosted environment Connector supplies the default OOMOL LLM source when no LLM source has been saved; an explicit saved LLM selection takes precedence over that default. Other unconfigured deployments leave LLM unset until an administrator chooses a source. Existing persisted service profiles migrate their active source to LLM while retaining saved custom credentials and the deployment revision.

These field groups are stored as complete blocks:

- Connector runtime origin/token, with separate saved OOMOL and custom profiles.
- Integration public origin/callback key.
- Custom LLM origin/token, independently of the selected LLM source.

Connector Console contains only a public origin and belongs to the custom Connector profile.

Saved settings apply immediately to new requests, Runs, Polls, and Integration operations without a restart. Operations already started keep their initial configuration snapshot. Configuration reads return public origins, selected sources, and credential availability; they never return tokens or callback keys. Updates use a global expected revision; stale updates return a conflict.

`GET /config` includes `services.mode` (`oomol`, `custom`, or `null`), `services.managed`, and redacted Connector-only `services.profiles`. `PUT /config/services/:mode` accepts `version: 1`, `expectedRevision`, `connectorOrigin`, `connectorToken`, and `consoleOrigin`. A null token preserves its saved value; an empty token clears it. Incomplete profiles may be saved, but supplied addresses must be valid. Saving a profile does not change the selected mode. Authorization started from LLM also leaves the selected Connector unchanged. `PUT /config/services/mode` selects a saved Connector profile, including an incomplete one.

The `llm` status includes `mode`, `managed`, `custom` (saved origin and `tokenConfigured`), `oomolAvailable`, and `oomolManaged`, alongside effective configuration fields. `PUT /config/llm` accepts `version: 1`, `expectedRevision`, `origin`, and `token` (string or null to preserve the saved custom key); it saves and selects custom LLM without changing Connector. `PUT /config/llm/custom` accepts the same fields and saves custom credentials without changing the selected LLM source. `PUT /config/llm/mode` accepts `version: 1`, `expectedRevision`, and `mode` (`oomol` or `custom`) to select an existing source without changing saved credentials. An unavailable selected source remains selected and reports `configured: false`. `DELETE /config/llm` clears the saved custom credentials while retaining the source selection.

The older `PUT /config/services` remains an atomic combined custom Connector/LLM save-and-activate operation and rejects writes when either affected block is environment-managed. `/config/connector` saves and activates only Connector. `DELETE /config/services` clears the selected Connector profile and leaves LLM selection and saved custom credentials unchanged. The individual Console endpoints remain specific to custom Connector. All configuration mutations remain administrator-only.

The public Open Flow package includes Provider Trigger definitions. Users and deployers do not register them. Poll and Integration execute through Connector’s `POST /v1/proxy/:service` runtime interface, supported by OpenConnector and OOMOL Connector. Available Providers, Connections, and permissions depend on the configured Connector.

Provide or omit `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` and `OPEN_FLOW_INTEGRATION_CALLBACK_KEY` together. The origin must be Provider-reachable HTTPS without credentials, path, query, or fragment; only loopback development may use HTTP. The callback key requires at least 32 UTF-8 bytes. Settings can store both as one complete block. Without configuration, Integration definitions remain available for authoring, but Publish fails closed.

`OPEN_FLOW_PUBLIC_ORIGIN` generates action URLs for Wait Connector notifications. It must use HTTPS without credentials, path, query, or fragment; only loopback development may use HTTP. Ordinary Waits do not require it. If any Wait in the pinned Revision has a notification, Draft Run admission, Live Run admission, and Publish fail closed when this origin is missing. Public action routes do not use Operator sessions. The opaque capability in the URL is a bearer credential bound only to that Wait. Prevent reverse-proxy access logs, message previews, and analytics from collecting the complete path.

Without an environment-managed or persisted Operator credential, health checks, callbacks, and persisted runtime work can still operate. Control API fails closed and Workbench enters setup. Operator login and setup authorization share an instance-wide rate limit. Exceeding `OPEN_FLOW_OPERATOR_LOGIN_ATTEMPTS_PER_MINUTE` returns 429 and `Retry-After`. `POST /auth/setup` requires a valid setup session. Missing, tampered, or expired sessions return 401 without consuming this quota. Authorized claims are exempt and can finish even if setup authorization used the last attempt in the window.

At `OPEN_FLOW_MAX_PENDING_RUNS`, new Run admission returns 429. Idempotent replay of an accepted request still returns its original Run. Cron and Poll retain their scheduling position and retry shortly. Cron also retains its position while its Flow has a nonterminal Run. After that Run ends, Cron admits only the earliest unprocessed occurrence, then advances the next schedule beyond the current time. An unreadable or invalid published Cron Revision stops only that binding’s schedule and records failed health and error activity.

Idle Waits and workflow-call nodes persist their checkpoints immediately and release their Run slots.
Node execution uses the independent Task budget across all active Runs. Waiting for initial Task admission does not
consume a node's `timeoutMs`; it still counts toward the Run deadline. Cancellation removes queued
node admissions and releases held slots. Code and Agent workflow tools lend their Task slot while any
child call of that node is waiting, and the last returning call reacquires it before continuing.
The parent node's timeout keeps running while waiting for the child Run and reacquiring the Task slot,
so contention during reacquisition can exhaust that timeout.
Trusted graph scheduling, managed Tasks and node event persistence stay in the Server process.
A lost Code Executor ends affected Code Runs as indeterminate and is rebuilt for later work;
independent managed Tasks continue.

Other background work continues. Republishing after an upgrade or Draft repair restores scheduling without changing historical Publications. Callback rate limiting creates in-memory windows only for existing Webhook/Integration endpoints or verified Wait capabilities. Exceeding the limit returns 429 and `Retry-After`. Wait `GET`, `HEAD`, `POST`, and different actions share one capability’s quota; capabilities count separately. Invalid capabilities or actions outside the Wait consume no quota. A rate-limited Wait `POST` submits no decision.

Rate-limit state belongs to the current Server app instance and resets on restart.

## 5. Health checks and shutdown

The image’s Docker `HEALTHCHECK` calls `GET /healthz` and checks only that Server responds. Deployment ingress should use `GET /readyz` to decide whether to accept traffic.

Readiness returns 503 if Server has not started, Run/Trigger/Maintenance background processing has stopped, or a configured external Connector is unavailable. Liveness remains 200.

On `SIGINT` or `SIGTERM`, Server stops in this order:

1. End all Flow notification SSE streams.
2. Stop accepting new connections.
3. Wait for existing requests and runtime work to finish.

Server forcibly closes connections that remain after 30 seconds. Set the container orchestrator’s termination grace period above 30 seconds.

Check status:

```bash
docker inspect --format '{{.State.Health.Status}}' open-flow-server
curl --fail http://127.0.0.1:3000/readyz
```

Allow time for Run draining and SQLite closure during normal shutdown:

```bash
docker stop --time 45 open-flow-server
```

The image declares `SIGTERM` as its stop signal. The process stops accepting HTTP requests, waits for accepted work, closes SQLite, and exits with 0. The container runtime forcibly terminates it only after the deployment grace period.

## 6. Persistence and recovery

When deploying the node-owned workflow interface update, stop the old container and back up its data volume, then start the new image with the same volume. Schema migration 49 converts legacy Start/Outputs configuration and fills Publication interface snapshots before serving requests. It preserves workflow and publication identities and commits the upgrade atomically. Do not delete the volume. Rolling back to an older image requires restoring the pre-upgrade backup; see [interface migration details](../control/contracts/compatibility.md#node-owned-interfaces-and-publication-snapshots).

The data volume’s SQLite file stores Flows, Revisions, Publications, Runs, RunEvents, Wait checkpoints, the Wait notification outbox, Variables, Trigger bindings, Provider callback verifiers, deployment capability settings, persisted Operator credential digests, browser session signing secrets, and migration versions. Callback verifiers belong only to Trigger runtime state and do not enter Flow Revisions, Workbench, or RunEvents.

After committing `waiting`, Server sends Connector notifications through a persistent outbox. Crash recovery reclaims unfinished work or expired leases, so a Connector action may receive repeated requests with the same invocation identity. A unique SQLite Wait record still constrains Run state and decisions. Notification failure records only a delivery failure; the Run keeps waiting until resolution, cancellation, or expiry 7 days after entering the wait.

SQLite stores only the capability’s SHA-256 digest. Complete capability URLs generated for notification leave the Server volume and enter the selected Connector and messaging system’s trust boundary. Only quiesced backups are supported: stop ingress traffic, shut down the container normally, then back up the volume. Restore the complete data directory at the same path and start one Server container.

Variable values and settings-managed external service credentials are plaintext in SQLite files, WAL, and backups. Authenticated accounts can read their own Variables through Control API and management UI, including ordinary users. Administrator status does not grant access to another account’s Variables. Read APIs do not return external service credentials.

Neither provides encrypted storage or nonexportable Secret Manager guarantees. Deployers must treat data volumes, backups, Operator tokens, and the management network as one trust boundary.

Do not copy only the main `.sqlite` file while omitting WAL/SHM state in the same directory. Do not share a volume between a writing container and a restored container. Connector persistence has its own external backup boundary and is outside `/data/open-flow`.

## PostHog browser analytics

The Server browser host integrates PostHog. Its public SDK token belongs to the `openflow.run` project (ID `607951`, US Cloud). It is enabled by default only on `openflow.run` and `www.openflow.run`. Ordinary local development and other self-hosted deployments send no events to that project. The public token is built into browser source; existing CI and Docker builds need no extra credentials.

Other deployments can set `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` at Vite build time to use their own project. An explicitly empty key disables analytics. These are build settings. Setting them after container startup does not change built static assets.

Analytics uses anonymous browser identity rather than the Operator identity shared across deployments. It records page views, unhandled browser exceptions, successful Flow creation, configuration save/delete, and Variable create/update/delete events. Business events contain no Variable names, values, credentials, or Flow content. DOM autocapture and session recording are disabled.

### Upgrading to node retries

Flow model v9 requires Engine v6, checkpoint v6 and the matching isolated runtime digest. Finish or cancel active
Runs on the previous Engine before replacing the deployment, unless its matching recovery runtime
is retained. Republish old Engine-pinned Publications before executing them on the new Engine.
Existing Revisions, Publications and Run history are preserved; Draft upgrades are explicit.
