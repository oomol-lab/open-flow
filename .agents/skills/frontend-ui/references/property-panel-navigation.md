# Property panel inspector navigation

Read for inspector visibility, outline/properties navigation, canvas selection, and
multi-selection behavior. Also read the [property panel entry](property-panel.md) for shared scope.

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
