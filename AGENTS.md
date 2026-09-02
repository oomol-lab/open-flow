# Repository Instructions

Read [`docs/architecture.md`](docs/architecture.md) before changing manifests, project
persistence, compilation, runtime behavior, the Workbench, or public CLI behavior. It is the only
product-boundary document. Update it only when a change introduces or revises a durable product
boundary, cross-module ownership rule, or runtime invariant. Do not record local data structures,
algorithms, UI defaults, implementation steps, or other decisions that are clear from code and
tests. Put exact serialized and protocol contracts in their technical references, and keep
implementation history in Git. Do not reference unavailable repositories.

## Development Rules

- Keep one TypeScript project per deployable workspace unless a real generated-code or platform
  constraint requires another project.
- Keep the public npm product in `packages/open-flow`. Deployables belong under `apps/` and must
  not deep-import another workspace's source files.
- Preserve `common/browser/node` ownership. Common code must not import browser or Node modules,
  and browser code must not import Node modules.
- Use direct imports. Do not add broad barrels or path aliases that hide ownership.
- Use neutral domain names for product-owned code. The npm scope and serialized format tokens are
  exceptions, not internal naming patterns.
- Remove obsolete unpublished behavior instead of adding compatibility adapters.
- For changes involving a contract or `packages/command`, work bottom-up in waterfall order: make
  the lower-level model and its specification tests correct first, then implement adapters and
  upper clients. Do not compensate for an incomplete lower layer in a command, Workbench, or other
  client; a complete lower contract should leave upper layers with fewer states and bugs to handle.
- Keep comments in plain English sentence style with terminal punctuation.
- Before changing frontend interaction involving Select, popup, portal, focus, or outside-click
  handling, read [`docs/authoring/frontend-ui.md`](docs/authoring/frontend-ui.md).
- Do not launch or automate a browser for UI testing. Verify frontend changes with repository
  checks, tests, and builds only.
- UI work may use temporary probes and tests while investigating behavior. Before finishing, remove
  low-value tests that only assert markup, class names, component wiring, or library details. Keep
  tests that protect user-visible behavior and real interaction regressions.

## TypeScript Style

- Use short names made from basic English words.
- Ask the user to choose the name before adding or extracting a type or interface. Do not invent a
  long descriptive name.
- TypeScript files executed directly by Node must use erasable syntax. Do not use enums,
  namespaces, parameter properties, or runtime loaders such as `tsx`.
- Prefer `interface` for object shapes and `type` for unions.
- Prefer `==` for nullish checks and comparisons whose operands are already the same obvious type.
- Avoid non-null assertions when a local check or default value expresses the invariant clearly.

## Checks

```bash
bun run format
bun run check
bun run test
bun run build
```

Use `bun run format`, this project does NOT use Prettier.

Do not use `bun test` at the repository root. It bypasses the workspace test scripts and incorrectly
loads Vitest files with Bun's built-in test runner.

Run `bun run test:package` when changing the published CLI, bundle entries, package metadata, or
static Workbench assets.
