import type { FieldValueDeletion } from '../common/fieldValue.ts'

export interface ValueControlProps {
  readonly schema: unknown
  readonly value: unknown
  readonly onChange: (value: unknown, deletion?: FieldValueDeletion) => void
  readonly label: string
  readonly disabled?: boolean
  readonly invalid?: boolean
  readonly path: string
  readonly onDraftIssue: (path: string, invalid: boolean) => void
}
