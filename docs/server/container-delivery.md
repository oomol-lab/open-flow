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
| `OPEN_FLOW_RUN_TIMEOUT_MS`                     | Maximum milliseconds from Run execution start to terminal state. Default: `1800000`.                                                          |
| `OPEN_FLOW_CALLBACK_REQUESTS_PER_MINUTE`       | Per-minute request limit for each Webhook/Integration endpoint or Wait capability. Default: `120`.                                            |
| `OPEN_FLOW_OPERATOR_LOGIN_ATTEMPTS_PER_MINUTE` | Deployment-wide Operator login attempts per minute. Default: `10`.                                                                            |

`OPEN_FLOW_CONNECTOR_ORIGIN` enables Connector. `OPEN_FLOW_CONNECTOR_TOKEN` is optional. If local Connector runtime authentication is disabled, omit it or use an empty string; Server then sends no `Authorization` header. A token without an origin is invalid. The internal runtime origin is independent of the browser’s Console origin. The Console origin must be browser-reachable and contain no credentials, path, query, or fragment. It requires HTTPS except for loopback development. A runtime origin may use HTTP on a trusted private container network. Across untrusted networks, TLS must protect the bearer token.

For OOMOL-hosted Connector with a token (`connector.oomol.com` / `connector.oomol.dev`), connection entry points automatically use `console.oomol.com` / `console.oomol.dev`. They build page links using the Flow or event-source form’s Team. `OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN` is unnecessary. `/providers/:serviceId` applies only to self-hosted OpenConnector Console and must not be appended to hosted runtime domains.

Provide or omit `OPEN_FLOW_LLM_ORIGIN` and `OPEN_FLOW_LLM_TOKEN` together. These settings apply in custom mode. The origin must use HTTPS without credentials, path, query, or fragment; only loopback development may use HTTP. Server calls `/v1/chat/completions` under that origin. In hosted mode, an exact Connector hostname of `connector.oomol.com` or `connector.oomol.dev` with a nonempty token selects `https://llm.oomol.com/v1` or `https://llm.oomol.dev/v1` and reuses that token. Console origin does not affect this derivation. Self-hosted OpenConnector, custom domains, and empty tokens do not implicitly enable LLM.

After login, `/settings` presents Connector and LLM together in a Service connection card. OOMOL-hosted and custom services are mutually exclusive. Integration callbacks remain a separate configuration.

A complete environment configuration locks its block. Users cannot change or clear it, and Server cannot mix its fields with SQLite configuration. Temporary external service failure does not cause a fallback to SQLite settings.

These field groups are stored as complete blocks:

- Connector runtime origin/token.
- Integration public origin/callback key.
- Explicit LLM origin/token.

Connector Console contains only a public origin and is independent of Connector runtime.

The Service connection card offers two radio cards, OOMOL-hosted and self-hosted. Selecting a card switches to that service even when its configuration is incomplete. An incomplete selected configuration marks its card, radio, edit button, and the Admin settings navigation entry as invalid without a notification or reverting the selection. Service calls continue to report their normal errors. Each card opens an editor dialog. Saving updates that profile without selecting it, and switching services preserves both profiles. Hosted mode uses one password field with an automatic authorization button and a clear action. Successful authorization saves the API key and closes the dialog. Manual entry uses Save. Automatic authorization is available only for supported OOMOL endpoints. Hosted mode provides both Connector and LLM. Self-hosted mode saves the Connector address/token, optional Console address, and optional LLM address/token together. Existing tokens remain stored when their editors are left blank. Closing a modified editor asks whether to save or discard changes.

The verification code is filled automatically. Server waits for authorization, then returns the API key and Connector origin to the authenticated administrator in a non-cacheable response so the editor can fill its draft. The editor saves a successful authorization result and closes after the save succeeds; failed saves retain the draft. An existing `connector.oomol.dev` profile uses the development environment. Private authorization state stays on Server, and public configuration responses remain redacted. Authorization can be canceled and must restart after expiry. A changed configuration revision prevents stale authorization results and saves.

If any service block is environment-managed, the card is read-only and mode switching and grouped writes are disabled. Integration remains independently editable.

Saved settings apply immediately to new requests, Runs, Polls, and Integration operations without a restart. Operations already started keep their initial configuration snapshot.

Configuration reads return only public origins, sources, and whether credentials are configured. They never return tokens or callback keys to browsers. Settings updates use a global expected revision; stale updates return a conflict.

Hosted mode uses only the LLM derived from the effective OOMOL Connector. Older custom LLM and Console settings, including environment values, are inactive while hosted mode is active; an empty hosted token leaves LLM unconfigured and never falls back to custom credentials. In custom mode, LLM uses environment configuration, SQLite settings, then unconfigured. Other blocks use their environment configuration, SQLite, then unconfigured.

`GET /config` includes `services.mode` (`oomol`, `custom`, or `null` before any service is selected), `services.managed`, and redacted `services.profiles`. `PUT /config/services/:mode` accepts `version: 1`, `expectedRevision`, and fields `connectorOrigin`, `connectorToken`, `consoleOrigin`, `llmOrigin`, and `llmToken`. A null token preserves its saved value; an empty token clears it. Incomplete profiles can be saved; missing required fields remain invalid in the editor and selected service status. Supplied addresses must still be valid. Saving a profile does not change the selected mode. `PUT /config/services/mode` selects a saved profile using `mode`, `version: 1`, and `expectedRevision`; incomplete profiles can also be selected. Both profiles and their selection share the deployment revision. Secrets never appear in configuration responses. Environment-managed service groups cannot be edited or switched. The older `PUT /config/services` and `/config/connector` endpoints still save and activate a group; `DELETE /config/services` clears the selected group. Integration settings remain independent, and individual LLM/Console endpoints reject edits while hosted mode is active.

The public Open Flow package includes Provider Trigger definitions. Users and deployers do not register them. Poll and Integration execute through Connector’s `POST /v1/proxy/:service` runtime interface, supported by OpenConnector and OOMOL Connector. Available Providers, Connections, and permissions depend on the configured Connector.

Provide or omit `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` and `OPEN_FLOW_INTEGRATION_CALLBACK_KEY` together. The origin must be Provider-reachable HTTPS without credentials, path, query, or fragment; only loopback development may use HTTP. The callback key requires at least 32 UTF-8 bytes. Settings can store both as one complete block. Without configuration, Integration definitions remain available for authoring, but Publish fails closed.

`OPEN_FLOW_PUBLIC_ORIGIN` generates action URLs for Wait Connector notifications. It must use HTTPS without credentials, path, query, or fragment; only loopback development may use HTTP. Ordinary Waits do not require it. If any Wait in the pinned Revision has a notification, Draft Run admission, Live Run admission, and Publish fail closed when this origin is missing. Public action routes do not use Operator sessions. The opaque capability in the URL is a bearer credential bound only to that Wait. Prevent reverse-proxy access logs, message previews, and analytics from collecting the complete path.

Without an environment-managed or persisted Operator credential, health checks, callbacks, and persisted runtime work can still operate. Control API fails closed and Workbench enters setup. Operator login and setup authorization share an instance-wide rate limit. Exceeding `OPEN_FLOW_OPERATOR_LOGIN_ATTEMPTS_PER_MINUTE` returns 429 and `Retry-After`. `POST /auth/setup` requires a valid setup session. Missing, tampered, or expired sessions return 401 without consuming this quota. Authorized claims are exempt and can finish even if setup authorization used the last attempt in the window.

At `OPEN_FLOW_MAX_PENDING_RUNS`, new Run admission returns 429. Idempotent replay of an accepted request still returns its original Run. Cron and Poll retain their scheduling position and retry shortly. Cron also retains its position while its Flow has a nonterminal Run. After that Run ends, Cron admits only the earliest unprocessed occurrence, then advances the next schedule beyond the current time. An unreadable or invalid published Cron Revision stops only that binding’s schedule and records failed health and error activity.

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
