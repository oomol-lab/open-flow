import type { ValueEditorDeletion } from '../../../../form/browser/valueEditor.tsx'

export type PropertyDeletion =
  | ValueEditorDeletion
  | { readonly target: 'field' | 'group' | 'case'; readonly name: string }
  | { readonly target: 'condition' | 'conditionGroup' }
