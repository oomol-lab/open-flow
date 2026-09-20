import type { EditorComponent } from './editorComponent.ts'

export interface FieldExpansionInput {
  readonly placement?: 'inline' | 'branch'
  readonly depth?: number
  readonly component?: EditorComponent
  readonly expandable: boolean
  readonly editable: boolean
  readonly empty: boolean
  readonly validation: 'pending' | 'valid' | 'invalid'
}
export type FieldExpansionPolicy = (input: FieldExpansionInput) => boolean | undefined

/** Undefined defers the initial decision until the first validation completes. */
export const valueFieldExpansion: FieldExpansionPolicy = ({ placement, depth = 0, component, expandable, editable, empty, validation }) => {
  if (!expandable || placement === 'inline') return false
  if (validation === 'invalid') return true
  if (component === 'json' && depth === 0 && empty) return validation === 'pending' ? undefined : false
  if (editable && empty) return true
  return validation === 'pending' ? undefined : false
}
export const definitionFieldExpansion: FieldExpansionPolicy = () => false
