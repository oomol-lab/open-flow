import type { ValueEditorDeletion } from './valueEditor.tsx'

import { useEffect } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Input } from '../../ui/browser/input.tsx'

export function ChoiceOptions({
  options,
  disabled,
  onChange,
}: {
  options: readonly unknown[]
  disabled?: boolean
  onChange: (options: unknown[], deletion?: ValueEditorDeletion) => void
}) {
  const t = useTranslate()
  const createOptionLabel = (list: readonly unknown[], offset: number) => {
    let index = offset
    let label = t('valueEditor.option', { index })
    while (list.includes(label)) {
      index++
      label = t('valueEditor.option', { index })
    }
    return label
  }
  useEffect(() => {
    if (disabled || options.length > 0) return
    onChange([createOptionLabel([], 1)])
  }, [disabled, onChange, options.length, createOptionLabel, t])
  return (
    <div className="flex flex-col gap-2 text-xs">
      {options.map((option, index) => (
        <div className="flex items-center gap-1" key={index}>
          <Input
            className="h-[30px] min-w-0 text-xs"
            disabled={disabled}
            aria-label={t('valueEditor.option', { index: index + 1 })}
            value={typeof option === 'string' ? option : JSON.stringify(option)}
            onChange={(event) => {
              const next = [...options]
              next[index] = event.target.value
              onChange(next)
            }}
          />
          <div className="flex items-center gap-0 -ml-px -mr-0.5">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              aria-label={`${t('valueEditor.addOption')} ${t('valueEditor.option', { index: index + 1 })}`}
              onClick={() => {
                const next = [...options]
                next.splice(index + 1, 0, createOptionLabel(next, index + 2))
                onChange(next)
              }}
            >
              <i aria-hidden="true" className="i-tabler-light:square-rounded-plus text-lg text-muted-foreground" />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={disabled}
              className="-ml-px -mr-0.5"
              aria-label={`${t('valueEditor.remove')} ${t('valueEditor.option', { index: index + 1 })}`}
              onClick={() =>
                onChange(options.toSpliced(index, 1), {
                  target: 'option',
                  name: typeof option === 'string' ? option : t('valueEditor.option', { index: index + 1 }),
                })
              }
            >
              <i aria-hidden="true" className="i-tabler-light:square-rounded-minus text-lg text-muted-foreground" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
