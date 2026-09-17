---
name: frontend-ui
description: Implement and review Open Flow frontend components, styling, layout, and interactions. Use for button spacing, visual balance, themes, forms, canvas and Workbench integration, accessibility, and related Lab stories in this repository. Excludes backend-only changes and unrelated frontend projects.
---

# Open Flow Frontend Development

This skill defines frontend conventions for shared UI, forms, the canvas, Workbench, and host
integration. Paths beginning with `src/` are relative to `packages/open-flow/`; other repository
paths are relative to the repository root. Use production code as the source for component usage.

## Core workflow

- Identify the component that owns the behavior and its affected consumers. Correct shared behavior
  at its owner and keep feature-specific requirements local.
- Prefer existing components, tokens, and public interfaces. Preserve required state, language,
  theme, coordinate, clipping, stacking, and dismissal contexts when composing UI.
- Components own interaction semantics. Preserve keyboard operation, accessible names, state
  communication, focus restoration, expected opening and closing behavior, real link semantics,
  and reduced-motion behavior.
- When adding, replacing, or choosing icons, use the
  [iconify-icons skill](../iconify-icons/SKILL.md). Lucide icons use
  `i-lucide-light:<name>`, not `i-lucide:<name>`; existing `lucide-react` components use
  `strokeWidth={1.5}`.
- Prefer Lab for appearance and interaction checks. Maintain related Stories and add missing states.
  Supplement Lab with the product when host layout or a complete flow matters. Consult the
  [Lab documentation](../../../packages/open-flow/dev/designer/README.md) only when changing Lab
  infrastructure or deployment, or when an unfamiliar Story API requires it.
- Reuse an existing Lab or dev service when available. Stop and confirm termination of any service
  you start; leave pre-existing services running.
- For appearance or interaction changes, verify the affected states in Lab or the product. Static
  checks do not establish visual correctness. Report material verification gaps.

## Task-specific references

Read only the references relevant to the task; read more than one when the change crosses domains.

- For Value Node, Inputs, value editors, inspector navigation, field or node settings, and
  property-panel layout or interaction, start with
  [Property panel contracts](references/property-panel.md), then read only the routed detail
  relevant to the task.
- For shared controls, themes, host-facing UI, spacing, visual styling, shared browser UI, or
  localization, read [Shared UI and visual design](references/shared-ui.md).
- For standalone forms, Schema-controlled values, validation drafts, or shared code editors, read
  [Forms and editors](references/forms-and-editors.md).
- For canvas, Workbench, sidebar composition, node menus, canvas popovers, or undo/redo behavior,
  read [Canvas and Workbench](references/canvas-workbench.md).
