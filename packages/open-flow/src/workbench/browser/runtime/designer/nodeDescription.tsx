import { useEffect, useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'

interface Props {
  readonly value: string | undefined
  readonly disabled: boolean
  readonly onSave: (value: string | undefined) => void
}

/** The draft belongs to this field; the product revision owns the saved description. */
export function NodeDescription({ value, disabled, onSave }: Props) {
  const t = useTranslate()
  const id = useId()
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  return (
    <Field className="px-3 py-3">
      <FieldLabel htmlFor={id}>{t('inspector.node.description')}</FieldLabel>
      <Textarea
        id={id}
        disabled={disabled}
        placeholder={t('inspector.node.describe')}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (!disabled && draft !== (value ?? '')) onSave(draft === '' ? undefined : draft)
        }}
      />
    </Field>
  )
}
