import { EditorComponentSelect } from './editorComponentSelect.tsx'

/** A compact definition control attached to a value, shared by Case and array items. */
export function FieldTypeAddon({
  schema,
  name,
  menuTitle,
  disabled,
  onChange,
}: {
  schema: unknown
  name: string
  menuTitle?: string
  disabled?: boolean
  onChange?: (schema: Record<string, unknown>) => void
}) {
  return (
    <EditorComponentSelect schema={schema} name={name} menuTitle={menuTitle} addon readOnly={disabled || !onChange} onChange={(next) => onChange?.(next)} />
  )
}
