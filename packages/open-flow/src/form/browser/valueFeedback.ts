export interface ValueError {
  readonly instancePath: string
  readonly message: string
}

/** Route field errors to the control that represents them in the current view. */
export function valueFeedback(
  errors: readonly ValueError[],
  { expanded, hasSummary, hasChildren, draftInvalid }: { expanded: boolean; hasSummary: boolean; hasChildren: boolean; draftInvalid: boolean },
) {
  const collapsed = hasSummary && !expanded
  const anchor = hasSummary && (collapsed || hasChildren) ? 'summary' : 'body'
  // An open collection delegates descendant errors to its child editors. An open
  // JSON/text editor represents the whole value, including nested Schema errors.
  const visibleErrors = hasChildren && !collapsed ? errors.filter((error) => error.instancePath === '') : errors
  const messages = [...new Set(visibleErrors.map(({ instancePath, message }) => `${instancePath ? `${instancePath}: ` : ''}${message}`))]
  const editorInvalid = draftInvalid || errors.length > 0
  return {
    anchor,
    messages,
    editorInvalid,
    summaryInvalid: collapsed ? editorInvalid : anchor === 'summary' && messages.length > 0,
  }
}
