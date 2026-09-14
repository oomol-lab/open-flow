import * as React from 'react'
import { cn } from './utils.ts'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentPropsWithoutRef<'textarea'>>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-[var(--ui-control-radius,calc(var(--ui-radius)_+_2px))] border border-input bg-[var(--ui-control-background,var(--ui-muted))] px-2.5 py-2 text-base transition-colors outline-none read-only:cursor-default placeholder:text-muted-foreground focus-visible:text-field-focus focus-visible:aria-invalid:invalid-text-field-focus disabled:cursor-[var(--ui-disabled-cursor,not-allowed)] disabled:bg-[var(--ui-disabled-background,color-mix(in_srgb,var(--ui-input)_50%,transparent))] disabled:opacity-[var(--ui-disabled-opacity,0.5)] aria-invalid:border-destructive md:text-sm dark:bg-[var(--ui-control-background,var(--ui-muted))] dark:disabled:bg-[var(--ui-disabled-background,color-mix(in_srgb,var(--ui-input)_80%,transparent))]',
        className,
      )}
      {...props}
    />
  )
})

export { Textarea }
