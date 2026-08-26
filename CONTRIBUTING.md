# Contributing

Thanks for contributing to Open Flow.

## Before You Start

- Read [docs/architecture.md](docs/architecture.md) before changing manifests, Project
  persistence, compilation, runtime behavior, the Workbench, or public CLI behavior. It is the only
  product-boundary document, and changes that contradict it will not be merged.
- Open an issue first for larger changes such as new product boundaries, Control API changes, or new
  Trigger kinds, so the direction can be agreed before implementation. Bug fixes and small
  improvements can go straight to a pull request.
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

The development Workbench listens on `http://127.0.0.1:5173` and proxies API requests to the
Server on `http://127.0.0.1:3000`. The first run writes an operator token to
`apps/server/.open-flow-dev/operator-token`; later runs reuse it. Set `OPEN_FLOW_TOKEN` to use an
explicit token instead.

## Repository Layout

- [`packages/open-flow`](packages/open-flow): the public `@oomol-lab/open-flow` npm package.
  It owns the public types, strict decoders, Control API client, black-box conformance,
  deterministic Project/Run/Trigger semantics, programmatic authoring API, and the product-neutral
  Workbench runtime.
- [`packages/command`](packages/command): the `oo flow` command runtime and the immutable Command
  Artifact build and release. It consumes `packages/open-flow` only through its public package
  entries.
- [`apps/server`](apps/server): the self-hosted Server with the same-origin Workbench, Control
  API, SQLite persistence, Trigger scheduler, `isolated-vm` runtime host, and Docker delivery.
- [`docs`](docs/README.md): product boundaries, technical contracts, and deployment references.

## Development Rules

- Keep one TypeScript project per deployable workspace unless a real generated-code or platform
  constraint requires another project.
- Keep the public npm product in `packages/open-flow`. Deployables belong under `apps/` and must not
  deep-import another workspace's source files.
- Preserve `common/browser/node` ownership. Common code must not import browser or Node modules, and
  browser code must not import Node modules. `bun run check` enforces these boundaries.
- Use direct imports. Do not add broad barrels or path aliases that hide ownership.
- Use neutral domain names for product-owned code. The npm scope and serialized format tokens are
  exceptions, not internal naming patterns.
- Remove obsolete unpublished behavior instead of adding compatibility adapters.
- Keep comments in plain English sentence style with terminal punctuation.
- Before changing frontend interaction involving Select, popup, portal, focus, or outside-click
  handling, read [docs/authoring/frontend-ui.md](docs/authoring/frontend-ui.md).

## Checks

Run these before opening a pull request:

```bash
bun run check
bun run test
bun run build
```

- `bun run format` fixes formatting with oxfmt. `bun run check` also runs lint, type checks, and
  the platform boundary check.
- Do not use `bun test` at the repository root. It bypasses the workspace test scripts and
  incorrectly loads Vitest files with Bun's built-in test runner.
- Run `bun run test:package` when changing the published CLI, bundle entries, package metadata, or
  static Workbench assets.
- Run `bun run test:docker` when changing `apps/server/Dockerfile` or anything that ships in the
  release image. It needs a local Docker daemon and verifies the image, isolated runtime,
  Workbench, graceful shutdown, and SQLite volume recovery.

CI runs the same checks and scopes the package, command, Server, and image jobs to the files a
change touches.

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
- Pull requests must pass CI before review.

## Third-Party Rights

Do not contribute third-party logos, icons, screenshots, documentation excerpts, API schemas, or
brand assets unless you have the right to do so. Third-party licenses that apply to bundled assets
are listed in [NOTICE](NOTICE); add to it when introducing such an asset.

Provider names, app names, trademarks, logos, and brand assets belong to their respective owners.
This project uses such references only for identification and interoperability.

## Contribution License

By submitting a pull request, you agree that your contribution is provided under the Apache License,
Version 2.0, unless you clearly mark it otherwise in writing.
