# Property panel values and settings

Read for unset/null semantics, validation lifecycle, type conversion, clear actions, value editors,
collections, definitions, and field, node, or group settings. Also read the
[property panel entry](property-panel.md) for shared scope.

## Review and acceptance

- For type changes, clearing, and collection edits, verify the resulting value and definition,
  their re-rendered presentation, and persistence when affected. Clicking successfully is not proof
  that undefined, null, empty data, or incompatible data was handled correctly.
- Exercise each applicable semantic state: set, unset, empty string, null, empty collection,
  invalid, and disabled. Keep state labels distinguishable from user-entered content.

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

## Validation lifecycle

- All validation initiated by node property-panel editors must run asynchronously, even when the
  underlying check is local and synchronous. Each validation run must be cancelable; a new draft,
  external value change, editor replacement, or unmount cancels the superseded run. Only the result
  belonging to the current draft may update pending, valid, or error state or permit persistence.
  Guard completion with both cancellation state and request identity so an older result cannot
  overwrite newer input. Blur and Enter must coordinate with the current validation rather than
  committing a stale last-valid value; invalid drafts remain visible and are never silently replaced
  or submitted.

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
  object is required and fields cannot be added. Read-only empty objects use the shorter "Empty object"
  label. Open objects retain their add-field action.
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
- Node settings keep the standard section-title typography and use a disclosure control whose
  contents start collapsed whenever the panel opens for a node.
- LLM task definition is an always-visible standard section immediately below Outputs and before
  Node settings.
- Value Node does not show timeout settings or a Node settings section.

## Secondary field settings

- Use a fixed Field settings title; the first control identifies and edits the field name.
- Order fields as name, multiline purpose, labeled type selector, collapsed advanced settings, and a separate remove footer.
- Values and editable input/output definitions expose Allow null in the main row; omit its duplicate
  in the secondary panel.
- Edit JSON Schema with the shared minimal CodeMirror JSON editor. Preserve invalid drafts, validate the Schema before saving, and keep the type selector synchronized with the same definition.
- Input/output group settings use the same secondary-panel pattern, opened by a settings control aligned with the field gears. The panel edits the group name and default collapsed state and keeps removal in a separate footer.
- Removing a field, group, collection item, case, or condition takes effect immediately without a second confirmation. After the save succeeds,
  show a notification with an Undo action backed by the canvas history. Removing a group retains its fields and removes only the group marker.
