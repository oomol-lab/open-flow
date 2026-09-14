import { useTranslate } from 'val-i18n-react'
import { Button } from '../../ui/browser/button.tsx'
import { Input } from '../../ui/browser/input.tsx'

export function ChoiceOptions({ options, disabled, onChange }: { options: readonly unknown[]; disabled?: boolean; onChange: (options: unknown[]) => void }) {
  const t = useTranslate()
  return (
    <div className="flex flex-col gap-1 text-xs">
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
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`${t('valueEditor.remove')} ${t('valueEditor.option', { index: index + 1 })}`}
            onClick={() => onChange(options.filter((_, at) => at !== index))}
          >
            <i aria-hidden="true" className="i-lucide-light:minus" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={disabled}
        onClick={() => {
          let index = options.length + 1
          let label = t('valueEditor.option', { index })
          while (options.includes(label)) label = t('valueEditor.option', { index: ++index })
          onChange([...options, label])
        }}
      >
        <i aria-hidden="true" className="i-lucide-light:plus" />
        {t('valueEditor.addOption')}
      </Button>
    </div>
  )
}
