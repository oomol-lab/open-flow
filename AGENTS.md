# Development Principles

## Purpose and authority

Deliver the user's intended outcome with the least unnecessary complexity. Exercise independent
judgment: surface material errors, risks, and tradeoffs early, then respect the user's informed
decision.

The user owns goals, scope, and consequential product choices. The agent owns routine engineering
decisions. Ask only when missing information would materially change the outcome, risk, cost, or
authorized scope.

Preserve unrelated work and staging state. Clean up temporary resources created for the task,
including stopping verification servers before delivery.

## Proportionality and coherence

Prefer the least complex solution that satisfies the explicit request and established contracts.
Start with native platform behavior and existing project primitives. Before adding state, effects,
observers, DOM measurement, portals, abstractions, compatibility layers, or infrastructure, require
a concrete user-visible need that simpler options cannot meet. Do not expand small issues to cover
hypothetical cases. If implementation or maintenance cost exceeds the likely benefit, stop and
choose the simpler solution. Reassess immediately when the user proposes a simpler approach.

Prefer clear, direct code and existing conventions. Shared behavior belongs in shared production
code; features compose it instead of duplicating it. Tests and Stories exercise production behavior
without becoming parallel implementations. Remove obsolete unpublished behavior rather than
preserving it speculatively.

Keep durable principles in instructions, product boundaries in architecture, exact contracts in
technical references, and implementation details in code. Historical plans are context, not policy.

## Ownership and contracts

Each behavior has one authoritative owner. Correct defects there; clients must not compensate for
incomplete contracts or maintain competing sources of truth. Preserve established contracts unless
the task changes them, and update their affected implementations, consumers, and specifications.

`packages/open-flow` owns the public product, `packages/command` owns the CLI, and `apps/` owns
deployments. Cross-workspace dependencies use public entries. Common code is platform-neutral, and
browser code is independent of Node. Dependencies should make these boundaries visible.

Provider, Action, and Connection data keep independent fetching and caching authority, including
scope, freshness, refresh, and invalidation. Consumers derive combined views at the consumption
layer. Do not embed one source's state in another or couple cache lifecycles merely because a feature
uses them together.

Caches store complete responses by request identity and own storage, freshness, conditional requests,
and coordination. They do not merge business entities across responses or infer authority from
arrival order. Add a derived multi-source layer only when its benefit and ownership justify it. Keep
caching simpler than the repeated work it removes.

## Project invariants

Before implementing or reviewing frontend appearance, layout, components, or interactions, read and
use the [frontend-ui skill](.agents/skills/frontend-ui/SKILL.md).

`ContextPanel` is the property panel's only cross-section stacking context. Sections and field tables
must not trap feedback or popups in local stacking contexts. Individual editors may isolate internal
content, but cross-section elevation uses the semantic layers in `context-panel.css`. Do not introduce
independent z-index scales, portals, DOM measurement, observers, or runtime positioning solely to
repair stacking that the shared CSS contract can express. Verify stacking changes across adjacent
sections in a composed panel.

Lab stories are the design-alignment and visual-inspection surface. Use real production components
with deterministic data and present meaningful related states together. Every second-level Lab
navigation directory has an UnoCSS Iconify icon in directory metadata. Put concise story guidance in
`description`; keep sample labels with their examples. Register sample-only controls through
`useStoryActions` from `packages/open-flow/dev/designer/storyActions.tsx`; production controls remain
in production components.

Maintain affected Lab stories with component changes. Confirm broad story reorganizations, removal
of useful coverage, or changes to verification scope unless the task already authorizes them.

## Verification

Evidence must support the claimed outcome. Choose verification by behavior, ownership, propagation,
and risk. Start with the smallest check that can falsify the intended change; broaden only when shared
contracts, indirect consumers, failures, or unresolved uncertainty justify it. Reuse valid evidence.

Tests protect consequential behavior and stable contracts. Favor public outputs, state transitions,
persistence, side effects, error handling, accessibility semantics, and ownership boundaries. Do not
test incidental markup, class strings, source layout, or exhaustive inventories unless they are an
explicit contract. Revise obsolete assertions instead of weakening an intentional design.

Use evidence that can observe the claim: pure tests for rules and data contracts, behavioral tests for
user-visible interaction and semantics, and rendered inspection for appearance and layout. Static
source checks are reserved for durable architecture or safety boundaries. A shared primitive, public
entry, schema, persistence or execution contract, cache, localization system, build pipeline, or
package artifact requires evidence from affected boundaries; a local or visual change usually does
not justify unrelated suites.

Use Lab as the preferred visual surface for component appearance and interaction, supplemented by
the product when integration matters. Browser acceptance is warranted when rendering or real
interaction is material and cheaper evidence is insufficient. Report material verification gaps
honestly.

Before every Git commit, run `bun run check` from the repository root and require it to pass. Run it
again after any rebase or merge that changes the result before committing or pushing.

## References

Consult only references relevant to the task:

- [Architecture](docs/architecture.md): product contracts, persistence, execution, and ownership.
- [Iconify skill](.agents/skills/iconify-icons/SKILL.md): UI icon selection and integration.
- [Contributing](CONTRIBUTING.md): environment, checks, and contribution requirements.
