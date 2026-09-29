export function CodeEditorPlaceholder({ label }: { readonly label: string }) {
  return (
    <div className="code-editor-placeholder" role="status" aria-label={label}>
      <div className="code-editor-placeholder-gutter" aria-hidden="true" />
    </div>
  )
}
