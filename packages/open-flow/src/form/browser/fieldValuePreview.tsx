import styles from './valueEditor.module.scss'
import type { ComponentProps, ReactNode } from 'react'

import { Button } from '../../ui/browser/button.tsx'
import { cn } from '../../ui/browser/utils.ts'

/** Shared compact preview for expandable text and structured values. */
export function FieldValuePreview({
  children,
  empty,
  trailing,
  className,
  ...props
}: ComponentProps<typeof Button> & { empty?: boolean; trailing?: ReactNode }) {
  return (
    <Button type="button" variant="disclosure" size="field" className={cn(styles.summary, className)} data-value-preview data-field-control {...props}>
      <span className={styles.summaryText} data-empty-string={empty || undefined}>
        {children}
      </span>
      {trailing}
    </Button>
  )
}
