# Property panel contracts

Read for Value Node, Inputs, value editors, and their field/node settings. These are confirmed
product conventions, not a claim that every current implementation satisfies them. New explicit
user decisions supersede this reference; update the affected contract when the decision changes.
Do not apply these compact-panel dimensions to unrelated product surfaces.

## Scope and terminology

- Value Node contains directly assigned values. It provides no upstream references or variable
  bindings. Source selection belongs to Inputs.
- Value table headings are Name, Type, Value; Chinese uses 名称、类型、值. The Chinese panel title
  is 数据. Component and Handle are not the value table's user-facing column headings.

## Inspector navigation

- Workbench owns inspector visibility and outline/properties navigation independently of canvas selection.
  Explicit open/close actions persist a browser preference across workflows; an unset preference means closed.
  Ordinary selection never opens a closed inspector. The block library is temporary and does not overwrite this preference.
- Back returns to the node outline without clearing selection. Explicit node selection, including selecting
  the same node again, enters properties when the inspector is open. Both canvas and outline use that selection action.
- Marquee selection highlights nodes immediately, but commits workspace selection and updates the inspector
  only when the gesture ends or is cancelled. Zero selections show the outline, one shows node properties,
  and multiple selections show their count and selected nodes in outline order. Selecting a row enters
  that node's properties; locating a row preserves the multi-selection. An empty outline provides the existing add-node entry.
- Docked inspector headers omit the close button; the fixed canvas toggle controls visibility.
  A trailing hamburger button returns to the outline; its button and icon sizes match the node icon control.
  There is no leading Back button or divider. Overlay panels retain
  their close button so dismissal remains directly accessible.
- Closed inspectors have a fixed canvas opener and a properties action on single/multi-selection toolbars.
  Workflow/target changes preserve visibility and reset navigation to the outline. Returning to the outline
  preserves its scroll position; selection changes do not resize the panel or steal canvas focus.

## Value semantics

- Undefined (unset), empty string, null, and empty collections are distinct states. State labels
  must remain distinguishable from user-entered content.
- Clear always sets the value to undefined. Allow null permits null; it does not convert a clear
  action into null. Preserve this distinction through callbacks, serialization, and reload.
- Changing type preserves compatible values. Apply the shared conversion/reset rules to incompatible
  values, including every affected array item; do not retain a string under an Object definition.
  Check the collapsed preview after a type change as well as the expanded editor.
- Opening a panel or inspecting an unset field must not silently create a value. Value creation and
  type changes use the existing shared rules rather than local guesses about defaults.
- Deleting an upstream node or output preserves saved source references. Show the missing node or
  output as invalid until the user explicitly selects another source or switches to a fixed value.
  A deleted node uses the neutral source icon and its saved output name; never expose its internal
  node ID as a user-facing fallback or imply a Provider identity that is no longer known.
- A non-nullable field containing `null` exposes the same explicit value-repair action as an unset
  field. Repair prefers the schema default and otherwise uses the shared type default.

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

- Compact field controls use a 30px height, 12px text, and 6px corner radius. Consume the panel's
  control-size and `--ui-control-radius` conventions instead of independently sizing each control.
  Collection add actions match adjacent field typography and height; copying an Options button's
  appearance is insufficient if the surrounding row uses different geometry.
- Property panels use the node outer-surface token; input controls use the node content-surface
  token. Theme values belong to `src/ui/browser/theme.css`. Keep control borders quiet and avoid
  introducing local shades to compensate for a mismatch in the shared state styling.
- Rows share column tracks. Object nesting consumes 16px per level inside the Name/Handle region;
  Type, Value, nullable, and action columns stay aligned with their parent rows.
- Hide column headings when the field editor switches to its wrapped layout at the shared
  container-width breakpoint; restore them when the rows fit on one line.
- Expanded Multiline and JSON editors follow the same cumulative nesting baseline as object
  children without a disclosure arrow. Array item values align to that child-field baseline, and
  their zero-based indices are centered at the corresponding disclosure-arrow position.
- Connectors stop earlier before an arrow, sorting drag handle, or array index than before an ordinary child field.
  Reuse the same endpoint rule for arrows and indices. Keep curves, indentation, and row geometry
  coherent at multiple nesting levels; do not tune one screenshot with independent offsets.
- Adjacent field/action rows use the same 8px gap. Avoid adding a second bottom margin to an expanded
  collection, or a gap from an empty wrapper. Check both sides of a full-row empty-collection action.
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
- A single selected upstream value shows the same node icon used on the canvas, including the
  resolved Provider icon for connector nodes, before the node and output label.
- A selected Variable value shows the Variable icon before its name, matching the icon used by
  the Variable source menu and its entries.

## Danger and interaction states

- All validation initiated by node property-panel editors must run asynchronously, even when the
  underlying check is local and synchronous. Each validation run must be cancelable; a new draft,
  external value change, editor replacement, or unmount cancels the superseded run. Only the result
  belonging to the current draft may update pending, valid, or error state or permit persistence.
  Guard completion with both cancellation state and request identity so an older result cannot
  overwrite newer input. Blur and Enter must coordinate with the current validation rather than
  committing a stale last-valid value; invalid drafts remain visible and are never silently replaced
  or submitted.
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
  field without becoming focusable or changing fill on hover.
- Type-icon and static-label simplification applies only to the Type column. Controls in the Value
  column retain their full labels and existing control appearance, including disabled states.
- Fixed and read-only types use non-focusable type labels in a 32px column (16px icon and 8px
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

- All expandable fields, including nested fields, start collapsed when the panel opens.
- Object, JSON, and Multiline use a compact preview in both collapsed and expanded states. The
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
  the object-style preview for it. This selector shows the full type name without an icon and
  retains its control border and dropdown arrow. Non-editable item types use the disabled selector.
- Manually expanding JSON or Multiline focuses its editor. Initial rendering does not steal focus.
  Handle lazy CodeMirror initialization and its textarea fallback, repeated expansion, and disabled
  fields. Use the shared minimal CodeMirror editor with no line numbers or active-line decoration;
  JSON strings use the established warm/orange highlighting.
- DOM and Tab order follow the visual row: disclosure/ordering control when present, Name, Type,
  the Input source action when present, Value and its actions, Allow null, field settings, then
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

## Value actions and collections

- The value row's settings icon opens field settings directly, without a preliminary menu containing
  JSON, Clear, and Field settings. JSON mode switching belongs to Object and Array value controls;
  a JSON-typed field already uses the JSON editor. The JSON toggle appears only while expanded,
  to the right of the clear x in both visual and keyboard order.
- Clear x buttons inside the value region appear on value-control hover or when the button itself
  receives keyboard focus. Focusing the editor alone does not reveal them. Keep hidden buttons in
  the natural Tab order and preserve pointer clicks when focus moves. Reserve space for existing date,
  color, or selection affordances, and keep action order consistent with keyboard order.
- Select and Multi-select menus omit Clear. Value rows use the shared inline clear x
  with hover and keyboard focus visibility; clearing produces undefined.
- Boolean uses a full-frame toggle with True/False on the left and a small Switch on the right.
  The shared clear x sits before the Switch and keeps its existing visibility and unset semantics.
  Clicking the frame or using Space/Enter toggles the value; clicking clear only clears.
  Unset retains its selection prompt and clicking sets true.
- Boolean and Select use "Select a value" when unset; Multi-select uses "Select values". These
  prompts have danger styling. An explicitly empty multi-selection remains distinct from unset.
- Fixed definitions omit option editing and all nested definition mutations while values remain editable.
  Empty fixed choices show "No options available". Closed empty objects retain the standard preview
  and disclosure; the expanded child row uses the disabled add-action surface to explain that an empty
  object is required and fields cannot be added. Open objects retain their add-field action.
- Missing editable choice definitions show a danger "Edit options…" entry point. Choice editing shares the
  selection popup, with a back chevron and an Add option button matching the list's typography.

- Object children and array items use the established rounded plus/minus buttons. Plus inserts
  after the current item; minus removes that item. A nonempty collection has no redundant bottom
  add button. An empty collection has one full-row add action on the child indentation baseline.
- Arrays choose the common item type in the parent row. Child rows show a zero-based index and the
  value, with no repeated per-item type selector. Reuse existing schema/value rules for add, remove,
  conversion, nested definitions, and constraints.
- During sorting, editable array items replace their indices with drag handles. Dragging or the
  up/down arrow keys moves the complete value to its new index. Item editor state follows the moved
  item; leaving sorting restores indices. Fixed item schemas do not prevent sorting editable values.
- Node settings reuse the panel's current field controls, typography, radius, and border/surface
  rules. Do not retain the older 22px borderless gray control style alongside the value table.
- Node settings keep their section title and always show their contents, without a disclosure control.
- Value Node does not show timeout settings or a Node settings section.

## Secondary field settings

- Use a fixed Field settings title; the first control identifies and edits the field name.
- Order fields as name, multiline purpose, labeled type selector, collapsed advanced settings, and a separate remove footer.
- Values and editable input/output definitions expose Allow null in the main row; omit its duplicate
  in the secondary panel.
- Edit JSON Schema with the shared minimal CodeMirror JSON editor. Preserve invalid drafts, validate the Schema before saving, and keep the type selector synchronized with the same definition.
- Input/output group settings use the same secondary-panel pattern, opened by a settings control aligned with the field gears. The panel edits the group name and default collapsed state and keeps removal in a separate footer.
- Removing a field or group requires a second confirmation within its settings panel. Removing a group retains its fields and removes only the group marker.
