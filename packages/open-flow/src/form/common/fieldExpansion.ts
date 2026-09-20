export interface FieldExpansionInput {
  readonly depth?: number
  readonly expandable: boolean
  readonly editable: boolean
  readonly empty: boolean
  readonly validation: 'pending' | 'valid' | 'invalid'
}
export type FieldExpansionPolicy = (input: FieldExpansionInput) => boolean | undefined

/** Undefined defers the initial decision until the first validation completes. */
export const valueFieldExpansion: FieldExpansionPolicy = ({ expandable, editable, empty, validation }) => {
  if (!expandable) return false
  if ((editable && empty) || validation === 'invalid') return true
  return validation === 'pending' ? undefined : false
}
export const definitionFieldExpansion: FieldExpansionPolicy = () => false
