/** Keep secondary panels outside the sidebar while preserving their field's vertical anchor. */
export function fieldPanelAnchor(field: Element | null | undefined) {
  if (!field) return null
  const panel = field.closest('.editor-context-panel')
  if (!panel) return field
  return {
    contextElement: panel,
    getBoundingClientRect: () => {
      const row = field.getBoundingClientRect()
      const sidebar = panel.getBoundingClientRect()
      return new DOMRect(sidebar.x, row.y, sidebar.width, row.height)
    },
  }
}
