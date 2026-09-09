import type { ReactNode } from 'react'

import { useEffect, useId, useState } from 'react'
import { useTranslate } from 'val-i18n-react'
import { ContentIcon } from '../../../../ui/browser/icons/ContentIcon.tsx'
import { IconPickerButton } from '../../../../ui/browser/icons/icon-picker-button.tsx'
import { Input } from '../../../../ui/browser/input.tsx'

export function NodeHeading({
  title,
  icon,
  fallback,
  disabled,
  validate,
  onRename,
  onIconChange,
}: {
  readonly title: string
  readonly icon?: string
  readonly fallback: ReactNode
  readonly disabled: boolean
  readonly validate: (name: string) => string | undefined
  readonly onRename: (name: string) => void
  readonly onIconChange: (icon: string) => void
}) {
  const t = useTranslate()
  const errorId = useId()
  const [draft, setDraft] = useState(title)
  const [error, setError] = useState<string>()
  useEffect(() => {
    setDraft(title)
    setError(undefined)
  }, [title])
  const commit = () => {
    if (disabled) return
    const issue = validate(draft)
    setError(issue)
    if (!issue && draft !== title) onRename(draft)
  }
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <IconPickerButton label={t('inspector.node.icon')} disabled={disabled} onChange={onIconChange}>
        <ContentIcon src={icon} fallback={fallback} />
      </IconPickerButton>
      <div className="min-w-0 flex-1">
        <Input
          aria-label={t('inspector.node.name')}
          aria-invalid={error != null}
          aria-describedby={error == null ? undefined : errorId}
          disabled={disabled}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(undefined)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setDraft(title)
              setError(undefined)
            }
          }}
        />
        {error != null && (
          <span className="text-xs text-destructive" id={errorId} role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  )
}
