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

- Stored undefined, null, empty strings, and empty collections remain distinct. Nullable fields
  display both undefined and null as null and expose no clear action in either state. Non-nullable
  fields display undefined as unset and null as a stored value, with validation and a clear action.
  Empty strings and collections keep their own presentation. Display never writes a normalized value.
- Clear in an array-item Multiline text editor sets the value to an empty string and keeps the
  editor open and editable. Other Clear actions set the value to undefined. Allow null permits null; it does not convert a clear
  action into null. Node input persistence stores an explicit `kind: unset` mapping when cleared;
  only an absent mapping inherits the field default. Preserve this distinction through callbacks,
  serialization, reload, and execution.
- Changing type preserves compatible values. Apply the shared conversion/reset rules to incompatible
  values, including every affected array item; do not retain a string under an Object definition.
  Check the collapsed preview after a type change as well as the expanded editor.
- An editable Object summary in null/unset state creates an empty object without changing Schema
  or applying child defaults. Its declared children then render with unset values. No add-field
  action appears until the object exists; adding a field is a separate definition/value edit.
  An empty Array summary creates its first item using the same action as its branch add button.
  Read-only and populated summaries remain disclosures. The leading arrow toggles expansion.
- Opening a panel or inspecting an unset field must not silently create a value. Value creation and
  type changes use the existing shared rules rather than local guesses about defaults.
- Deleting an upstream node or output preserves saved source references. Show the missing node or
  output as invalid until the user explicitly selects another source or switches to a fixed value.
  A deleted node uses the neutral source icon and its saved output name; never expose its internal
  node ID as a user-facing fallback or imply a Provider identity that is no longer known.
- A non-nullable field containing `null` displays null with its validation error; it must not look
  unset. An explicit edit/create action uses the shared default rules. Array item clearing to undefined retains
  the item position as null because the persisted JSON array cannot contain undefined. Multiline
  text items instead retain an empty string; JSON editors keep their existing clearing semantics.

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
- A cleared field with a definition default exposes an inline reset action on its Set value prompt,
  or on its null control when nullable. Reset removes the saved override so the field inherits its
  default again. It follows the Clear action's hover and keyboard-focus visibility, and uses the
  danger foreground when the prompt is invalid. Place Reset first in visual and keyboard order when
  the control has other actions, including immediately before the Set value pencil affordance. The
  two hover affordances use the same opacity transition. Hovering an inline action retains the
  underlying value control's hover surface. A null control does not reserve the declared type's
  inactive trailing affordance space.
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
  object is required and fields cannot be added. Read-only object values use "Empty object" only for `{}`; null and unset retain their value
  semantics. Output definitions describe Schema constraints instead: no declared fields means
  "Empty object only" when additional properties are forbidden, or "No predefined fields" when
  allowed, with any additional-property value type shown separately. Pattern properties describe
  schema-constrained fields rather than an empty object. Open editable objects retain their add-field action.
- Missing editable choice definitions show a danger "Edit options…" entry point. Choice editing shares the
  selection popup, with a back chevron and an Add option button matching the list's typography.
- Object children and array items use the established rounded plus/minus buttons. Plus inserts
  after the current item; minus removes that item. A nonempty collection has no redundant bottom
  add button. An empty collection has one full-row add action on the child indentation baseline.
- Arrays keep the parent value control, preceded by the localized `valueEditor.arrayOf` label, with a compact item-type suffix.
  This suffix shares the Case type-addon component but edits `items`, not the whole value Schema.
  It remains present for unset, null and source-bound arrays; changing item type preserves source
  bindings and never creates an unset value. Value errors belong to the value control, not the type.
  Arrays choose the common item type in the parent row. Child rows show a zero-based index and the
  value, with no repeated per-item type selector. Reuse existing schema/value rules for add, remove,
  conversion, nested definitions, and constraints.
- During sorting, editable array items replace their indices with drag handles. Dragging or the
  up/down arrow keys moves the complete value to its new index. Item editor state follows the moved
  item; leaving sorting restores indices. Fixed item schemas do not prevent sorting editable values.
- Node settings reuse the panel's current field controls, typography, radius, and border/surface
  rules. Do not retain the older 22px borderless gray control style alongside the value table.
- Node settings keep the standard section-title typography and use a disclosure control whose
  contents start collapsed whenever the panel opens for a node.
- Cron and Poll schedule controls share the fixed Trigger schedule section title. They do not use
  the Node settings title or vary the section title with the trigger or schedule type.
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
