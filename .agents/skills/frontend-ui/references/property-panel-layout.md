# Property panel layout and interaction

Read for property-panel dimensions, row geometry, stacking, popups, danger presentation,
disclosure, focus, keyboard order, source-selector presentation, and visual acceptance. Also read
the [property panel entry](property-panel.md) for shared scope.

## Review and acceptance

- When a visual defect may share an owner, compare the affected control family. For example, a
  dropdown-chevron change should cover type selectors, Boolean, Select, and Multi-select.
- Represent normal, danger, expanded, hover, and focus states explicitly. Select applicable states
  for verification: set, unset, empty string, null, invalid, disabled, hover, focus, expanded, and
  collapsed. Equal semantics must produce equal styling. When visuals disagree, compare computed
  styles; class names alone do not prove equality.
- Make DOM order follow visual reading order. When changing layout or adding or removing controls,
  exercise Tab and Shift+Tab, focus on expansion, and focus restoration on closing. Do not repair
  DOM-order defects with positive tabindex values.
- Inspect changed controls alongside sibling rows and nested levels in the full property-panel Lab
  story. Compare typography, control height, column edges, indentation, connector endpoints, and
  surrounding spacing. Check both themes when changing shared colors. Use the actual product when
  the relevant integration cannot be represented by the story.
- Do not claim visual or interaction verification from source inspection or static checks alone.

## Geometry and surfaces

### Stacking and overlays

- `ContextPanel` is the sole stacking context shared by property-panel sections. It isolates the
  panel from the canvas and owns this semantic order: ordinary content `0`, sticky section titles
  `1`, hovered field feedback `2`, focused or open editors `3`, panel header `4`, and resize handle
  `5`. Define and consume these values through the semantic custom properties in
  `context-panel.css`; do not repeat their numeric values in field tables or editors.
- Inputs, Outputs, settings sections, groups, and field tables must remain in the panel stacking
  context. Do not add `isolation`, a positioned `z-index`, paint containment, transforms, filters,
  or opacity to those wrappers without checking whether they create a stacking context. An
  individual `ValueEditor` may isolate its internal feedback and controls because the complete
  editor is elevated through the panel-owned hover and active layers.
- Keep attached errors and editor popups in their existing DOM and CSS positioning model. Do not
  introduce Portals, element measurement, scroll observers, or runtime repositioning solely to
  escape a property-panel section. Such infrastructure requires a separate interaction or clipping
  requirement that the panel layer contract cannot satisfy.
- Verify a stacking change in the composed inspector, not only a standalone field table. At
  minimum, inspect an error attached to the final Input above Outputs, an Input popup crossing the
  Outputs title, an Outputs popup crossing the following Code or settings content, and nested
  Object or Array feedback competing with its parent editor.

### Controls, rows, and menus

- Compact field controls use a 30px height, 12px text, and 6px corner radius. Consume the panel's
  control-size and `--ui-control-radius` conventions instead of independently sizing each control.
  Collection add actions match adjacent field typography and height; copying an Options button's
  appearance is insufficient if the surrounding row uses different geometry.
- Property panels use the node outer-surface token; input controls use the node content-surface
  token. Theme values belong to `src/ui/browser/theme.css`. Keep control borders quiet and avoid
  introducing local shades to compensate for a mismatch in the shared state styling.
- Rows in the same layout share default column tracks. Object nesting consumes 16px per level
  inside the Name/Handle region. A heterogeneous row may override its own tracks: an editable
  child type uses 56px without widening static 32px type cells in other rows. In the single-line
  layout, the Name column keeps its shared boundary; a wider type consumes Value space. Array items and Cases
  compose their own cells. Do not infer table geometry from descendant controls.
- Hide column headings when the field editor switches to its wrapped layout at the shared
  container-width breakpoint; restore them when the rows fit on one line.
- Root and object-child Multiline/JSON editors follow the child-field nesting baseline. Array-item
  Multiline and JSON editors replace their preview in the same value cell, without extra indentation or a connector.
  Their disclosure button stays at the value control’s top-right corner. While expanded, Clear
  and any JSON mode action stack directly below it inside the editor, in visual and keyboard order.
  Array indices remain static for these inline editors. Array item values align to that child-field baseline, and
  their zero-based indices replace the disclosure arrows at the same position. For structurally expandable items,
  the index is the disclosure button and supports clicking and keyboard activation; scalar indices are static.
- Connectors stop earlier before an arrow, sorting drag handle, or array index than before an ordinary child field.
  Reuse the same endpoint rule for arrows and indices. Keep curves, indentation, and row geometry
  coherent at multiple nesting levels; do not tune one screenshot with independent offsets.
- Adjacent field/action rows use the same 8px gap. Avoid adding a second bottom margin to an expanded
  collection, or a gap from an empty wrapper. Check both sides of a full-row empty-collection action.
- Read-only output object children omit their add and remove buttons while retaining both action
  slots, so hiding unavailable actions does not shift any row columns.
- Internal popup separators are light and inset: the compact reference is `mx-2 h-px bg-border/50`.
  Apply the same separator treatment above actions and below back controls. Outer panel borders
  have a different role.
- Empty-state menu rows keep the same font weight as available items. Distinguish them with the
  muted foreground color rather than reduced opacity or a different weight.
- Keep the separator above the upstream-source section when it shows its empty-state row so the
  menu structure remains stable when upstream nodes appear.
- Input source is a leading addon attached behind the value control. The value keeps its complete
  rounded border; the addon base extends underneath its left edge.
  It does not reserve a separate table column. Source and value occupy adjacent interaction regions;
  hovering or opening either region must not highlight the other. Keep the source available for
  editable literal and bound values. Read-only inputs omit the source addon and its reserved space,
  matching Value Node; existing source labels remain visible. The source action stays neutral when the value is invalid; danger
  styling belongs to the value region.
- An unconstrained Any field adds a compact data-type control inside the Value region. It
  precedes the value when no source addon exists, and follows the value when the editable source
  addon is present, producing `type + value` or `source + value + type` in DOM and visual order.
  Variable and upstream bindings hide the data-type control. An external value suffix retains
  ownership of that slot and suppresses the automatic type control. Disabled value fields show the
  current data type as a non-interactive label. This control describes the stored value only; the
  table Type column continues to describe Schema presentation.
- A single selected upstream value shows the same node icon used on the canvas, including the
  resolved Provider icon for connector nodes, before the node and output label.
- A selected Variable value shows the Variable icon before its name, matching the icon used by
  the Variable source menu and its entries.

## Danger presentation

- Unset-required prompts, missing choice options, and validation failures share the same danger
  border and tinted surface. Danger prompt text and affordance icons use the same danger foreground.
  Use the shared theme/state owner. Do not mix separate red opacities, font sizes, or local tint
  formulas for Set value, selection prompts, and Edit options.
- Value error messages appear as attached overlays below the control on hover or focus, with a
  restrained danger background and border. They never reserve document-flow space. Expanded text
  and JSON errors anchor below their editor; collection errors anchor below the main value control.
  Within a field table, focus takes priority: only the focused editor shows feedback while other
  rows retain ordinary hover styling without raising their stacking layer. Hover feedback resumes
  when focus leaves the editors. Pointer focus left on a disclosure or collapsed preview must not
  suppress hover feedback; keyboard-focused value controls retain focus priority.
- Invalid controls share danger borders and tinted surfaces. Actual values, collapsed previews,
  and type names retain their normal text colors; only action prompts such as Set value, Select a
  value, and Edit options use danger foreground, including their affordance icons. Preserve syntax
  highlighting in code editors. Focus remains visible without glow.
- Verify default, hover, open, and focus states. A generic placeholder, hover, or expanded utility
  must not override the danger foreground or remove its tint. Check actual computed colors when
  multiple utility classes or ancestor selectors compete.
- Type, Select, and Multi-select triggers share the dropdown chevron implementation,
  dimensions, stroke, and trailing inset. Verify rendered dimensions: Iconify's em-based sizing can
  differ from SVG sizing despite apparently equivalent size classes.
- Field-table type selectors show a 16px type icon and the shared chevron in a 56px column, with a
  localized type-name tooltip. Menus and secondary field settings retain the icon and full name.
  Null uses `i-lucide-light:circle-dashed`; the shared editor component icon map owns all type icons.
- Output tables use their otherwise unused value space for a wider Type column. Editable and
  read-only output types keep both the 16px icon and the localized type name visible. Read-only
  output types retain the standard control border and the same steady read-only fill as the Name
  field. Object type controls are keyboard-focusable disclosure buttons that toggle their children;
  scalar type controls remain non-focusable and do not change fill on hover. Nested output fields use
  the same read-only type surfaces, including the inline Array “of” item-type presentation.
- Type-icon and static-label simplification applies only to the Type column. Controls in the Value
  column retain their full labels and existing control appearance, including disabled states.
- Fixed and read-only input/value types use non-focusable type labels in a 32px column (16px icon and 8px
  padding on each side), normal muted text color, and a type-name tooltip. Table headings and
  nested rows share this column width, releasing the unused selector space. They have no visible control border,
  fill, dropdown arrow, or click feedback. Temporary disabling retains the selector's disabled
  appearance; it is separate from the read-only type contract.
- Non-editable Allow null cells reuse the shared disabled Checkbox, showing a check when allowed and
  a minus when disallowed. Preserve the actual boolean in the accessible state and omit tab stops.
  Editable cells retain the standard interactive checkbox behavior.
- Add actions have a shallow neutral default fill and a slightly stronger hover fill. Preserve the
  established text and icon colors rather than changing the whole palette to obtain a background.

## Disclosure, focus, and keyboard order

- Array-item inline Multiline and JSON editors always start collapsed, including empty or invalid values.
  Their errors remain visible on the collapsed preview. An empty top-level JSON field stays collapsed
  after a valid initial result, while an initial validation failure expands it. Other expandable value fields start collapsed unless their initial validation fails or their value is
  editable and empty (undefined, null, empty string, empty object, or empty array). False, zero,
  and whitespace-only strings are populated values. Read-only empty fields remain collapsed;
  initial errors may expand them. Definition trees start collapsed. Case groups and saved port
  groups retain their own defaults. Code-level expansion policies own these decisions.
- Default expansion runs only for initialization and the first validation result. Manual actions
  cancel pending automatic expansion; later value updates never reapply the default. Creating a
  value, clearing, and switching JSON mode explicitly control expansion. Reopening the panel
  resets defaults; sorting preserves identity, expansion, and mounted editor drafts.
- Object collections and root/object-child JSON/Multiline use a compact preview in both collapsed and expanded states.
  Array-item JSON/Multiline use the preview only while collapsed; their mounted editor replaces it on
  expansion. Closing restores focus to the preview and preserves drafts and editor state. The
  expanded preview retains the same shallow neutral block and standard control border. Its value
  summary and the array item-type name use muted foreground while expanded, restoring normal
  foreground when collapsed. While collapsed, the first-row value control represents all field errors. While
  expanded, it retains danger styling only for errors whose feedback is anchored to that row, such
  as array length constraints. Child-field and expanded text/JSON editor errors mark their own controls.
  The attached source addon also retains its border. It remains a real,
  keyboard-accessible button that can collapse the editor and has appropriate hover/focus feedback.
  When the preview has no separate disclosure control, show a directional chevron in the preview so
  its expand and collapse behavior remains identifiable in both states.
  Neither invisible layout space nor an empty-looking input satisfies this contract.
- Arrays keep their shared item-type selector in the parent value region rather than substituting
  the object-style preview for it. Output definitions, which have no Value column, combine a compact
  Array icon selector, a localized “of” separator, and the full item-type selector on one line in the
  Type column. The item selector shows the full type name without an icon and retains its control
  border and dropdown arrow. Non-editable item types use the disabled selector.
- Manually expanding JSON or Multiline focuses its editor. Initial rendering does not steal focus.
  Handle lazy CodeMirror initialization and its textarea fallback, repeated expansion, and disabled
  fields. Use the shared minimal CodeMirror editor with no line numbers or active-line decoration;
  JSON strings use the established warm/orange highlighting.
- DOM and Tab order follow the visual row: disclosure/ordering control when present, Name, Schema
  Type, the Input source action when present, Value and its actions, an Any data type when
  it follows the value, Allow null, field settings, then
  expanded content and subsequent rows.
  Hidden/collapsed descendants do not enter the tab sequence. Closing popups restores focus to the
  corresponding trigger.
- Reordering is an explicit mode. Drag handles share the left position with disclosure arrows;
  they do not permanently occupy a separate column. Entering or leaving this mode preserves the
  current expansion state and column geometry; nested object fields follow the same mode. While
  the drag handles replace disclosure controls, expansion/collapse is temporarily unavailable.
  The normal section header has matching reorder and add icons. During reordering, its top-right
  controls show only a checkmark exit action. Keep accessible names and tooltip labels for these
  icon-only controls. No Command-key mode switch is currently specified.
