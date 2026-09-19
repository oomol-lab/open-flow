# Property panel contracts

Read for Value Node, Inputs, value editors, inspector navigation, and field or node settings. These
are confirmed product conventions, not a claim that every current implementation satisfies them.
New explicit user decisions supersede these references; update the affected contract when the
decision changes. Do not apply compact property-panel dimensions to unrelated product surfaces.

## Scope and terminology

- Value Node contains directly assigned values. It provides no upstream references or variable
  bindings. Source selection belongs to Inputs.
- Value table headings are Name, Type, Value; Chinese uses 名称、类型、值. The Chinese panel title
  is 数据. Component and Handle are not the value table's user-facing column headings.

## Section order

Within a selected node's property-panel body, render applicable sections in this order:

1. Warnings
2. Purpose
3. Port configuration
4. Node-specific settings
5. Node settings

Omit sections that do not apply without leaving placeholders, while preserving the relative order
of the remaining sections. A feature may define the order of multiple sections within one category,
but must not move them across these category boundaries. Panel chrome, the node header, empty states,
and multi-selection states are outside this sequence.

Provider triggers place their Options section immediately before Outputs so provider-specific
configuration precedes the data it produces.

## Route by task

Read only the detail relevant to the change; combine references when a task crosses domains.

- For inspector visibility, outline/properties navigation, canvas selection, or multi-selection,
  read [Inspector navigation](property-panel-navigation.md).
- For dimensions, row geometry, stacking, popups, danger presentation, disclosure, focus, keyboard
  order, source-selector presentation, or visual acceptance, read
  [Layout and interaction](property-panel-layout.md).
- For unset/null semantics, validation lifecycle, type conversion, clear actions, value editors,
  collections, field definitions, or field/node/group settings, read
  [Values and settings](property-panel-values.md).

## Shared review principles

- Identify the shared owner and affected sibling controls before editing. Keep shared behavior in
  its owner and remove superseded overrides instead of accumulating local exceptions.
- Treat a reported defect as evidence of a potentially shared cause. Inspect the affected family
  within the task's scope when the same owner is likely involved.
- Reuse valid evidence and keep verification proportional to the change. Distinguish static checks
  from observed visual or interaction results, and report material gaps.
