import type { ComponentProps } from 'react'

import { useId } from 'react'
import { useTranslate } from 'val-i18n-react'
import { Field, FieldLabel } from '../../../../ui/browser/field.tsx'
import { Textarea } from '../../../../ui/browser/textarea.tsx'
import { cn } from '../../../../ui/browser/utils.ts'

type Props = Pick<ComponentProps<typeof Textarea>, 'placeholder' | 'readOnly' | 'onChange' | 'onBlur'> & {
  readonly compact?: boolean
  readonly value: string
}

export function PurposeField({ compact = false, ...props }: Props) {
  const t = useTranslate()
  const id = useId()
  return (
    <Field className={compact ? 'gap-1.5' : 'inspector-field-section'}>
      <FieldLabel className={compact ? 'text-xs font-normal text-muted-foreground' : 'inspector-section-title'} htmlFor={id}>
        {t('inspector.node.description')}
      </FieldLabel>
      <Textarea
        {...props}
        id={id}
        rows={compact ? 2 : undefined}
        className={cn(
          '[--ui-control-hover-background:var(--ui-control-background,var(--ui-muted))] placeholder:opacity-70 placeholder:transition-opacity placeholder:duration-300 hover:placeholder:opacity-50 focus:placeholder:opacity-30 motion-reduce:placeholder:transition-none',
          compact && 'min-h-16 max-h-40 resize-y text-xs md:text-xs',
        )}
      />
    </Field>
  )
}
