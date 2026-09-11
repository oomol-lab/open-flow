---
name: frontend-ui
description: Implement and review Open Flow frontend components, styling, layout, and interactions. Use for button spacing, visual balance, themes, forms, canvas and Workbench integration, accessibility, and related Lab stories in this repository. Excludes backend-only changes and unrelated frontend projects.
---

# Open Flow Frontend Development

This skill defines frontend conventions for shared UI, forms, the canvas, Workbench, and host
integration. Paths beginning with `src/` are relative to `packages/open-flow/`; other repository
paths are relative to the repository root. Use production code as the source for component usage.

## Workflow

- Identify the component that owns the behavior and its affected consumers before making changes.
  Follow the ownership and context boundaries below.
- When adding, replacing, or choosing icons, use the project
  [iconify-icons skill](../iconify-icons/SKILL.md). Lucide icons must use the thin-stroke
  variant: `i-lucide-light:<name>` (stroke width 1.5), not the default `i-lucide:<name>`
  (stroke width 2). When using an existing `lucide-react` component, set `strokeWidth={1.5}`.
- Prefer Lab for appearance and interaction checks. Maintain related Stories and add missing states.
  See the [Lab documentation](../../../packages/open-flow/dev/designer/README.md) for entry points,
  Story organization, and run commands. Supplement Lab with the actual product page when correctness
  depends on host layout or a complete flow.
- Try opening the existing Lab or dev service directly before starting a service yourself. Only
  consider starting one if the existing service cannot be reached. Stop any service you start for
  verification and confirm it has terminated before delivery; leave pre-existing services running.
- Choose verification according to risk; small, low-risk edits do not require browser acceptance.
  Static checks do not establish visual correctness. Report the checks performed and material gaps.
  Follow the [development principles](../../../AGENTS.md#verification) and use the commands in
  [Contributing](../../../CONTRIBUTING.md).

## Visual Ownership

Shared UI owns control appearance and interaction states; features own their business layouts.
Express common visual behavior through shared components and keep local requirements scoped locally.
Avoid page-level overrides that affect other consumers. Use Tailwind for utilities, UnoCSS for icons,
and SCSS Modules for complex canvas layouts. Choose an approach that supports correctness and
maintainability.

`src/ui/browser` owns shared scroll containers and JSON viewers. Scrollbars follow the inherited CSS
`color-scheme` without reading canvas theme context. The shared UI locale bundle owns its copy,
which each language root composes.

Hosts reuse Button, Input, Label, and Textarea through `@oomol-lab/open-flow/ui`; the published package
also provides `@oomol-lab/open-flow/ui.css`. These controls do not depend on Workbench or canvas
context. Hosts retain business layout ownership, while shared UI owns control appearance and states.

`src/ui/browser/theme.css` owns theme values. Workbench, hosts, the canvas, and sidebars use
`open-flow-theme` and `data-theme`. Canvas nodes, edges, and their editing popovers use
`data-surface="canvas"` for the approved canvas colors and density. Fixed surrounding controls use
the default product colors. Shared components always read the `--ui-*` contract; do not load separate
light/dark theme modules or theme-selection functions.

Shared controls declare their own dimensions, borders, backgrounds, and interaction states. The
canvas root provides base typography without overriding all descendant controls through native
element selectors. Compact text editors and comment title-bar buttons declare their own dimensions
without relying on ancestors to supply default styles.

## Visual Balance and Spacing

Adjust control padding according to the visual weight of icons and text. A leading-icon button may
need slightly more space after its label than before its icon. Judge balance from the rendered
result without requiring numerically equal padding. Keep spacing between peer controls consistent
and make optical adjustments inside the control. Reuse shared sizing conventions; do not turn a
local pixel adjustment into a universal value.

For compact canvas node content, consider the Condition row padding as a starting point:
`5px 14px 5px 12px` (top, right, bottom, left). Schedule content uses the same padding;
its rules within one panel have a separate `12px` row gap. These are recommended reference
values, not requirements. Adjust for typography, content, and visual balance in Lab.
Treat row gaps and outer padding independently so increasing space between rows does not
unnecessarily enlarge the top and bottom edges of a single-row panel.

## Standalone Value Forms

`src/form` owns controlled JSON value editing and Schema validation without depending on canvas
Stores or Providers. Node configuration, run inputs, and Wait notification parameters reuse it.
Editors may retain unfinished text drafts, but must not submit the last valid value while the draft
is invalid. Insert defaults only when the user explicitly creates a value.
`form/common/schemaWidget.ts` owns control-type inference and explicit value-creation rules. Agent
configuration uses this implementation; its semantics differ from the generic initial-value function
that reads JSON Schema `default` values.

## Composition and Context

`src/canvas/browser` owns canvas rendering and interactions. `workbench/browser/runtime/editor`
composes the workspace canvas, node selection, and sidebar configuration. `WorkbenchCanvas`
connects workspace operations to `FlowCanvasView`; the workspace Store and flow/common contracts
continue to handle persisted changes.

Compose hosts, Workbench, and the canvas through their respective public interfaces. When reusing
components, preserve their required state, language, theme, and coordinate contexts. Avoid copying
internal implementations or making higher layers depend on private styles in lower layers.

The supplied model updates canvas node content, and cards, branches, and edges read that same
content. Position and selection belong to canvas interaction state; do not maintain writable mirrors
for each displayed field. Workbench directly composes sidebar titles, node menus, and configuration
fields. The canvas does not inject Portals into the sidebar.

Comment editing saves workspace presentation data directly. The host or Story owns temporary
ignored-node state through `useIgnoredNodes`. Canvas nodes read the controlled list, and menus
request updates through callbacks without changing the saved model or execution semantics.
`canvas/browser/NodeActions` (in `nodeActions.tsx`) is the menu shared by the canvas and sidebar,
with no Store dependency.

Canvas content scales with the viewport; surrounding controls and sidebars do not. Popover
coordinates, theme, clipping, stacking, and dismissal boundaries must match their containing region.
Mount location is part of component behavior; visibility alone does not establish correct integration.

Reuse Workbench's `BlockLibrary` and `ActionPicker` for app and action selection. ConnectorStore
owns catalog state, Flow scope, and cancellation semantics. Callers handle scenario filtering and
configuration and saving after selection.

## Interaction and Accessibility

Components own interaction semantics. Composition must preserve keyboard operation, accessible
names, state communication, focus restoration, and expected opening and closing behavior.
Navigation retains real link semantics, and animations respect reduced-motion preferences.

Workbench responds to the container dimensions assigned by its host. Visual layout and interaction
state use the same size source to remain consistent in embedded environments.

React Flow `ControlButton` does not forward a DOM ref and cannot be used directly in trigger
compositions that require one.

## Language and Content

Each feature's locale bundle owns its product copy and accessible names. Cover `uiLanguages` and
keep keys, placeholders, and terminology consistent. The host owns the global language preference.
Preserve user content, Provider data, logs, and code output as written. Localize protocol errors
through stable error codes and parameters; preserve the original message for unknown errors.

The shared code editor in `src/ui/browser/code-editor.ts` wraps CodeMirror directly. Workbench owns
TypeScript sessions, saving, and error messages; editors use the shared CodeMirror implementation
directly. Theme changes update the existing editor configuration to preserve selection and undo
history.

## Canvas Operation History

Workbench's WorkspaceStore owns undo/redo history for the current canvas. The canvas only triggers
operations and presents their availability. The public Flow change layer generates inverse
operations. Restoration creates a new Revision through normal save channels without rolling back
the Draft head.

Draft and Presentation changes for one canvas action share a single history entry. Undo becomes
available only after all saves complete. History covers node addition and deletion, pasting,
connections, movement, and layout; it excludes viewport changes, selection, and text editors' own
history.

Configuration, title, comment body, and code edits clear canvas history, as do canvas switching,
refreshing, and external updates. After a save failure, clear history and reload the actual state.
The two save channels do not guarantee atomic commits and do not automatically compensate for
partial success.
