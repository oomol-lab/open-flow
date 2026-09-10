# Development Principles

## Purpose and authority

Deliver the user's intended outcome with the least unnecessary complexity. Exercise independent
judgment: raise material errors and tradeoffs, and respect the user's informed decisions.

The user owns goals, scope, and consequential product choices. The agent owns routine engineering
decisions, including names, types, decomposition, tools, and execution order. Clarification is
warranted when missing information changes the intended outcome or exceeds the authorized scope.

Preserve unrelated work and staging state. Temporary resources created for a task are the agent's
responsibility; stop verification servers and confirm termination before delivery.

## Ownership and contracts

Each behavior has one authoritative owner. Correct defects at that owner; clients must not
compensate for incomplete contracts or maintain competing sources of truth.

`packages/open-flow` owns the public product, `packages/command` owns the CLI, and `apps/` owns
deployments. Cross-workspace dependencies use public entries. Common code is platform-neutral;
browser code is independent of Node. Dependencies must make these boundaries visible.

Preserve established product contracts unless the task calls for changing them. A contract change
includes its affected implementations, consumers, and specifications.

## Simplicity and coherence

Prefer clear, direct code and existing project conventions. Abstractions, compatibility layers,
and new infrastructure need a concrete benefit to the current product. Remove obsolete unpublished
behavior rather than preserving it speculatively.

Shared behavior belongs in shared production code. Features compose it rather than duplicate it.
Tests and Stories exercise the real behavior; their fixtures must not become parallel implementations.

Lab stories support design alignment between people and AI and fast visual inspection. Lay out
meaningful states side by side with clear labels; menus and panels under review should be visible
on entry without repeated clicks. Use real component and Trigger definitions with deterministic
sample data. Group related node, menu, and sidebar cases so missing or inconsistent designs are
easy to spot. Every second-level Lab navigation directory must have an UnoCSS Iconify icon.
Assign icons to directory metadata, not individual story titles.

Agents maintain related Lab stories as part of component changes without separate approval,
including adding missing states, updating examples, and organizing entries within established
categories. Confirm broad directory reorganizations, removal of still-useful coverage, or changes
to the design verification scope with the user unless already authorized by the task.

Keep durable principles in instructions, product boundaries in architecture, exact contracts in
technical references, and implementation details in code. Historical plans provide context, not
current policy. A local fix should not become a permanent universal rule.

## Verification

Evidence must support the claimed outcome. Choose verification by the affected behavior, consumers,
and risk, not by a fixed ritual. During iteration, resolve the current uncertainty with focused
checks. Before delivery, ensure the combined evidence covers the final change and its consequences.
Reuse valid results; broaden checks when the impact or remaining uncertainty warrants it.

For component appearance or interaction changes, use Lab as the preferred surface for visual
verification. Reuse or update the relevant stories to inspect affected states together; add missing
cases when needed. Supplement Lab checks with the actual product page when correctness depends on
integration, layout context, or a complete user flow that the stories do not cover.

Browser acceptance is appropriate when rendering or real interaction is material to correctness
and other evidence is insufficient. Clear, low-risk edits and non-UI work do not warrant it by default.
Static tests and successful builds do not establish visual correctness. Report material verification
gaps honestly, and satisfy required CI before merging.

## References

Consult only references relevant to the task:

- [Architecture](docs/architecture.md): product contracts, persistence, execution, and ownership.
- [Frontend](docs/authoring/frontend-ui.md): shared UI and Designer integration boundaries.
- [Iconify skill](.agents/skills/iconify-icons/SKILL.md): UI icon selection and integration.
- [Contributing](CONTRIBUTING.md): environment, check commands, and contribution requirements.
