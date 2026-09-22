import type { FieldValueDeletion } from '../../../../form/common/fieldValue.ts'

export type PropertyDeletion =
  | FieldValueDeletion
  | { readonly target: 'field' | 'group' | 'case'; readonly name: string }
  | { readonly target: 'condition' | 'conditionGroup' | 'webhookBody' }
