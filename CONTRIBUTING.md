# Contributing

Thanks for contributing to Open Flow.

## Before You Start

- Follow [AGENTS.md](AGENTS.md) for development rules, task-specific references, and verification.
- Discuss unagreed product boundaries or public API changes with maintainers before committing to
  an implementation. An existing task or agreement is sufficient; routine fixes need no separate issue.
- Do not report security vulnerabilities in public issues or pull requests. Follow
  [SECURITY.md](SECURITY.md) instead.

## Development Setup

Open Flow uses [Bun](https://bun.sh/) for the workspace and Node.js for the Server. Use the
versions pinned in `.bun-version` and `.node-version`; the Server depends on the native
`isolated-vm` module, which must match the Node.js ABI.

```bash
bun install --frozen-lockfile
bun run dev
```

The development Workbench listens on `http://127.0.0.1:5174` and proxies API requests to the
Server on `http://127.0.0.1:3001`. The first run writes an operator token to
`apps/server/.open-flow-dev/operator-token`; later runs reuse it. Set `OPEN_FLOW_TOKEN` to use an
explicit token instead.

## Repository Layout

- [`packages/open-flow`](packages/open-flow): the public `@oomol-lab/open-flow` npm package.
  It owns the public types, strict decoders, Control API client, black-box conformance,
  deterministic Flow/Run/Trigger semantics, programmatic authoring API, and the product-neutral
  Workbench runtime.
- [`packages/command`](packages/command): the `oo flow` command runtime and the immutable Command
  Artifact build and release. It consumes `packages/open-flow` only through its public package
  entries.
- [`apps/server`](apps/server): the self-hosted Server with the same-origin Workbench, Control
  API, SQLite persistence, Trigger scheduler, `isolated-vm` runtime host, and Docker delivery.
- [`docs`](docs/README.md): product boundaries, technical contracts, and deployment references.

## Development Tools

[AGENTS.md](AGENTS.md) defines development and verification principles. The package scripts provide
these checks; select their scope according to the change:

- `bun run format`: format with oxfmt. This project does not use Prettier.
- `bun run check`, `bun run test`, `bun run build`: check, test, and build all workspaces.
- `bun run --filter <workspace-name> <script>`: run a workspace script.
- `bun run test:npm-package` and `bun run test:command-artifact`: verify published artifacts;
  `bun run test:package` runs both.
- `bun run test:docker`: verify container delivery with a local Docker daemon.

For a focused public-package test, run `bun run vitest run --config vitest.config.ts <test-file>`
from `packages/open-flow`. The `test:vitest` script already selects `src test`, so appending a file
does not narrow it. Root `bun test` is unsuitable: it loads Vitest files with Bun's test runner.
Some test scripts include builds; inspect the scripts when choosing checks to avoid duplicate work.
TypeScript executed directly by Node must use erasable syntax supported by the pinned runtime.

CI scopes package, command, Server, and image jobs to the files a change touches.

## Documentation

- Update [docs/architecture.md](docs/architecture.md) only when a change introduces or revises a
  durable product boundary, cross-module ownership rule, or runtime invariant. Do not record local
  data structures, algorithms, UI defaults, or implementation steps there.
- Put exact serialized and protocol contracts in their technical references under
  [docs/control](docs/control/contracts/control-api.md) and
  [docs/distribution](docs/distribution/command-artifact.md). Implementation history stays in Git.
- Keep [README.md](README.md) and the translated READMEs under `docs/README.<locale>.md` in sync
  when changing any of them.

## Commits and Pull Requests

- Write commit and pull request titles in English using
  [Conventional Commits](https://www.conventionalcommits.org/), for example `fix(server): ...` or
  `refactor(workbench): ...`.
- Keep each pull request focused on one change. Describe what changed and why, link the related
  issue, and include tests and documentation updates with the change.
- Pull requests must pass required CI checks before merging.

## Third-Party Rights

Do not contribute third-party logos, icons, screenshots, documentation excerpts, API schemas, or
brand assets unless you have the right to do so. Third-party licenses that apply to bundled assets
are listed in [NOTICE](NOTICE); add to it when introducing such an asset.

Provider names, app names, trademarks, logos, and brand assets belong to their respective owners.
This project uses such references only for identification and interoperability.

## Contribution License

By submitting a pull request, you agree that your contribution is provided under the Apache License,
Version 2.0, unless you clearly mark it otherwise in writing.
