import * as React from 'react'
import { cn } from './utils.ts'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<'textarea'>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-[var(--ui-control-radius,calc(var(--ui-radius)_+_2px))] border border-input bg-[var(--ui-control-background,var(--ui-muted))] px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:text-field-focus focus-visible:aria-invalid:invalid-text-field-focus disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive md:text-sm dark:bg-[var(--ui-control-background,var(--ui-muted))] dark:disabled:bg-input/80',
        className,
      )}
      {...props}
    />
  )
})

export { Textarea }
