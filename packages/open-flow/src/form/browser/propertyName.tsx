import { useEffect, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Input } from '../../ui/browser/input.tsx'

export function PropertyName({ name, onRename, disabled }: { name: string; onRename: (name: string) => boolean; disabled?: boolean }) {
  const t = useTranslate()
  const [draft, setDraft] = useState(name)
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setDraft(name)
    setInvalid(false)
  }, [name])
  const save = () => {
    if (!disabled && draft !== name) setInvalid(!onRename(draft))
  }
  return (
    <Input
      aria-label={t('valueEditor.fieldName')}
      aria-invalid={invalid}
      readOnly={disabled}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
        setInvalid(false)
      }}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          save()
        }
        if (event.key === 'Escape') {
          setDraft(name)
          setInvalid(false)
        }
      }}
    />
  )
}
