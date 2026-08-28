# Fly.io Deployment

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Français](README.fr.md)

Open Flow Server can run on Fly.io as the Node Docker runtime. This deployment uses the repository's
`apps/server/Dockerfile`, the Fly app config in `fly.toml` at the repository root, and a Fly volume
mounted at `/data/open-flow`. Fly provides TLS termination, remote Docker builds, health checks,
rolling deploys, and optional custom domains.

The deployment boundary is the same as in the [container delivery reference](../container-delivery.md):
one Server machine and one SQLite writer. Never run more than one machine.

## Prerequisites

- A Fly.io account.
- `flyctl` installed and authenticated with `fly auth login`.
- Docker available locally, or Fly remote builders. `apps/server/Dockerfile` uses BuildKit syntax,
  which remote builders support.

## Create The App

Create a Fly app without deploying yet:

```bash
fly apps create my-open-flow
```

Fly app names are globally unique. If you choose a different name, update the `app` field in
`fly.toml` before deploying:

```toml
app = "my-open-flow"
```

## Create Persistent Storage

The image stores SQLite in `/data/open-flow`. Create a Fly volume with the same source name as
`fly.toml`:

```bash
fly volumes create open_flow_data \
  --region iad \
  --size 1 \
  --app my-open-flow
```

Run history and RunEvents grow over time. Increase `--size` if you expect many Runs, or extend the
volume later with `fly volumes extend`.

## Set Secrets

The operator token must contain at least 32 UTF-8 bytes. Store it as a Fly secret instead of
committing it to `fly.toml`:

```bash
OPEN_FLOW_TOKEN="$(openssl rand -hex 32)"

fly secrets set \
  OPEN_FLOW_TOKEN="$OPEN_FLOW_TOKEN" \
  --app my-open-flow
```

Keep `OPEN_FLOW_TOKEN` in a password manager. The same value signs in to the Workbench and works as
the Bearer token for the Control API.

`fly.toml` already sets `OPEN_FLOW_SESSION_COOKIE_SECURE` to `true`: `force_https` redirects plain
HTTP requests, so browsers only reach the Server over TLS.

Set the Connector secrets when you need a Connector:

```bash
fly secrets set \
  OPEN_FLOW_CONNECTOR_ORIGIN="https://connector.example.com" \
  OPEN_FLOW_CONNECTOR_TOKEN="replace-with-a-scoped-runtime-token" \
  OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN="https://connector.example.com" \
  --app my-open-flow
```

When OpenConnector runs in the same Fly organization, the runtime origin can use the Fly private
network, for example `http://my-open-connector.internal:3000`. The console origin must still be a
public HTTPS origin that users' browsers can open.

Set the callback origin and key when you need Provider Integrations:

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://my-open-flow.fly.dev" \
  OPEN_FLOW_INTEGRATION_CALLBACK_KEY="$(openssl rand -hex 32)" \
  --app my-open-flow
```

`fly secrets set` redeploys the machine. See the
[container delivery reference](../container-delivery.md#4-配置) for the full environment variable list
and the constraints on each origin.

## Deploy

Deploy from the repository root:

```bash
fly deploy --config fly.toml --remote-only --ha=false
```

`--ha=false` stops Fly from creating a second machine for a new app. The Server allows one SQLite
writer, and each machine mounts its own volume, so two machines would hold two unrelated copies of
the state. Keep the machine count at one on every later deploy and never raise it with
`fly scale count`.

The Fly config uses:

- `apps/server/Dockerfile` for the image build, with the repository root as the build context.
- `internal_port = 3000`, the image default.
- `GET /readyz` as the HTTP health check. It returns 503 while the Server is starting, when
  background processing has stopped, or when the configured Connector is unreachable; Fly then stops
  routing traffic to the machine and fails the deploy. Switch the path to `/healthz` if you only
  want a liveness check.
- `kill_signal = "SIGTERM"` and `kill_timeout = "45s"`. The Server waits up to 30 seconds to drain
  Runs and close SQLite, so the grace period must exceed 30 seconds.
- `auto_stop_machines = "off"` and `min_machines_running = 1`. Cron and Poll Triggers only fire while
  the machine is running.

## Verify The Runtime

```bash
curl https://my-open-flow.fly.dev/healthz
curl https://my-open-flow.fly.dev/readyz
```

The expected responses are `{"status":"ok"}` and `{"status":"ready"}`. Open
`https://my-open-flow.fly.dev` and sign in to the Workbench with `OPEN_FLOW_TOKEN`.

View logs when diagnosing deployment or startup issues:

```bash
fly logs --app my-open-flow
```

## Custom Domain

Register the domain with Fly:

```bash
fly certs add flow.example.com --app my-open-flow
```

Fly prints the DNS records to create. After DNS is ready, check certificate status:

```bash
fly certs check flow.example.com --app my-open-flow
```

If Integration callbacks are configured, point `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` at the new
domain:

```bash
fly secrets set \
  OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN="https://flow.example.com" \
  --app my-open-flow
```

## Updating

```bash
git pull
fly deploy --config fly.toml --remote-only
```

The volume keeps `open-flow.sqlite` and its WAL and SHM files. SQLite migrations run in order when
the Server starts; no extra step is needed.

## Backup

Fly takes volume snapshots automatically, but the Server only promises quiesced backups. For a
consistent backup, stop the machine before creating a snapshot:

```bash
fly machine stop <machine-id> --app my-open-flow
fly volumes snapshots create <volume-id> --app my-open-flow
fly volumes snapshots list <volume-id> --app my-open-flow
fly machine start <machine-id> --app my-open-flow
```

The snapshot is created asynchronously. Keep the machine stopped until
`fly volumes snapshots list` shows the new snapshot as `created`, then start the machine again.

Find the ids with `fly machine list` and `fly volumes list`.

## Scaling And Idle Machines

- Keep the machine count at one. For more capacity, change `size` and `memory` under `[[vm]]` in
  `fly.toml` and redeploy.
- The default is `memory = "1gb"`. Each Run's Isolated VM is capped at 128 MB by default,
  `OPEN_FLOW_MAX_CONCURRENT_RUNS` defaults to 4, and the Node process needs memory of its own. Raise
  the memory together with the concurrency limit.
- If you only use manual Runs and Webhooks and accept cold starts, set
  `auto_stop_machines = "suspend"` and `min_machines_running = 0`. Cron and Poll Triggers do not fire
  while the machine is suspended, and the first Webhook request waits for the machine to wake up.
