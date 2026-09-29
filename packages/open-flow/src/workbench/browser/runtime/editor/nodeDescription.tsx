import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { PurposeField } from './purposeField.tsx'

interface Props {
  readonly value: string | undefined
  readonly placeholder?: string
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly onSave?: (value: string | undefined) => void
}

/** The draft belongs to this field; the product revision owns the saved description. */
export function NodeDescription({ value, placeholder, disabled = false, readOnly = false, onSave }: Props) {
  const t = useTranslate()
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  return (
    <PurposeField
      readOnly={disabled || readOnly}
      placeholder={placeholder?.trim() || t('inspector.node.describe')}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (!disabled && !readOnly && draft !== (value ?? '')) onSave?.(draft === '' ? undefined : draft)
      }}
    />
  )
}
