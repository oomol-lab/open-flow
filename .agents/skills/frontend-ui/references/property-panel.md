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

## Geometry and surfaces

- Compact field controls use a 30px height, 12px text, and 6px corner radius. Consume the panel's
  control-size and `--ui-control-radius` conventions instead of independently sizing each control.
  Collection add actions match adjacent field typography and height; copying an Options button's
  appearance is insufficient if the surrounding row uses different geometry.
- Property panels use the node outer-surface token; input controls use the node content-surface
  token. Theme values belong to `src/ui/browser/theme.css`. Keep control borders quiet and avoid
  introducing local shades to compensate for a mismatch in the shared state styling.
- Rows share column tracks. Object nesting consumes 16px per level inside the Name/Handle region;
  Type, Value, nullable, and action columns stay aligned with their parent rows.
- Expanded Multiline and JSON editors follow the same cumulative nesting baseline as object
  children without a disclosure arrow. Array item values align to that child-field baseline, and
  their zero-based indices are centered at the corresponding disclosure-arrow position.
- Connectors stop earlier before an arrow or array index than before an ordinary child field.
  Reuse the same endpoint rule for arrows and indices. Keep curves, indentation, and row geometry
  coherent at multiple nesting levels; do not tune one screenshot with independent offsets.
- Adjacent field/action rows use the same 8px gap. Avoid adding a second bottom margin to an expanded
  collection, or a gap from an empty wrapper. Check both sides of a full-row empty-collection action.
- Internal popup separators are light and inset: the compact reference is `mx-2 h-px bg-border/50`.
  Apply the same separator treatment above actions and below back controls. Outer panel borders
  have a different role.

## Danger and interaction states

- Unset-required prompts, missing choice options, and validation failures share the same danger
  border and tinted surface. Danger prompt text and affordance icons use the same danger foreground.
  Use the shared theme/state owner. Do not mix separate red opacities, font sizes, or local tint
  formulas for Set value, selection prompts, and Edit options.
- Preserve user content and syntax highlighting in invalid editors; consistent danger styling does
  not require painting all entered text red. Focus remains visible without glow.
- Verify default, hover, open, and focus states. A generic placeholder, hover, or expanded utility
  must not override the danger foreground or remove its tint. Check actual computed colors when
  multiple utility classes or ancestor selectors compete.
- Type, Boolean, Select, and Multi-select triggers share the dropdown chevron implementation,
  dimensions, stroke, and trailing inset. Verify rendered dimensions: Iconify's em-based sizing can
  differ from SVG sizing despite apparently equivalent size classes.
- Add actions have a shallow neutral default fill and a slightly stronger hover fill. Preserve the
  established text and icon colors rather than changing the whole palette to obtain a background.

## Disclosure, focus, and keyboard order

- All expandable fields, including nested fields, start collapsed when the panel opens.
- Object, JSON, and Multiline use a preview when collapsed. When expanded, retain a visible shallow
  neutral block of the same size, with no preview text or input-like border. It remains a real,
  keyboard-accessible button that can collapse the editor and has appropriate hover/focus feedback.
  Neither invisible layout space nor an empty-looking input satisfies this contract.
- Arrays keep their shared item-type selector in the parent value region rather than substituting
  the object-style preview for it.
- Manually expanding JSON or Multiline focuses its editor. Initial rendering does not steal focus.
  Handle lazy CodeMirror initialization and its textarea fallback, repeated expansion, and disabled
  fields. Use the shared minimal CodeMirror editor with no line numbers or active-line decoration;
  JSON strings use the established warm/orange highlighting.
- DOM and Tab order follow the visual row: disclosure/ordering control when present, Name, Type,
  Value and its actions, Allow null, field settings, then expanded content and subsequent rows.
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
- Boolean, Select, and Multi-select menus omit Clear. Value rows use the shared inline clear x
  with hover and keyboard focus visibility; clearing produces undefined.
- Boolean and Select use "Select a value" when unset; Multi-select uses "Select values". These
  prompts have danger styling. An explicitly empty multi-selection remains distinct from unset.
- Missing choice definitions show a danger "Edit options…" entry point. Choice editing shares the
  selection popup, with a back chevron and an Add option button matching the list's typography.

- Object children and array items use the established rounded plus/minus buttons. Plus inserts
  after the current item; minus removes that item. A nonempty collection has no redundant bottom
  add button. An empty collection has one full-row add action on the child indentation baseline.
- Arrays choose the common item type in the parent row. Child rows show a zero-based index and the
  value, with no repeated per-item type selector. Reuse existing schema/value rules for add, remove,
  conversion, nested definitions, and constraints.
- Node settings reuse the panel's current field controls, typography, radius, and border/surface
  rules. Do not retain the older 22px borderless gray control style alongside the value table.
- Node settings keep their section title and always show their contents, without a disclosure control.
- Value Node does not show timeout settings or a Node settings section.

## Secondary field settings

- Use a fixed Field settings title; the first control identifies and edits the field name.
- Order fields as name, multiline purpose, labeled type selector, collapsed advanced settings, and a separate remove footer.
- Values already expose Allow null in the main row; omit its duplicate in the secondary panel. Input/output definitions retain it under advanced settings.
- Edit JSON Schema with the shared minimal CodeMirror JSON editor. Preserve invalid drafts, validate the Schema before saving, and keep the type selector synchronized with the same definition.
- Input/output group settings use the same secondary-panel pattern, opened by a settings control aligned with the field gears. The panel edits the group name and default collapsed state and keeps removal in a separate footer.
- Removing a field or group requires a second confirmation within its settings panel. Removing a group retains its fields and removes only the group marker.
