# Forms and editors

Read for standalone forms, Schema-controlled values, validation drafts, and shared code editors.
For property-panel value semantics and field behavior, use
[Property panel contracts](property-panel.md).

## Standalone Value Forms

`src/form` owns controlled JSON value editing and Schema validation without depending on canvas
Stores or Providers. Node configuration, run inputs, and Wait notification parameters reuse it.
Editors may retain unfinished text drafts, but must not submit the last valid value while the draft
is invalid. Insert defaults only when the user explicitly creates a value.
`form/common/schemaWidget.ts` owns control-type inference and explicit value-creation rules. Agent
configuration uses this implementation; its semantics differ from the generic initial-value function
that reads JSON Schema `default` values.
It also owns conservative detection of canonical unconstrained Schemas. `FieldValueEditor` consumes
that result to select an editor from the stored value and to expose a data-type selector; consumers
must not infer Any independently or rewrite the Schema during data-type changes.

## Shared Code Editor

The shared code editor in `src/ui/browser/code-editor.ts` wraps CodeMirror directly. Workbench owns
TypeScript sessions, saving, and error messages; editors use the shared CodeMirror implementation
directly. Theme changes update the existing editor configuration to preserve selection and undo
history.
