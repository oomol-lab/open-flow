# Shared UI and visual design

Read for shared controls, themes, host-facing UI, spacing, visual styling, shared browser UI, and
localization. For property-panel-specific geometry and states, use
[Property panel contracts](property-panel.md).

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

Keep style ownership explicit:

- Host styles stay within host-owned UI. Customize Open Flow through `--open-flow-*`; do not target
  packaged product roots or force them to inherit host tokens.
- `.open-flow-workbench` establishes `.open-flow-theme` and owns Workbench and canvas chrome,
  including the node outline, node picker, and canvas control islands.
- The canvas surface owns node content, edges, handles, and node-local popovers.
- `.open-flow-property-panel` may override control-specific tokens such as `--ui-control-radius`,
  but not product-wide tokens such as `--ui-radius`.
- Lab owns its shell, story framing, and guidance. It must not restyle production components.

Fix boundary leaks at their owner instead of adding compensating component overrides.

Shared controls declare their own dimensions, borders, backgrounds, and interaction states. The
canvas root provides base typography without overriding all descendant controls through native
element selectors. Compact text editors and comment title-bar buttons declare their own dimensions
without relying on ancestors to supply default styles.

## Visual Balance and Spacing

Property-panel geometry and surface contracts are maintained in
[Property panel contracts](property-panel.md#geometry-and-surfaces).

Keep internal separators in menus and editing popovers light and inset from both sides.
Use the theme border color at reduced opacity; `mx-2 h-px bg-border/50` is the current
reference for compact popovers. Apply this consistently below back/header controls and
above footer actions, including alternate views of the same popup. Judge contrast and
insets in the actual panel in both themes; these dividers should remain quieter than
control borders. This guidance concerns internal dividers, not the panel's outer border.

Prefer standard component variants, sizes, and layout conventions when changing appearance.
Do not patch visual defects with arbitrary padding, margins, offsets, hard-coded dimensions,
or increasingly specific overrides. Trace the mismatch to its owning component or layout and
correct it there. When resizing a control, use its standard size variant and let the surrounding
layout accommodate it; do not independently resize its icon, highlight, or hit area to imitate
a different size. Remove obsolete compensating styles as part of the correction. Introduce a
custom dimension only when a concrete product requirement cannot be met by existing conventions,
and keep that dimension owned and consistently consumed rather than scattering magic numbers.

Adjust control padding according to the visual weight of icons and text. A leading-icon button may
need slightly more space after its label than before its icon. Judge balance from the rendered
result without requiring numerically equal padding. Keep spacing between peer controls consistent
and make optical adjustments inside the control. Reuse shared sizing conventions; do not turn a
local pixel adjustment into a universal value.

## Language and Content

Each feature's locale bundle owns its product copy and accessible names. Cover `uiLanguages` and
keep keys, placeholders, and terminology consistent. The host owns the global language preference.
Preserve user content, Provider data, logs, and code output as written. Localize protocol errors
through stable error codes and parameters; preserve the original message for unknown errors.
