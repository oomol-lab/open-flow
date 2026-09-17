# Canvas and Workbench

Read for canvas, Workbench, sidebar composition, node menus, canvas popovers, and persisted editing
behavior including undo and redo.

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

Workbench responds to the container dimensions assigned by its host. Visual layout and interaction
state use the same size source to remain consistent in embedded environments.

React Flow `ControlButton` does not forward a DOM ref and cannot be used directly in trigger
compositions that require one.

## Compact Node Spacing

For compact canvas node content, consider the Condition row padding as a starting point:
`5px 14px 5px 12px` (top, right, bottom, left). Schedule content uses the same padding;
its rules within one panel have a separate `12px` row gap. These are recommended reference
values, not requirements. Adjust for typography, content, and visual balance in Lab.
Treat row gaps and outer padding independently so increasing space between rows does not
unnecessarily enlarge the top and bottom edges of a single-row panel.

## Canvas Operation History

Workbench's WorkspaceStore owns undo/redo history for the current canvas. The canvas only triggers
operations and presents their availability. The public Flow change layer generates inverse
operations. Restoration creates a new Revision through normal save channels without rolling back
the Draft head.

Draft and Presentation changes for one canvas action share a single history entry. Undo becomes
available only after all saves complete. History covers node addition and deletion, pasting,
connections, movement, layout, node configuration, title, comment body, and content visibility;
it excludes viewport changes, selection, and text editors' own history.

When adding or changing persisted editing behavior in node/trigger property panels, canvas menus,
or toolbars, preserve this history contract. Route edits through WorkspaceStore's history-aware
operations; UI components must not maintain their own canvas history or clear it to accommodate
a missing inverse operation. New Flow change operations used by these edits need inverse support
in `flow/common/inverseChanges.ts`. Related field changes caused by one user action, such as
changing a connection and clearing dependent configuration, belong in one history entry.

Verify edit → undo → redo restores both the edited values and their dependent state, preserves
earlier history, and invalidates redo after a new edit. Cover queued saves or combined Draft and
Presentation changes when the affected operation uses them. Reusing an existing save operation
does not require a separate history implementation in the panel.

Code edits clear canvas history, as do canvas switching,
refreshing, and external updates. After a save failure, clear history and reload the actual state.
The two save channels do not guarantee atomic commits and do not automatically compensate for
partial success.
