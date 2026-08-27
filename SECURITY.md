# Security Policy

Open Flow (`oomol-lab/open-flow`) ships a self-hosted Server that executes operator-authored
JavaScript and TypeScript inside an isolated runtime, exposes public Webhook and Integration
callback endpoints, and holds deployment secrets such as the operator token, browser session
cookies, the Connector runtime token, and the Integration callback key. We take security reports
seriously and are grateful to the researchers and users who help keep the project and its users
safe.

This policy explains which versions receive security fixes, how to report a vulnerability privately,
what to expect after you report, and how operators and contributors share responsibility for keeping
deployments safe.

## Supported Versions

Open Flow is in alpha and has not reached its first stable release. Security fixes are delivered on
the **latest released version** and the **`main`** branch. We recommend always running the latest
release and rebuilding the Server image from it.

| Version                 | Security fixes |
| ----------------------- | -------------- |
| Latest release / `main` | Yes            |
| Older releases          | No             |

## Reporting a Vulnerability

**Please report security vulnerabilities privately.** Do not open a public issue, pull request, or
discussion, and do not post details on social media or any other public channel, until we have
released a fix and coordinated disclosure with you. Public reports expose every deployment of the
project to the vulnerability before a patch exists.

Use one of these private channels:

1. **GitHub private vulnerability reporting (preferred).** Open
   <https://github.com/oomol-lab/open-flow/security/advisories/new>, or go to the repository's
   **Security** tab, then **Advisories**, then **Report a vulnerability**. This creates a private
   advisory visible only to you and the maintainers, and is the fastest path to a coordinated fix
   and a CVE.
2. **Email.** If GitHub private reporting is unavailable to you, email **support@oomol.com** with
   the subject line prefixed `[security]`. Use this only as a fallback; it is not an encrypted
   channel, so keep secrets out of the message (see below).

If you do not receive an acknowledgement within **3 business days**, please re-send through the other
channel in case a message was missed.

### What to include

A good report lets us reproduce and assess the issue quickly. Where possible, include:

- A description of the vulnerability and its security impact (what an attacker can do).
- Step-by-step reproduction, proof-of-concept, or the relevant code path. A minimal Flow or
  CodeModule that demonstrates the issue is ideal for runtime findings.
- The affected version, release, or commit, and **how it was deployed**: the Docker image built
  from `apps/server/Dockerfile`, a from-source `bun run dev` Server, the `@oomol-lab/open-flow`
  npm package, or the Command Artifact used by `oo flow`.
- Any known mitigation or workaround.

### Protect secrets in your report

Because a deployment holds live secrets, **do not include real operator tokens, session cookies,
Connector tokens, callback keys, Provider credentials, sensitive Variable values, or workflow data** in your report. Redact
them and use placeholder values (for example, `OPEN_FLOW_TOKEN=REDACTED`). If a proof-of-concept
requires a secret, describe how to generate a disposable test one instead of sharing a live value.

## What to Expect After Reporting

We follow a coordinated disclosure process:

- **Acknowledgement** within **3 business days** that we received your report.
- An **initial assessment and expected timeline** within **10 business days**. We triage by severity
  using [CVSS](https://www.first.org/cvss/calculator/4.0).
- **Regular status updates** as we work on a fix, and notification when it ships.
- **Credit** to you in the advisory and release notes when the fix is published, unless you ask to
  remain anonymous.

## Coordinated Disclosure

- Keep the report **private** until a fix is released. We aim to publish within **90 days** of the
  report; for actively exploited issues we move faster.
- We develop and review the fix in a **private** GitHub security advisory or fork, never in a public
  issue or pull request, which would reveal the vulnerability before a patch is available.
- When the fix is ready, we publish a **GitHub Security Advisory** and, for qualifying issues, request
  a **CVE** through GitHub (a CVE Numbering Authority) so downstream users are notified.
- We will coordinate the public disclosure date with you and credit your contribution.

## Scope

**In scope**: vulnerabilities in this repository's own code and defaults, for example:

- **Isolated runtime escapes.** User code in a Script, CodeModule, or Task escaping its isolate or
  the Executor process, reaching the host filesystem, environment, network, or other Runs, or
  obtaining a Capability that the current Task invocation did not declare.
- **Operator authentication and sessions.** Operator token verification, session cookie handling,
  login rate limiting, and Control API authorization in `apps/server`.
- **Trigger endpoints.** Bypassing Webhook or Integration callback authentication, admitting one
  occurrence as more than one Run, defeating admission or rate limits, or turning a callback
  response into executable content or modified security headers on the Workbench or Control API
  origin.
- **Secret leakage.** Operator tokens, Connector tokens, callback keys, or Provider callback
  verifiers appearing in Flow Revisions, RunEvents, the Workbench, API responses, or logs.
- **Variable boundary violations.** Variable values entering Flow Revisions, Publication records,
  persisted Run requests, platform-generated `node.started` input projections, or server logs
  without an operator-authored Flow explicitly propagating them.
- **Resource limit bypasses.** Circumventing the concurrent Run, pending Run, or Run timeout limits
  from user code or through the API.
- **Clients and distribution.** The Workbench (XSS, CSRF, and similar), the published
  `@oomol-lab/open-flow` npm package, the Command Artifact build and verification rules in
  `packages/command`, and the Docker image defaults.

**Out of scope**: please do not report these as vulnerabilities in Open Flow:

- Vulnerabilities in the Connector service a deployment is configured to use, such as
  [OpenConnector](https://github.com/oomol-lab/open-connector/security/policy) or the OOMOL-hosted
  Connector, or in third-party Providers. Report those to the respective project or provider.
- Behavior that requires operator privileges and works as designed. Open Flow executes code that a
  deployment operator authored: an operator making a workflow call a network service, read its own
  Project data, or consume its own deployment's Run limits is not a vulnerability. The isolated
  runtime is a boundary between user code and the host, not between operators of the same
  deployment.
- Insecure **self-hosted configuration** that this project documents how to avoid, for example
  running without `OPEN_FLOW_TOKEN`, exposing the Server to an untrusted network without TLS,
  leaving `OPEN_FLOW_SESSION_COOKIE_SECURE` unset behind a TLS ingress, using an HTTP Connector
  runtime origin across an untrusted network, or sharing the SQLite volume between containers. See
  [Hardening your deployment](#hardening-your-deployment).
- The hosted [OOMOL](https://oomol.com/) service and other OOMOL products. These are maintained
  separately from this repository and are not covered by this policy; report issues in them to
  support@oomol.com.
- Reports from automated scanners with no demonstrated impact, missing security headers without a
  concrete exploit, volumetric denial-of-service, social engineering, and physical attacks.

## Safe Harbor

We will not pursue or support legal action against researchers who, in good faith:

- follow this policy and stay within the scope above,
- avoid privacy violations, data destruction, and disruption of others' service, and
- give us a reasonable opportunity to remediate before any disclosure.

If in doubt about whether an action is authorized, ask us first at support@oomol.com. We do not
currently run a paid bug-bounty program, but we credit every reporter whose finding leads to a fix.

## Hardening Your Deployment

Open Flow Server is self-hosted and runs code on behalf of its operator, so operators share
responsibility for securing their deployment. At minimum:

- **Use a strong operator token.** Set `OPEN_FLOW_TOKEN` to at least 32 random bytes and inject it
  through a secret or an env file readable only by the deployer; never bake it into a Dockerfile,
  image layer, or repository file. The same value authenticates browser sessions and machine
  clients as a Bearer token. Without it the Control API and Workbench fail closed, but health and
  callback endpoints keep serving.
- **Terminate TLS and secure the session cookie.** Put the Server behind a TLS ingress and set
  `OPEN_FLOW_SESSION_COOKIE_SECURE=true`. The Docker image listens on `0.0.0.0:3000`; only expose
  it on a trusted network or behind an authenticated proxy.
- **Protect the Connector link.** Give `OPEN_FLOW_CONNECTOR_TOKEN` a runtime token scoped to the
  Providers and Actions the deployment actually needs. Keep `OPEN_FLOW_CONNECTOR_ORIGIN` on a
  trusted private network or behind TLS, and use HTTPS for `OPEN_FLOW_CONNECTOR_CONSOLE_ORIGIN`
  outside loopback development.
- **Protect Integration callbacks.** Use an HTTPS `OPEN_FLOW_INTEGRATION_PUBLIC_ORIGIN` and inject
  `OPEN_FLOW_INTEGRATION_CALLBACK_KEY` (at least 32 bytes) through a secret. Callback verifiers
  derived from it live only in the Server's runtime state.
- **Protect the data volume.** The SQLite database under `OPEN_FLOW_DATA_DIR` (`/data/open-flow`
  in the image) contains Flow source, Run history, Variable values, Trigger state, and Provider
  callback verifiers. Restrict access to the volume, let only one Server container write to it,
  and back it up quiesced together with its WAL and SHM files.
- **Treat Variables as readable deployment configuration.** Every authenticated Operator can list
  and read all Variable values, and the open-source Server stores them as plaintext in SQLite.
  Variables do not provide encryption at rest, per-value ACLs, automatic rotation, or an
  unexportable Secret Manager boundary. A Flow may explicitly return, log, or send a bound value.
- **Keep resource limits in place.** Tune `OPEN_FLOW_MAX_PENDING_RUNS`,
  `OPEN_FLOW_MAX_CONCURRENT_RUNS`, `OPEN_FLOW_RUN_TIMEOUT_MS`,
  `OPEN_FLOW_CALLBACK_REQUESTS_PER_MINUTE`, `OPEN_FLOW_OPERATOR_LOGIN_ATTEMPTS_PER_MINUTE`, and
  `OPEN_FLOW_RUN_EVENT_RETENTION_DAYS` to your deployment rather than removing the limits.
- **Stay current.** Rebuild the image from the latest release. When running from source, use the
  Bun and Node.js versions pinned in `.bun-version` and `.node-version`; the Server depends on the
  native `isolated-vm` module built for that Node.js ABI.

See the [Server deployment guide](docs/server/container-delivery.md) for the full configuration
reference, health checks, and backup procedure.

## Handling Secrets in the Codebase

For contributors and anyone working with this repository:

- **Never commit** operator tokens, `.env.server` files, Connector tokens, callback keys, Provider
  credentials, or captured callback payloads that contain user data. The development operator token
  under `apps/server/.open-flow-dev/` is git-ignored; keep it that way.
- If a secret is committed by mistake, treat it as **compromised**: rotate it immediately, then
  report it privately through the channels above. Removing it from later commits or rewriting git
  history is not sufficient; assume it was captured.
- Keep platform credentials out of Flow Revisions, RunEvents, the Workbench, API responses, and logs.
  Do not mistake the authenticated Variable API, which intentionally returns Variable values to an
  Operator, for a Secret Manager. Do not
  add Capabilities to the user realm without validating the current Project, Run, Task, and
  invocation, and do not weaken the isolate, Executor, or callback authentication boundaries
  described in [docs/architecture.md](docs/architecture.md).

Thank you for helping keep Open Flow and its users secure.
